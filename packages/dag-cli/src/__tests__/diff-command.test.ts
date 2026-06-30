import { describe, it, expect, vi } from 'vitest';
import { diffCommand } from '../commands/diff.js';
import type { IDagCliIo } from '../types.js';

function makeIo(fileContents: Record<string, string> = {}): IDagCliIo & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    write: vi.fn((s: string) => {
      writes.push(s);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn((path: string) => {
      if (path in fileContents) {
        return Promise.resolve(fileContents[path] as string);
      }
      return Promise.reject(new Error(`ENOENT: ${path}`));
    }),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

const DAG_A = JSON.stringify({
  dagId: 'dag-a',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'in', nodeType: 'input', dependsOn: [], config: { label: 'input' } },
    { nodeId: 'out', nodeType: 'text-output', dependsOn: ['in'], config: {} },
  ],
  edges: [{ from: 'in', to: 'out' }],
});

const DAG_B = JSON.stringify({
  dagId: 'dag-b',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'in', nodeType: 'input', dependsOn: [], config: { label: 'changed' } },
    { nodeId: 'new', nodeType: 'llm-text-anthropic', dependsOn: ['in'], config: {} },
    { nodeId: 'out', nodeType: 'text-output', dependsOn: ['new'], config: {} },
  ],
  edges: [
    { from: 'in', to: 'new' },
    { from: 'new', to: 'out' },
  ],
});

describe('diffCommand - argument parsing', () => {
  it('returns error when fewer than 2 files provided', async () => {
    const io = makeIo();
    const code = await diffCommand(['a.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('two file arguments');
  });

  it('returns error when more than 2 files provided', async () => {
    const io = makeIo();
    const code = await diffCommand(['a.dag.json', 'b.dag.json', 'c.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('unexpected positional');
  });

  it('returns error for unknown flag', async () => {
    const io = makeIo();
    const code = await diffCommand(['--unknown', 'a.dag.json', 'b.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('unexpected flags');
  });

  it('returns error for --output with no value', async () => {
    const io = makeIo();
    const code = await diffCommand(['a.dag.json', 'b.dag.json', '--output'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--output requires a value');
  });

  it('returns error for --output with invalid value', async () => {
    const io = makeIo();
    const code = await diffCommand(['a.dag.json', 'b.dag.json', '--output', 'xml'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('"json" or "pretty"');
  });
});

describe('diffCommand - file I/O errors', () => {
  it('returns error when file A cannot be read', async () => {
    const io = makeIo({ 'b.dag.json': DAG_B });
    const code = await diffCommand(['missing-a.dag.json', 'b.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Failed to read file');
  });

  it('returns error when file B cannot be read', async () => {
    const io = makeIo({ 'a.dag.json': DAG_A });
    const code = await diffCommand(['a.dag.json', 'missing-b.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Failed to read file');
  });

  it('returns error when file A contains invalid JSON', async () => {
    const io = makeIo({ 'a.dag.json': 'not-json', 'b.dag.json': DAG_B });
    const code = await diffCommand(['a.dag.json', 'b.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Failed to parse JSON');
  });

  it('returns error when file contains a JSON array (not object)', async () => {
    const io = makeIo({ 'a.dag.json': '[1,2,3]', 'b.dag.json': DAG_B });
    const code = await diffCommand(['a.dag.json', 'b.dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('must contain a JSON object');
  });
});

describe('diffCommand - pretty output', () => {
  it('reports identical when two DAGs are the same', async () => {
    const io = makeIo({ 'a.dag.json': DAG_A, 'b.dag.json': DAG_A });
    const code = await diffCommand(['a.dag.json', 'b.dag.json'], { io });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('No structural difference');
  });

  it('shows added node in pretty diff', async () => {
    const io = makeIo({ 'a.dag.json': DAG_A, 'b.dag.json': DAG_B });
    const code = await diffCommand(['a.dag.json', 'b.dag.json'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('+ new');
  });

  it('shows changed node config in pretty diff', async () => {
    const io = makeIo({ 'a.dag.json': DAG_A, 'b.dag.json': DAG_B });
    const code = await diffCommand(['a.dag.json', 'b.dag.json'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('~ in.label');
  });

  it('shows edge changes in pretty diff', async () => {
    const io = makeIo({ 'a.dag.json': DAG_A, 'b.dag.json': DAG_B });
    const code = await diffCommand(['a.dag.json', 'b.dag.json'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('Edges:');
  });
});

describe('diffCommand - JSON output', () => {
  it('outputs valid JSON with --output json', async () => {
    const io = makeIo({ 'a.dag.json': DAG_A, 'b.dag.json': DAG_B });
    const code = await diffCommand(['a.dag.json', 'b.dag.json', '--output', 'json'], { io });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('').trim()) as {
      identical: boolean;
      nodes: { added: string[]; removed: string[]; changed: unknown[] };
      edges: { added: string[]; removed: string[] };
    };
    expect(parsed.identical).toBe(false);
    expect(parsed.nodes.added).toContain('new');
  });

  it('reports identical: true in JSON output when DAGs are the same', async () => {
    const io = makeIo({ 'a.dag.json': DAG_A, 'b.dag.json': DAG_A });
    const code = await diffCommand(['a.dag.json', 'b.dag.json', '--output', 'json'], { io });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('').trim()) as { identical: boolean };
    expect(parsed.identical).toBe(true);
  });
});

describe('diffCommand - edge with bindings', () => {
  it('shows edge binding details', async () => {
    const dagWithBindings = JSON.stringify({
      dagId: 'dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
        { nodeId: 'out', nodeType: 'text-output', dependsOn: ['in'], config: {} },
      ],
      edges: [{ from: 'in', to: 'out', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
    });
    const dagWithoutBindings = JSON.stringify({
      dagId: 'dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
        { nodeId: 'out', nodeType: 'text-output', dependsOn: ['in'], config: {} },
      ],
      edges: [{ from: 'in', to: 'out' }],
    });
    const io = makeIo({ 'a.dag.json': dagWithoutBindings, 'b.dag.json': dagWithBindings });
    const code = await diffCommand(['a.dag.json', 'b.dag.json'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('text→text');
  });
});

describe('diffCommand - node type change', () => {
  it('detects nodeType change between same nodeId', async () => {
    const dagTyped = JSON.stringify({
      dagId: 'dag',
      version: 1,
      status: 'draft',
      nodes: [{ nodeId: 'proc', nodeType: 'llm-text-openai', dependsOn: [], config: {} }],
      edges: [],
    });
    const dagTypedV2 = JSON.stringify({
      dagId: 'dag',
      version: 1,
      status: 'draft',
      nodes: [{ nodeId: 'proc', nodeType: 'llm-text-anthropic', dependsOn: [], config: {} }],
      edges: [],
    });
    const io = makeIo({ 'a.dag.json': dagTyped, 'b.dag.json': dagTypedV2 });
    const code = await diffCommand(['a.dag.json', 'b.dag.json'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('nodeType');
  });
});
