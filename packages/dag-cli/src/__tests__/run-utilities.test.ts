/**
 * Unit tests for exported utility functions from run.ts and benchmark.ts
 * that are not covered by run-command.test.ts or compare-benchmark.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
  access: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
  rename: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// applyEnvFile
// ---------------------------------------------------------------------------

describe('applyEnvFile', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv['TEST_APPLY_KEY'] = process.env['TEST_APPLY_KEY'];
    savedEnv['QUOTED_KEY'] = process.env['QUOTED_KEY'];
    savedEnv['SINGLE_QUOTED_KEY'] = process.env['SINGLE_QUOTED_KEY'];
    delete process.env['TEST_APPLY_KEY'];
    delete process.env['QUOTED_KEY'];
    delete process.env['SINGLE_QUOTED_KEY'];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it('sets environment variables from file content', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue('TEST_APPLY_KEY=hello_world\n' as never);

    const { applyEnvFile } = await import('../commands/run.js');
    await applyEnvFile('.env');

    expect(process.env['TEST_APPLY_KEY']).toBe('hello_world');
  });

  it('strips surrounding double-quotes from values', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue('QUOTED_KEY="quoted value"\n' as never);

    const { applyEnvFile } = await import('../commands/run.js');
    await applyEnvFile('.env');

    expect(process.env['QUOTED_KEY']).toBe('quoted value');
  });

  it('strips surrounding single-quotes from values', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue("SINGLE_QUOTED_KEY='single value'\n" as never);

    const { applyEnvFile } = await import('../commands/run.js');
    await applyEnvFile('.env');

    expect(process.env['SINGLE_QUOTED_KEY']).toBe('single value');
  });

  it('skips comment lines starting with #', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(
      '# This is a comment\nTEST_APPLY_KEY=from_env\n' as never,
    );

    const { applyEnvFile } = await import('../commands/run.js');
    await applyEnvFile('.env');

    expect(process.env['TEST_APPLY_KEY']).toBe('from_env');
  });

  it('does not override already-set environment variables', async () => {
    process.env['TEST_APPLY_KEY'] = 'already_set';
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue('TEST_APPLY_KEY=new_value\n' as never);

    const { applyEnvFile } = await import('../commands/run.js');
    await applyEnvFile('.env');

    expect(process.env['TEST_APPLY_KEY']).toBe('already_set');
  });

  it('silently returns when file does not exist', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const { applyEnvFile } = await import('../commands/run.js');
    await expect(applyEnvFile('.env')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// appendRunHistory
// ---------------------------------------------------------------------------

describe('appendRunHistory', () => {
  it('writes a new history file when none exists', async () => {
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const { appendRunHistory } = await import('../commands/run.js');
    await appendRunHistory('workflow.dag.json', 'success');

    expect(vi.mocked(writeFile)).toHaveBeenCalled();
    const callArgs = vi.mocked(writeFile).mock.calls[0];
    const content = callArgs?.[1] as string;
    const parsed = JSON.parse(content) as Array<{ file: string; status: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]?.file).toBe('workflow.dag.json');
    expect(parsed[0]?.status).toBe('success');
  });

  it('appends to existing history file', async () => {
    const existing = JSON.stringify([
      { file: 'old.dag.json', date: '2024-01-01', status: 'success' },
    ]);
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(existing as never);
    vi.mocked(writeFile).mockClear().mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const { appendRunHistory } = await import('../commands/run.js');
    await appendRunHistory('new.dag.json', 'failed');

    expect(vi.mocked(writeFile)).toHaveBeenCalled();
    const callArgs = vi.mocked(writeFile).mock.calls[0];
    const content = callArgs?.[1] as string;
    const parsed = JSON.parse(content) as Array<{ file: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[1]?.file).toBe('new.dag.json');
  });
});

// ---------------------------------------------------------------------------
// benchmark --save and --baseline flags (via compare-benchmark test infra)
// ---------------------------------------------------------------------------

vi.mock('../local-runner/index.js', async () => {
  const actual = await vi.importActual<typeof import('../local-runner/index.js')>(
    '../local-runner/index.js',
  );
  return {
    ...actual,
    createCliNodeRegistry: vi.fn(() => []),
    LocalDagRunner: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        dagRun: { dagRunId: 'run-1', status: 'success' },
        taskRuns: [
          {
            nodeId: 'output',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'bench-result' }),
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

const MINIMAL_DAG = JSON.stringify({
  dagId: 'bench-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'input', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'output', nodeType: 'text-output', dependsOn: ['input'], config: {} },
  ],
  edges: [{ from: 'input', to: 'output' }],
});

import type { IDagCliIo } from '../types.js';

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

describe('benchmarkCommand --save flag', () => {
  it('saves history when --save is provided', async () => {
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '1', '--save'], { io });
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('Saved to');
  });

  it('shows trend when history has multiple entries', async () => {
    const existing = JSON.stringify({
      file: 'workflow.dag.json',
      history: [
        { date: '2024-01-01T00:00:00Z', runs: 2, avgMs: 100, p95Ms: 150, costUsd: 0.001 },
        { date: '2024-01-02T00:00:00Z', runs: 2, avgMs: 120, p95Ms: 180, costUsd: 0.001 },
      ],
    });
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(existing as never);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['workflow.dag.json', '--runs', '1', '--save'], { io });
    expect(code).toBe(0);
    const out = io.writes.join('');
    // Should include trend info since history has entries
    expect(out).toContain('Saved to');
  });
});

describe('benchmarkCommand --baseline flag', () => {
  it('compares against a saved baseline JSON file', async () => {
    const baseline = JSON.stringify({
      latencyMs: { avg: 100, p95: 150 },
      costUsd: { avg: 0.001 },
    });

    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    // Return baseline only for baseline path, reject for history
    vi.mocked(readFile).mockImplementation(async (path: unknown) => {
      if (typeof path === 'string' && path.includes('baseline')) {
        return baseline as never;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(
      ['workflow.dag.json', '--runs', '1', '--baseline', 'baseline.json'],
      { io },
    );
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('baseline');
  });

  it('reports warning when baseline file cannot be read', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(
      ['workflow.dag.json', '--runs', '1', '--baseline', 'missing-baseline.json'],
      { io },
    );
    expect(code).toBe(0);
    const out = io.writes.join('');
    expect(out).toContain('missing-baseline.json');
  });
});
