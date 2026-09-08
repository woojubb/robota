import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Only the agent entrypoint is stubbed. Provider construction is supplied through the injected
// provider-definition registry, which keeps this leaf test independent of vendor SDK packages.
vi.mock('@robota-sdk/agent-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-core')>()),
  Robota: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue('mocked response'),
  })),
}));

import {
  createPromptBackedNodeDefinition,
  PromptBackedNodeDefinition,
  createCompositeInstantNodeDefinition,
} from '../index.js';
import type { ICreatePromptNodeInput } from '../index.js';
import type { IDagDefinition, INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const TEST_PROVIDERS: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
    defaults: { model: 'test-model', apiKey: '$ENV:ANTHROPIC_API_KEY' },
    credentialRequirement: { anyOf: ['apiKey'] },
    createProvider: () => ({ name: 'anthropic' }) as never,
  },
];

function createTestNode(spec: ICreatePromptNodeInput = SINGLE_PORT_SPEC) {
  return createPromptBackedNodeDefinition(spec, TEST_PROVIDERS);
}

const MOCK_CONTEXT: INodeExecutionContext = {
  executionRoot: '/test/execution-root',
  dagId: 'test-dag',
  dagRunId: 'test-run',
  taskRunId: 'test-task',
  nodeDefinition: {
    nodeId: 'test-node',
    nodeType: 'my-custom-node',
    dependsOn: [],
    config: {},
  },
  nodeManifest: {
    nodeType: 'my-custom-node',
    displayName: 'My Custom Node',
    category: 'Instant',
    inputs: [],
    outputs: [],
  },
  attempt: 0,
  executionPath: [],
  currentTotalCredits: 0,
};

const SINGLE_PORT_SPEC: ICreatePromptNodeInput = {
  nodeType: 'my-custom-node',
  displayName: 'My Custom Node',
  systemPromptTemplate: 'Translate to French: {{text}}',
  inputPorts: [{ key: 'text', description: 'Input text' }],
  outputPort: { key: 'text', description: 'Translated text' },
  provider: 'anthropic',
};

describe('createPromptBackedNodeDefinition', () => {
  it('returns a PromptBackedNodeDefinition instance', () => {
    const node = createTestNode();
    expect(node).toBeInstanceOf(PromptBackedNodeDefinition);
  });

  it('sets nodeType from spec', () => {
    const node = createTestNode();
    expect(node.nodeType).toBe('my-custom-node');
  });

  it('sets displayName from spec', () => {
    const node = createTestNode();
    expect(node.displayName).toBe('My Custom Node');
  });

  it('sets category to Instant', () => {
    const node = createTestNode();
    expect(node.category).toBe('Instant');
  });

  it('builds inputs from inputPorts', () => {
    const node = createTestNode();
    expect(node.inputs).toHaveLength(1);
    expect(node.inputs[0]).toMatchObject({ key: 'text', type: 'string', required: true });
  });

  it('builds outputs from outputPort', () => {
    const node = createTestNode();
    expect(node.outputs).toHaveLength(1);
    expect(node.outputs[0]).toMatchObject({ key: 'text', type: 'string', required: true });
  });

  it('sets defaultInputPort to first input port key', () => {
    const node = createTestNode();
    expect(node.defaultInputPort).toBe('text');
  });

  it('sets defaultOutputPort to output port key', () => {
    const node = createTestNode();
    expect(node.defaultOutputPort).toBe('text');
  });

  it('each instance has independent nodeType', () => {
    const nodeA = createTestNode({ ...SINGLE_PORT_SPEC, nodeType: 'node-a' });
    const nodeB = createTestNode({ ...SINGLE_PORT_SPEC, nodeType: 'node-b' });
    expect(nodeA.nodeType).toBe('node-a');
    expect(nodeB.nodeType).toBe('node-b');
  });
});

describe('PromptBackedNodeDefinition.taskHandler.execute', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders template and returns output on success', async () => {
    const node = createTestNode();
    const input: TPortPayload = { text: 'hello world' };
    const result = await node.taskHandler.execute(input, MOCK_CONTEXT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveProperty('text', 'mocked response');
    }
  });

  it('returns validation error when required input port is missing', async () => {
    const node = createTestNode();
    const result = await node.taskHandler.execute({}, MOCK_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_MISSING');
    }
  });

  it('returns validation error when API key is missing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    const node = createTestNode();
    const result = await node.taskHandler.execute({ text: 'hello' }, MOCK_CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_INSTANT_NODE_API_KEY_REQUIRED');
    }
  });

  it('multi-port spec renders all variables into template', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const multiSpec: ICreatePromptNodeInput = {
      nodeType: 'multi-port-node',
      displayName: 'Multi Port',
      systemPromptTemplate: 'Name: {{name}}, Age: {{age}}',
      inputPorts: [{ key: 'name' }, { key: 'age' }],
      outputPort: { key: 'result' },
      provider: 'anthropic',
    };
    const node = createTestNode(multiSpec);
    const result = await node.taskHandler.execute(
      { name: 'Alice', age: '30' },
      { ...MOCK_CONTEXT, nodeDefinition: { ...MOCK_CONTEXT.nodeDefinition, nodeId: 'multi' } },
    );
    expect(result.ok).toBe(true);
  });
});

describe('persistence view (BEHAVIOR-006)', () => {
  it('PromptBackedNodeDefinition.toPersisted() returns a prompt record', () => {
    const node = createTestNode({
      nodeType: 'p',
      displayName: 'P',
      systemPromptTemplate: 'Hi {{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'out' },
      provider: 'openai',
      model: 'gpt',
    });
    expect(node.toPersisted()).toEqual({
      kind: 'prompt',
      nodeType: 'p',
      displayName: 'P',
      systemPromptTemplate: 'Hi {{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'out' },
      provider: 'openai',
      model: 'gpt',
    });
  });

  it('CompositeInstantNodeDefinition.toPersisted() returns a composite record without the runner', () => {
    const innerDag = {
      dagId: 'd',
      version: 1,
      status: 'draft',
      nodes: [],
      edges: [],
    } as unknown as IDagDefinition;
    const node = createCompositeInstantNodeDefinition({
      nodeType: 'c',
      displayName: 'C',
      innerDag,
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'in', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'out', portKey: 'text' } }],
      runner: { run: async () => ({ ok: true, outputs: {} }) },
    });
    const persisted = node.toPersisted();
    expect(persisted.kind).toBe('composite');
    expect('runner' in persisted).toBe(false);
    expect(persisted).toMatchObject({
      kind: 'composite',
      nodeType: 'c',
      innerDag,
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'in', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'out', portKey: 'text' } }],
    });
  });
});
