/**
 * Tests for the `dag cost estimate` command (runCostCommand).
 * Exercises the main happy paths and error paths.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IDagCliIo } from '../types.js';

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

function makeIo(readContent = ''): IDagCliIo & { writes: string[]; errors: string[] } {
  const writes: string[] = [];
  const errors: string[] = [];
  return {
    writes,
    errors,
    write: vi.fn((s: string) => {
      writes.push(s);
    }),
    writeError: vi.fn((s: string) => {
      errors.push(s);
    }),
    readTextFile: vi.fn().mockResolvedValue(readContent),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// DAG fixtures
// ---------------------------------------------------------------------------

const DAG_INPUT_OUTPUT_ONLY = JSON.stringify({
  dagId: 'simple-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'text-output', nodeType: 'text-output', dependsOn: ['input'], config: {} },
  ],
  edges: [
    { from: 'input', to: 'text-output', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
  ],
});

const DAG_WITH_ANTHROPIC_HAIKU = JSON.stringify({
  dagId: 'anthropic-haiku-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    {
      nodeId: 'llm',
      nodeType: 'llm-text-anthropic',
      dependsOn: ['input'],
      config: { model: 'claude-haiku-4-5' },
    },
    { nodeId: 'text-output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
  ],
  edges: [],
});

const DAG_WITH_DEEPSEEK = JSON.stringify({
  dagId: 'deepseek-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    {
      nodeId: 'llm-deepseek',
      nodeType: 'llm-text-deepseek',
      dependsOn: ['input'],
      config: { model: 'deepseek-chat' },
    },
    { nodeId: 'text-output', nodeType: 'text-output', dependsOn: ['llm-deepseek'], config: {} },
  ],
  edges: [],
});

const DAG_WITH_QWEN = JSON.stringify({
  dagId: 'qwen-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    {
      nodeId: 'llm-qwen',
      nodeType: 'llm-text-qwen',
      dependsOn: ['input'],
      config: { model: 'qwen-plus' },
    },
    { nodeId: 'text-output', nodeType: 'text-output', dependsOn: ['llm-qwen'], config: {} },
  ],
  edges: [],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runCostCommand — no args (help path)', () => {
  it('dag cost with no args returns a non-zero code with a usage message', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    const code = await runCostCommand([], { io });
    // Current implementation returns USAGE_ERROR_EXIT_CODE (2) for missing subcommand
    expect(code).toBe(2);
    const out = io.writes.join('');
    expect(out).toContain('cost subcommand');
  });
});

describe('runCostCommand — dag cost estimate (no file)', () => {
  it('returns usage error code 2 when no file is provided', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    const code = await runCostCommand(['estimate'], { io });
    expect(code).toBe(2);
    const out = io.writes.join('');
    expect(out).toContain('requires <file>');
  });
});

describe('runCostCommand — file not found', () => {
  it('returns exit code 2 when file cannot be read', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo('');
    io.readTextFile = vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory'));
    const code = await runCostCommand(['estimate', 'nonexistent.dag.json'], { io });
    expect(code).toBe(2);
    const out = io.writes.join('');
    expect(out).toContain('Failed to read file');
    expect(out).toContain('nonexistent.dag.json');
  });
});

describe('runCostCommand — LLM node DAG produces positive cost', () => {
  it('returns totalUsd > 0 for a DAG with an Anthropic LLM node', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(DAG_WITH_ANTHROPIC_HAIKU);
    const code = await runCostCommand(['estimate', 'haiku.dag.json', '--output', 'json'], { io });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as { ok: boolean; totalUsd: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.totalUsd).toBeGreaterThan(0);
  });

  it('returns totalUsd > 0 for a DAG with a DeepSeek LLM node', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(DAG_WITH_DEEPSEEK);
    const code = await runCostCommand(['estimate', 'deepseek.dag.json', '--output', 'json'], {
      io,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as { ok: boolean; totalUsd: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.totalUsd).toBeGreaterThan(0);
  });

  it('returns totalUsd > 0 for a DAG with a Qwen LLM node', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(DAG_WITH_QWEN);
    const code = await runCostCommand(['estimate', 'qwen.dag.json', '--output', 'json'], { io });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as { ok: boolean; totalUsd: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.totalUsd).toBeGreaterThan(0);
  });
});

describe('runCostCommand — input + text-output only DAG has zero cost', () => {
  it('returns totalUsd === 0 for a DAG with only input and text-output nodes', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(DAG_INPUT_OUTPUT_ONLY);
    const code = await runCostCommand(['estimate', 'simple.dag.json', '--output', 'json'], { io });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as { ok: boolean; totalUsd: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.totalUsd).toBe(0);
  });
});

describe('runCostCommand — --output json format', () => {
  it('outputs valid JSON with dagId, nodes array, and totalUsd when --output json is used', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(DAG_WITH_ANTHROPIC_HAIKU);
    const code = await runCostCommand(['estimate', 'haiku.dag.json', '--output', 'json'], { io });
    expect(code).toBe(0);
    const raw = io.writes.join('');
    const parsed = JSON.parse(raw) as {
      ok: boolean;
      dagId: string;
      nodes: Array<{ nodeId: string; nodeType: string; estimatedUsd: number }>;
      totalUsd: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.dagId).toBe('anthropic-haiku-dag');
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(parsed.nodes.length).toBe(3);
    expect(typeof parsed.totalUsd).toBe('number');
    // LLM node should have non-zero cost
    const llmNode = parsed.nodes.find((n) => n.nodeType === 'llm-text-anthropic');
    expect(llmNode).toBeDefined();
    expect(llmNode!.estimatedUsd).toBeGreaterThan(0);
  });

  it('all non-LLM nodes have estimatedUsd === 0 in JSON output', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo(DAG_INPUT_OUTPUT_ONLY);
    const code = await runCostCommand(['estimate', 'simple.dag.json', '--output', 'json'], { io });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as {
      nodes: Array<{ nodeType: string; estimatedUsd: number }>;
    };
    for (const node of parsed.nodes) {
      expect(node.estimatedUsd).toBe(0);
    }
  });
});
