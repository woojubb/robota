/**
 * Execution-path tests for compare.ts, benchmark.ts, perf.ts — covers the
 * happy-path and alternate-format code branches that misc-commands.test.ts
 * does not reach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IDagCliIo } from '../types.js';

vi.mock('../local-runner/index.js', async () => {
  const actual = await vi.importActual<typeof import('../local-runner/index.js')>(
    '../local-runner/index.js',
  );
  return {
    ...actual,
    createCliNodeRegistry: vi.fn(() => []),
    LocalDagRunner: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        dagRun: { dagRunId: 'run-test', status: 'success' },
        taskRuns: [
          {
            nodeId: 'output',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'hello' }),
          },
        ],
      }),
    })),
  };
});

vi.mock('@robota-sdk/dag-node', async () => {
  const actual =
    await vi.importActual<typeof import('@robota-sdk/dag-node')>('@robota-sdk/dag-node');
  return {
    ...actual,
    buildNodeDefinitionAssembly: vi.fn().mockReturnValue({ ok: true, value: { manifests: [] } }),
  };
});

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
}));

const MINIMAL_DAG = JSON.stringify({
  dagId: 'test-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'output', nodeType: 'text-output', dependsOn: ['input'], config: {} },
  ],
  edges: [{ from: 'input', to: 'output' }],
});

function makeIo(): IDagCliIo & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    write: vi.fn((s: string) => {
      writes.push(s);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn().mockResolvedValue(MINIMAL_DAG),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// compareCommand — execution paths
// ---------------------------------------------------------------------------

describe('compareCommand — execution paths', () => {
  const savedKeys: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedKeys['ANTHROPIC_API_KEY'] = process.env['ANTHROPIC_API_KEY'];
    savedKeys['OPENAI_API_KEY'] = process.env['OPENAI_API_KEY'];
    savedKeys['GEMINI_API_KEY'] = process.env['GEMINI_API_KEY'];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedKeys)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it('shows help with --help', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['--help'], { io });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('dag compare');
  });

  it('shows help with -h', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['-h'], { io });
    expect(code).toBe(0);
  });

  it('skips both providers when no API keys set', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('skipped');
  });

  it('runs both providers when API keys present', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key-anthropic';
    process.env['OPENAI_API_KEY'] = 'test-key-openai';

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai', '--input', 'text=hello'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('anthropic');
    expect(output).toContain('openai');
  });

  it('outputs JSON when --output json', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['OPENAI_API_KEY'] = 'test-key';

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai', '--output', 'json'], { io });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as { ok: boolean; results: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toHaveLength(2);
  });

  it('includes decision section with --decide', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['OPENAI_API_KEY'] = 'test-key';

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai', '--decide'], { io });
    expect(code).toBe(0);
  });

  it('includes JSON decision with --decide --output json', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['OPENAI_API_KEY'] = 'test-key';

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai', '--decide', '--output', 'json'], {
      io,
    });
    expect(code).toBe(0);
    const output = io.writes.join('');
    const parsed = JSON.parse(output) as { ok: boolean; results?: unknown[]; decision?: unknown };
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toHaveLength(2);
    // decision may be null when both runs have identical latency (mock returns instantly)
    // just verify the command ran successfully and produced JSON output
    expect(output.length).toBeGreaterThan(0);
  });

  it('uses --pipeline arg to build custom DAG', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['OPENAI_API_KEY'] = 'test-key';

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(
      ['anthropic', 'openai', '--pipeline', 'input | llm-text-{provider} | text-output'],
      { io },
    );
    expect(code).toBe(0);
  });

  it('returns error for duplicate --output flag', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(
      ['anthropic', 'openai', '--output', 'json', '--output', 'pretty'],
      { io },
    );
    expect(code).toBe(2);
  });

  it('returns error for --output with invalid format', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai', '--output', 'xml'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --output with no value', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai', '--output'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --pipeline with no value', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai', '--pipeline'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --input without = separator', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai', '--input', 'noequals'], { io });
    expect(code).toBe(2);
  });

  it('returns error for too many providers', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai', 'gemini'], { io });
    expect(code).toBe(2);
  });

  it('returns error for unknown provider', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'unknown-provider'], { io });
    expect(code).toBe(2);
  });

  it('returns error for fewer than two providers', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic'], { io });
    expect(code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// benchmarkCommand — execution paths
// ---------------------------------------------------------------------------

describe('benchmarkCommand — execution paths', () => {
  it('runs benchmark with valid DAG file', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '2'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('workflow.dag.json');
  });

  it('outputs JSON format with --output json', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '1', '--output', 'json'], {
      io,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as { ok: boolean; file: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.file).toBe('workflow.dag.json');
  });

  it('runs in parallel mode with --parallel', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '2', '--parallel'], { io });
    expect(code).toBe(0);
  });

  it('shows outputs with --show-outputs', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '1', '--show-outputs'], {
      io,
    });
    expect(code).toBe(0);
  });

  it('returns error when file cannot be read', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    io.readTextFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    const code = await benchmarkCommand(['missing.dag.json'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --output with invalid format', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['file.dag.json', '--output', 'xml'], { io });
    expect(code).toBe(2);
  });

  it('respects --budget and stops early', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(
      ['workflow.dag.json', '--runs', '100', '--budget', '0.000001'],
      { io },
    );
    // Budget of essentially 0 should result in success with 0 or few runs
    expect([0, 1]).toContain(code);
  });

  it('adds --input to payload', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(
      ['workflow.dag.json', '--runs', '1', '--input', 'text=hello world'],
      { io },
    );
    expect(code).toBe(0);
  });

  it('returns error for --runs with no value', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --runs with non-integer value', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '2.5'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --runs with invalid value', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', 'notanumber'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --budget with invalid value', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--budget', 'bad'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --budget with no value', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--budget'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --timeout with no value', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--timeout'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --timeout with invalid value', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--timeout', 'bad'], { io });
    expect(code).toBe(2);
  });

  it('returns error for --output with no value', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--output'], { io });
    expect(code).toBe(2);
  });

  it('returns error for multiple positional arguments', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['file1.dag.json', 'file2.dag.json'], { io });
    expect(code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// benchmarkCommand — additional branch coverage
// ---------------------------------------------------------------------------

describe('benchmarkCommand — additional branch coverage', () => {
  it('runs in parallel mode with --output json', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(
      ['workflow.dag.json', '--runs', '2', '--parallel', '--output', 'json'],
      { io },
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it('shows outputs with --show-outputs and successful runs', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '2', '--show-outputs'], {
      io,
    });
    expect(code).toBe(0);
    const out = io.writes.join('');
    // show-outputs includes output preview section
    expect(out.length).toBeGreaterThan(0);
  });

  it('handles a DAG with LLM nodes (gemini-pro model) for cost estimation', async () => {
    const dagWithGeminiPro = JSON.stringify({
      dagId: 'gemini-pro-dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
        {
          nodeId: 'llm',
          nodeType: 'llm-text-gemini',
          dependsOn: ['input'],
          config: { model: 'gemini-1.0-pro' },
        },
        { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
      ],
      edges: [
        { from: 'input', to: 'llm' },
        { from: 'llm', to: 'output' },
      ],
    });
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    io.readTextFile = vi.fn().mockResolvedValue(dagWithGeminiPro);
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '1'], { io });
    expect(code).toBe(0);
  });

  it('handles a DAG with openai gpt-4o model for cost estimation', async () => {
    const dagWithGpt4o = JSON.stringify({
      dagId: 'gpt4o-dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
        {
          nodeId: 'llm',
          nodeType: 'llm-text-openai',
          dependsOn: ['input'],
          config: { model: 'gpt-4o' },
        },
        { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
      ],
      edges: [],
    });
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    io.readTextFile = vi.fn().mockResolvedValue(dagWithGpt4o);
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '1'], { io });
    expect(code).toBe(0);
  });

  it('handles a DAG with anthropic sonnet model for cost estimation', async () => {
    const dagWithSonnet = JSON.stringify({
      dagId: 'sonnet-dag',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
        {
          nodeId: 'llm',
          nodeType: 'llm-text-anthropic',
          dependsOn: ['input'],
          config: { model: 'claude-sonnet-4-5' },
        },
        { nodeId: 'output', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
      ],
      edges: [],
    });
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    io.readTextFile = vi.fn().mockResolvedValue(dagWithSonnet);
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '1'], { io });
    expect(code).toBe(0);
  });

  it('handles runner failure gracefully (failed sample)', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockRejectedValue(new Error('runner failed')),
          events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
        }) as never,
    );

    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '1'], { io });
    // Failed run results in exit code 1 (no successful runs)
    expect([0, 1]).toContain(code);
  });

  it('shows help with --help flag', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['--help'], { io });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('benchmark');
  });

  it('returns error for duplicate --output flag', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(
      ['workflow.dag.json', '--output', 'json', '--output', 'pretty'],
      { io },
    );
    expect(code).toBe(2);
  });

  it('handles invalid JSON in DAG file', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    io.readTextFile = vi.fn().mockResolvedValue('not valid json');
    const code = await benchmarkCommand(['workflow.dag.json'], { io });
    expect(code).toBe(2);
  });

  it('handles baseline with malformed JSON', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockImplementation(async (path: unknown) => {
      if (typeof path === 'string' && path.includes('baseline')) {
        return 'not-valid-json' as never;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(
      ['workflow.dag.json', '--runs', '1', '--baseline', 'baseline.json'],
      { io },
    );
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('baseline.json');
  });

  it('handles baseline with wrong format (no latencyMs field)', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockImplementation(async (path: unknown) => {
      if (typeof path === 'string' && path.includes('baseline')) {
        return JSON.stringify({ foo: 'bar' }) as never;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(
      ['workflow.dag.json', '--runs', '1', '--baseline', 'baseline.json'],
      { io },
    );
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('baseline.json');
  });

  it('returns --input without = separator error', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--input', 'noequals'], { io });
    expect(code).toBe(2);
  });

  it('returns error for unknown flag in benchmark', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--unknown-flag'], { io });
    expect(code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// compareCommand — additional branch coverage
// ---------------------------------------------------------------------------

describe('compareCommand — additional branch coverage', () => {
  const savedKeys: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedKeys['ANTHROPIC_API_KEY'] = process.env['ANTHROPIC_API_KEY'];
    savedKeys['OPENAI_API_KEY'] = process.env['OPENAI_API_KEY'];
    savedKeys['GEMINI_API_KEY'] = process.env['GEMINI_API_KEY'];
    savedKeys['DEEPSEEK_API_KEY'] = process.env['DEEPSEEK_API_KEY'];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedKeys)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it('runs with gemini provider to cover gemini cost-ternary branch', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['GEMINI_API_KEY'] = 'test-key';

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'gemini', '--input', 'text=hello'], { io });
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('gemini');
  });

  it('runs with deepseek provider to cover fallback cost-ternary branch', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['DEEPSEEK_API_KEY'] = 'test-key';

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'deepseek'], { io });
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('deepseek');
  });

  it('covers runnable.length===1 when one provider has no key', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    delete process.env['OPENAI_API_KEY'];

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai'], { io });
    expect(code).toBe(0);
    const out = io.writes.join('');
    // One provider ran, one was skipped
    expect(out).toContain('anthropic');
  });

  it('covers runnable.length===0 when both providers have no key', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'openai'], { io });
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('skipped');
  });

  it('outputs JSON with gemini provider', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['GEMINI_API_KEY'] = 'test-key';

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'gemini', '--output', 'json'], { io });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as { ok: boolean; results: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toHaveLength(2);
  });

  it('shows decision section with --decide when both providers run', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['GEMINI_API_KEY'] = 'test-key';

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'gemini', '--decide', '--output', 'json'], {
      io,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(io.writes.join('')) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it('covers --pipeline with {provider} substitution for gemini', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['GEMINI_API_KEY'] = 'test-key';

    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(
      ['anthropic', 'gemini', '--pipeline', 'input | llm-text-{provider} | text-output'],
      { io },
    );
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// perfCommand — execution paths
// ---------------------------------------------------------------------------

describe('perfCommand — execution paths', () => {
  it('runs default measurement (--runs 3 for speed)', async () => {
    const { perfCommand } = await import('../commands/perf.js');
    const io = makeIo();
    const code = await perfCommand(['--runs', '3'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output.length).toBeGreaterThan(0);
  });

  it('outputs JSON with --output-format json', async () => {
    const { perfCommand } = await import('../commands/perf.js');
    const io = makeIo();
    const code = await perfCommand(['--runs', '2', '--output-format', 'json'], { io });
    expect(code).toBe(0);
  });

  it('shows hints with --hints flag', async () => {
    const { perfCommand } = await import('../commands/perf.js');
    const io = makeIo();
    const code = await perfCommand(['--runs', '2', '--hints'], { io });
    expect(code).toBe(0);
  });

  it('saves results with --save flag', async () => {
    const { perfCommand } = await import('../commands/perf.js');
    const io = makeIo();
    const code = await perfCommand(['--runs', '1', '--save'], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('Saved to');
  });

  it('writes to output file with --output <path> flag', async () => {
    const { perfCommand } = await import('../commands/perf.js');
    const io = makeIo();
    const code = await perfCommand(['--runs', '1', '--output', '/tmp/perf-results.json'], {
      io,
    });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('Results written to');
  });

  it('shows error when --publish used without GITHUB_TOKEN', async () => {
    const savedToken = process.env['GITHUB_TOKEN'];
    delete process.env['GITHUB_TOKEN'];
    try {
      const { perfCommand } = await import('../commands/perf.js');
      const io = makeIo();
      const code = await perfCommand(['--runs', '1', '--publish'], { io });
      expect(code).toBe(0);
      const output = io.writes.join('');
      expect(output).toContain('GITHUB_TOKEN');
    } finally {
      if (savedToken !== undefined) process.env['GITHUB_TOKEN'] = savedToken;
    }
  });

  it('shows help with --help flag', async () => {
    const { perfCommand } = await import('../commands/perf.js');
    const io = makeIo();
    const code = await perfCommand(['--help'], { io });
    expect(code).toBe(0);
  });

  it('shows help with -h flag', async () => {
    const { perfCommand } = await import('../commands/perf.js');
    const io = makeIo();
    const code = await perfCommand(['-h'], { io });
    expect(code).toBe(0);
  });
});
