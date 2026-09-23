import { describe, expect, it } from 'vitest';

import { formatDagDecodeIssues } from '../services/dag-decode-primitives.js';
import {
  decodeDagDefinition,
  decodeDagDefinitionAsDagError,
} from '../services/dag-definition-decoder.js';
import { DagDefinitionValidator } from '../services/definition-validator.js';
import {
  decodeDagRobotaCompanion,
  decodeDagWorkflowFile,
} from '../services/dag-workflow-file-decoder.js';

import type { IDagDefinition } from '../types/domain.js';

/**
 * Issue #2077 — a total decoder for the persisted DAG definition.
 *
 * Every case in the malformed corpus used to pass a top-level discriminator check and reach the
 * semantic validator (or a command) as `IDagDefinition`, where it failed as a `TypeError`. The
 * decoder must instead name the field, by path, and the semantic validator must never see it.
 */
const VALID: IDagDefinition = {
  dagId: 'd',
  version: 1,
  status: 'draft',
  nodes: [
    {
      nodeId: 'a',
      nodeType: 'input',
      dependsOn: [],
      config: { text: 'hi', nested: { list: [1, 'two', null] } },
      outputs: [{ key: 'text', type: 'string', required: true }],
      position: { x: 1, y: 2 },
    },
    {
      nodeId: 'b',
      nodeType: 'text-output',
      dependsOn: ['a'],
      config: {},
      inputs: [{ key: 'text', type: 'string', required: true, isList: false }],
      costPolicy: { runCreditLimit: 5, costPolicyVersion: 1 },
    },
  ],
  edges: [{ from: 'a', to: 'b', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
  costPolicy: { runCreditLimit: 10, costPolicyVersion: 1 },
};

/** `[label, malformed value, expected issue path]` — the shared malformed-nested corpus. */
const MALFORMED: ReadonlyArray<[string, unknown, string]> = [
  ['null', null, '$'],
  ['an array', [VALID], '$'],
  ['a string', 'dag', '$'],
  ['missing dagId', { ...VALID, dagId: undefined }, 'dagId'],
  ['numeric dagId', { ...VALID, dagId: 7 }, 'dagId'],
  ['string version', { ...VALID, version: '1' }, 'version'],
  ['NaN version', { ...VALID, version: Number.NaN }, 'version'],
  ["status 'active'", { ...VALID, status: 'active' }, 'status'],
  ['missing status', { ...VALID, status: undefined }, 'status'],
  ['nodes as object', { ...VALID, nodes: {} }, 'nodes'],
  ['missing edges', { ...VALID, edges: undefined }, 'edges'],
  ['edges as string', { ...VALID, edges: 'a->b' }, 'edges'],
  ['node is a string', { ...VALID, nodes: ['a'] }, 'nodes[0]'],
  [
    'node missing nodeType',
    { ...VALID, nodes: [{ nodeId: 'a', dependsOn: [], config: {} }] },
    'nodes[0].nodeType',
  ],
  [
    'node dependsOn missing',
    { ...VALID, nodes: [{ nodeId: 'a', nodeType: 'x', config: {} }] },
    'nodes[0].dependsOn',
  ],
  [
    'node dependsOn with number',
    { ...VALID, nodes: [{ nodeId: 'a', nodeType: 'x', dependsOn: [1], config: {} }] },
    'nodes[0].dependsOn[0]',
  ],
  [
    'node config is an array',
    { ...VALID, nodes: [{ nodeId: 'a', nodeType: 'x', dependsOn: [], config: [] }] },
    'nodes[0].config',
  ],
  [
    'node config missing',
    { ...VALID, nodes: [{ nodeId: 'a', nodeType: 'x', dependsOn: [] }] },
    'nodes[0].config',
  ],
  [
    'node position.x string',
    { ...VALID, nodes: [{ ...VALID.nodes[0], position: { x: '1', y: 2 } }] },
    'nodes[0].position.x',
  ],
  [
    'node timeoutMs string',
    { ...VALID, nodes: [{ ...VALID.nodes[0], timeoutMs: '5' }] },
    'nodes[0].timeoutMs',
  ],
  [
    'port type outside union',
    {
      ...VALID,
      nodes: [{ ...VALID.nodes[0], outputs: [{ key: 'k', type: 'blob', required: true }] }],
    },
    'nodes[0].outputs[0].type',
  ],
  [
    'port required missing',
    { ...VALID, nodes: [{ ...VALID.nodes[0], outputs: [{ key: 'k', type: 'string' }] }] },
    'nodes[0].outputs[0].required',
  ],
  [
    'port key numeric',
    {
      ...VALID,
      nodes: [{ ...VALID.nodes[0], inputs: [{ key: 1, type: 'string', required: true }] }],
    },
    'nodes[0].inputs[0].key',
  ],
  [
    'port mimeTypes not strings',
    {
      ...VALID,
      nodes: [
        {
          ...VALID.nodes[0],
          inputs: [{ key: 'k', type: 'binary', required: true, mimeTypes: [1] }],
        },
      ],
    },
    'nodes[0].inputs[0].mimeTypes[0]',
  ],
  [
    'node costPolicy missing version',
    { ...VALID, nodes: [{ ...VALID.nodes[0], costPolicy: { runCreditLimit: 1 } }] },
    'nodes[0].costPolicy.costPolicyVersion',
  ],
  ['edge is a string', { ...VALID, edges: ['a->b'] }, 'edges[0]'],
  ['edge missing to', { ...VALID, edges: [{ from: 'a' }] }, 'edges[0].to'],
  [
    'edge bindings not array',
    { ...VALID, edges: [{ from: 'a', to: 'b', bindings: {} }] },
    'edges[0].bindings',
  ],
  [
    'edge binding missing inputKey',
    { ...VALID, edges: [{ from: 'a', to: 'b', bindings: [{ outputKey: 'o' }] }] },
    'edges[0].bindings[0].inputKey',
  ],
  ['top-level costPolicy string', { ...VALID, costPolicy: 'none' }, 'costPolicy'],
  ['inputSchema number', { ...VALID, inputSchema: 1 }, 'inputSchema'],
];

describe('decodeDagDefinition (issue #2077)', () => {
  it('round-trips a valid definition through JSON', () => {
    const result = decodeDagDefinition(JSON.parse(JSON.stringify(VALID)));
    expect(result).toEqual({ ok: true, value: VALID });
  });

  it.each(MALFORMED)('rejects %s with a path diagnostic', (_label, value, path) => {
    const result = decodeDagDefinition(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.error.map((issue) => (issue.path === '' ? '$' : issue.path));
    expect(paths).toContain(path);
  });

  it('reports every malformed field, not just the first', () => {
    const result = decodeDagDefinition({ ...VALID, dagId: 1, version: 'x', status: 'active' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.map((i) => i.path).sort()).toEqual(['dagId', 'status', 'version']);
    expect(formatDagDecodeIssues(result.error)).toMatch(/dagId: expected a string/);
  });

  it('never throws on the corpus and never lets a corpus member reach the semantic validator', () => {
    for (const [, value] of MALFORMED) {
      const result = decodeDagDefinition(value);
      expect(result.ok).toBe(false);
      // The validator assumes decoded values; the decoder is what keeps this call safe.
      if (result.ok) DagDefinitionValidator.validate(result.value);
    }
  });

  it('file-boundary allowances default an ABSENT status/edges but still reject a PRESENT wrong one', () => {
    const lenient = { absentStatus: 'draft' as const, absentEdgesAsEmpty: true };
    const absent = decodeDagDefinition({ ...VALID, status: undefined, edges: undefined }, lenient);
    expect(absent).toEqual({ ok: true, value: { ...VALID, status: 'draft', edges: [] } });
    expect(decodeDagDefinition({ ...VALID, status: 'active' }, lenient).ok).toBe(false);
    expect(decodeDagDefinition({ ...VALID, edges: null }, lenient).ok).toBe(false);
  });

  it('folds issues into the IDagError every port speaks', () => {
    const result = decodeDagDefinitionAsDagError(
      { ...VALID, nodes: [{}] },
      'CODE',
      'bad snapshot',
      {
        dagRunId: 'r',
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CODE');
    expect(result.error.category).toBe('validation');
    expect(result.error.message).toMatch(/bad snapshot: nodes\[0\]\.nodeId/);
    expect(result.error.context).toMatchObject({
      dagRunId: 'r',
      firstIssuePath: 'nodes[0].nodeId',
    });
  });
});

describe('decodeDagWorkflowFile / decodeDagRobotaCompanion (issue #2077)', () => {
  const FILE = {
    last_node_id: 2,
    last_link_id: 1,
    version: 0.4,
    nodes: [
      {
        id: 1,
        type: 'RobotaInput',
        pos: [0, 0],
        outputs: [{ name: 'text', type: 'STRING', links: [1] }],
      },
      {
        id: 2,
        type: 'RobotaTextOutput',
        pos: [10, 0],
        inputs: [{ name: 'text', type: 'STRING', link: 1 }],
      },
    ],
    links: [[1, 1, 0, 2, 0, 'STRING']],
  };

  it('round-trips a valid workflow file', () => {
    expect(decodeDagWorkflowFile(JSON.parse(JSON.stringify(FILE)))).toEqual({
      ok: true,
      value: FILE,
    });
  });

  it.each<[string, unknown, string]>([
    ['a definition file (has dagId)', { ...FILE, dagId: 'd' }, 'dagId'],
    ['a 5-tuple link', { ...FILE, links: [[1, 1, 0, 2, 0]] }, 'links[0]'],
    ['a link with a string slot', { ...FILE, links: [[1, 1, '0', 2, 0, 'STRING']] }, 'links[0][2]'],
    [
      'a node with a 3-element pos',
      { ...FILE, nodes: [{ id: 1, type: 'X', pos: [0, 0, 0] }] },
      'nodes[0].pos',
    ],
    [
      'a node input with a string link',
      {
        ...FILE,
        nodes: [{ id: 1, type: 'X', pos: [0, 0], inputs: [{ name: 'n', type: 't', link: '1' }] }],
      },
      'nodes[0].inputs[0].link',
    ],
    [
      'a node output without links',
      { ...FILE, nodes: [{ id: 1, type: 'X', pos: [0, 0], outputs: [{ name: 'n', type: 't' }] }] },
      'nodes[0].outputs[0].links',
    ],
    ['a string version', { ...FILE, version: '0.4' }, 'version'],
  ])('rejects %s with a path diagnostic', (_label, value, path) => {
    const result = decodeDagWorkflowFile(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.map((i) => i.path)).toContain(path);
  });

  it('decodes a companion and names a malformed node meta by its key', () => {
    const companion = {
      dagId: 'd',
      version: 1,
      status: 'published',
      nodes: { '1': { nodeId: 'a' } },
    };
    expect(decodeDagRobotaCompanion(companion)).toEqual({ ok: true, value: companion });
    const bad = decodeDagRobotaCompanion({ ...companion, nodes: { '1': { nodeId: 1 } } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error[0]?.path).toBe('nodes.1.nodeId');
    expect(decodeDagRobotaCompanion({ ...companion, status: 'active' }).ok).toBe(false);
  });
});
