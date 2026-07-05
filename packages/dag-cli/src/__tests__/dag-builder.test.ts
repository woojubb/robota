import { describe, it, expect } from 'vitest';
import { buildDagFromPipeline } from '@robota-sdk/dag-builder';
import type { INodeManifest } from '@robota-sdk/dag-core';

const MANIFESTS: INodeManifest[] = [
  {
    nodeType: 'input',
    displayName: 'Input',
    category: 'Core',
    inputs: [],
    outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
    defaultOutputPort: 'text',
  },
  {
    nodeType: 'llm-text-anthropic',
    displayName: 'LLM Text (Anthropic)',
    category: 'LLM',
    inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
    outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
    defaultInputPort: 'text',
    defaultOutputPort: 'text',
  },
  {
    nodeType: 'text-output',
    displayName: 'Text Output',
    category: 'Core',
    inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
    outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
    defaultInputPort: 'text',
    defaultOutputPort: 'text',
  },
];

describe('buildDagFromPipeline', () => {
  it('builds a linear 3-node pipeline', () => {
    const result = buildDagFromPipeline(
      {
        pipeline: [
          { nodeType: 'input', id: 'in' },
          { nodeType: 'llm-text-anthropic', id: 'llm' },
          { nodeType: 'text-output', id: 'out' },
        ],
      },
      MANIFESTS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.nodeCount).toBe(3);
    expect(result.edgeCount).toBe(2);
    expect(result.definition.nodes.map((n) => n.nodeId)).toEqual(['in', 'llm', 'out']);
    expect(result.definition.edges[0]).toMatchObject({
      from: 'in',
      to: 'llm',
      bindings: [{ outputKey: 'text', inputKey: 'text' }],
    });
    expect(result.definition.edges[1]).toMatchObject({
      from: 'llm',
      to: 'out',
      bindings: [{ outputKey: 'text', inputKey: 'text' }],
    });
  });

  it('auto-assigns nodeIds from nodeType when id is omitted', () => {
    const result = buildDagFromPipeline(
      {
        pipeline: [{ nodeType: 'input' }, { nodeType: 'text-output' }],
      },
      MANIFESTS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes[0]?.nodeId).toBe('input-0');
    expect(result.definition.nodes[1]?.nodeId).toBe('text-output-1');
  });

  it('sets dagId from input', () => {
    const result = buildDagFromPipeline(
      { dagId: 'my-dag', pipeline: [{ nodeType: 'input' }] },
      MANIFESTS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.dagId).toBe('my-dag');
  });

  it('returns structured error for unknown node type', () => {
    const result = buildDagFromPipeline({ pipeline: [{ nodeType: 'does-not-exist' }] }, MANIFESTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNKNOWN_NODE_TYPE');
    expect(result.error.message).toContain('does-not-exist');
    expect(result.error.context?.requestedType).toBe('does-not-exist');
  });

  it('unknown node type error includes fix with available options', () => {
    const result = buildDagFromPipeline({ pipeline: [{ nodeType: 'llm-gpt5' }] }, MANIFESTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fix).toBeDefined();
    expect(result.error.fix?.action).toBe('replace_node_type');
    expect(result.error.fix?.options).toContain('llm-text-anthropic');
    expect(result.error.fix?.options).toContain('input');
    expect(result.error.fix?.options).toContain('text-output');
  });

  it('agent can self-correct unknown node type using fix.suggestion', () => {
    // Step 1: agent sends wrong node type
    const failResult = buildDagFromPipeline(
      { pipeline: [{ nodeType: 'input' }, { nodeType: 'llm-gpt5' }, { nodeType: 'text-output' }] },
      MANIFESTS,
    );
    expect(failResult.ok).toBe(false);
    if (failResult.ok) return;
    expect(failResult.error.fix?.suggestion).toBeDefined();

    // Step 2: agent applies fix.suggestion and retries
    const correctedType = failResult.error.fix?.suggestion ?? '';
    const retryResult = buildDagFromPipeline(
      {
        pipeline: [{ nodeType: 'input' }, { nodeType: correctedType }, { nodeType: 'text-output' }],
      },
      MANIFESTS,
    );
    expect(retryResult.ok).toBe(true);
  });

  it('returns error for empty pipeline', () => {
    const result = buildDagFromPipeline({ pipeline: [] }, MANIFESTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPTY_PIPELINE');
    expect(result.error.fix?.action).toBe('add_node');
  });

  it('builds parallel branches', () => {
    const result = buildDagFromPipeline(
      {
        pipeline: [
          { nodeType: 'input', id: 'in' },
          {
            parallel: [
              { nodeType: 'llm-text-anthropic', id: 'a' },
              { nodeType: 'llm-text-anthropic', id: 'b' },
            ],
          },
        ],
      },
      MANIFESTS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodeCount).toBe(3);
    expect(result.edgeCount).toBe(2);
    // Both parallel branches depend on 'in'
    const aNode = result.definition.nodes.find((n) => n.nodeId === 'a');
    const bNode = result.definition.nodes.find((n) => n.nodeId === 'b');
    expect(aNode?.dependsOn).toContain('in');
    expect(bNode?.dependsOn).toContain('in');
  });

  it('includes config in node', () => {
    const result = buildDagFromPipeline(
      {
        pipeline: [
          {
            nodeType: 'llm-text-anthropic',
            id: 'llm',
            config: { model: 'claude-opus-4-7', systemPrompt: 'Review this code' },
          },
        ],
      },
      MANIFESTS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = result.definition.nodes[0];
    expect(node?.config).toMatchObject({ model: 'claude-opus-4-7' });
  });

  it('emits warning when defaultInputPort is missing', () => {
    const manifests: INodeManifest[] = [
      ...MANIFESTS,
      {
        nodeType: 'no-default-input',
        displayName: 'No Default',
        category: 'Test',
        inputs: [{ key: 'value', label: 'Value', order: 0, type: 'string', required: true }],
        outputs: [],
      },
    ];

    const result = buildDagFromPipeline(
      {
        pipeline: [
          { nodeType: 'input', id: 'in' },
          { nodeType: 'no-default-input', id: 'nd' },
        ],
      },
      manifests,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]?.message).toContain('no-default-input');
  });
});
