import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertCommand, convertMermaid } from '../commands/convert.js';
import type { IDagCliIo } from '../types.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

function makeIo(): IDagCliIo & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    write: vi.fn((s: string) => {
      writes.push(s);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn(),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

describe('convertMermaid (unit)', () => {
  it('parses a simple graph LR with two nodes', () => {
    const input = `graph LR
  A[input] --> B[text-output]`;
    const spec = convertMermaid(input);
    expect(spec.nodes).toHaveLength(2);
    expect(spec.nodes[0]).toEqual({ type: 'input', id: 'A' });
    expect(spec.nodes[1]).toEqual({ type: 'text-output', id: 'B' });
    expect(spec.edges).toHaveLength(1);
    expect(spec.edges[0]).toBe('A→B');
  });

  it('parses chained edges A --> B --> C', () => {
    const input = `graph LR
  A[input] --> B[process] --> C[text-output]`;
    const spec = convertMermaid(input);
    expect(spec.nodes).toHaveLength(3);
    expect(spec.edges).toHaveLength(2);
    expect(spec.edges[0]).toBe('A→B');
    expect(spec.edges[1]).toBe('B→C');
  });

  it('handles nodes without brackets (id = type)', () => {
    const input = `graph LR
  input --> output`;
    const spec = convertMermaid(input);
    expect(spec.nodes[0]).toEqual({ type: 'input' });
    expect(spec.nodes[1]).toEqual({ type: 'output' });
  });

  it('handles edges with labels -->|label|', () => {
    const input = `graph LR
  A[input] -->|text| B[text-output]`;
    const spec = convertMermaid(input);
    expect(spec.edges[0]).toBe('A→B');
  });

  it('ignores graph header and comments', () => {
    const input = `%% comment
graph TD
  %% another comment
  A[input] --> B[output]`;
    const spec = convertMermaid(input);
    expect(spec.nodes).toHaveLength(2);
  });

  it('handles standalone node declarations', () => {
    const input = `graph LR
  A[standalone-node]
  A --> B[output]`;
    const spec = convertMermaid(input);
    expect(spec.nodes).toHaveLength(2);
    expect(spec.nodes[0]).toEqual({ type: 'standalone-node', id: 'A' });
  });

  it('deduplicates node references across edges', () => {
    const input = `graph LR
  A[input] --> B[process]
  B[process] --> C[output]`;
    const spec = convertMermaid(input);
    expect(spec.nodes).toHaveLength(3);
  });

  it('returns empty nodes/edges for empty input', () => {
    const spec = convertMermaid('');
    expect(spec.nodes).toHaveLength(0);
    expect(spec.edges).toHaveLength(0);
  });
});

describe('convertCommand - argument parsing', () => {
  it('returns error when --from is missing', async () => {
    const io = makeIo();
    const code = await convertCommand([], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--from is required');
  });

  it('returns error when --from has invalid value', async () => {
    const io = makeIo();
    const code = await convertCommand(['--from', 'csv'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('"linear" or "mermaid"');
  });

  it('returns error when --from has no value (followed by flag)', async () => {
    const io = makeIo();
    const code = await convertCommand(['--from', '--input'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--from requires a value');
  });

  it('returns error when --from has no value (end of args)', async () => {
    const io = makeIo();
    const code = await convertCommand(['--from'], { io });
    expect(code).toBe(2);
  });

  it('returns error when --input has no value', async () => {
    const io = makeIo();
    const code = await convertCommand(['--from', 'linear', '--input'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--input requires a value');
  });

  it('returns error for unexpected --flag', async () => {
    const io = makeIo();
    const code = await convertCommand(['--from', 'linear', '--unknown'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('unexpected flag');
  });
});

describe('convertCommand - linear format', () => {
  it('converts linear input to JSON', async () => {
    const io = makeIo();
    const code = await convertCommand(['--from', 'linear', '--input', 'input,llm,output'], {
      io,
    });
    expect(code).toBe(0);
    const output = JSON.parse(io.writes.join('').trim()) as {
      nodes: unknown[];
      edges: unknown[];
    };
    expect(output.nodes).toHaveLength(3);
    expect(output.edges).toHaveLength(2);
  });

  it('returns error when input is empty', async () => {
    const io = makeIo();
    const code = await convertCommand(['--from', 'linear', '--input', '   '], { io });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('No input provided');
  });

  it('returns error when linear input produces no nodes', async () => {
    const io = makeIo();
    const code = await convertCommand(['--from', 'linear', '--input', ',,,'], { io });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('No nodes found');
  });
});

describe('convertCommand - mermaid format', () => {
  it('converts mermaid input to JSON', async () => {
    const io = makeIo();
    const mermaid = 'graph LR\n  A[input] --> B[output]';
    const code = await convertCommand(['--from', 'mermaid', '--input', mermaid], { io });
    expect(code).toBe(0);
    const output = JSON.parse(io.writes.join('').trim()) as {
      nodes: unknown[];
      edges: unknown[];
    };
    expect(output.nodes).toHaveLength(2);
  });

  it('returns error when mermaid produces no nodes', async () => {
    const io = makeIo();
    const code = await convertCommand(['--from', 'mermaid', '--input', 'graph LR\n  %% nothing'], {
      io,
    });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('No nodes found');
  });
});

describe('convertCommand - file positional', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
  });

  it('reads file when positional arg appears before --from flag', async () => {
    vi.mocked(readFile).mockResolvedValue('input,process,output' as unknown as string);
    const io = makeIo();
    // positional arg must appear before --from so args.find() picks it up
    const code = await convertCommand(['myfile.txt', '--from', 'linear'], { io });
    expect(code).toBe(0);
    expect(readFile).toHaveBeenCalledWith('myfile.txt', 'utf8');
  });

  it('returns error when positional file cannot be read', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    const io = makeIo();
    const code = await convertCommand(['missing.txt', '--from', 'linear'], { io });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('Could not read file');
  });
});
