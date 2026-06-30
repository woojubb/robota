/**
 * Lightweight tests for argument-parsing and help paths of several command modules.
 * These exercise the outer function entry points, achieving function coverage,
 * without triggering heavy I/O or network calls.
 */
import { describe, it, expect, vi } from 'vitest';
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
        dagRun: { status: 'success' },
        taskRuns: [],
      }),
    })),
  };
});

vi.mock('@robota-sdk/dag-node', async () => {
  const actual =
    await vi.importActual<typeof import('@robota-sdk/dag-node')>('@robota-sdk/dag-node');
  return {
    ...actual,
    buildNodeDefinitionAssembly: vi.fn().mockReturnValue({
      ok: true,
      value: { manifests: [] },
    }),
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

function makeIo(): IDagCliIo & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    write: vi.fn((s: string) => {
      writes.push(s);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn().mockRejectedValue(new Error('not found')),
    writeBinaryStream: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// perfCommand
// ---------------------------------------------------------------------------

describe('perfCommand', () => {
  it('prints help with --help', async () => {
    const { perfCommand } = await import('../commands/perf.js');
    const io = makeIo();
    const code = await perfCommand(['--help'], { io });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('dag perf');
  });

  it('prints help with -h', async () => {
    const { perfCommand } = await import('../commands/perf.js');
    const io = makeIo();
    const code = await perfCommand(['-h'], { io });
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tutorialCommand
// ---------------------------------------------------------------------------

describe('tutorialCommand - non-interactive', () => {
  it('runs environment check in --non-interactive mode', async () => {
    const { tutorialCommand } = await import('../commands/tutorial.js');
    const io = makeIo();
    const code = await tutorialCommand(['--non-interactive'], { io, cwd: '/tmp/fake' });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('Node.js');
  });
});

// ---------------------------------------------------------------------------
// runCostCommand (cost.ts)
// ---------------------------------------------------------------------------

describe('runCostCommand', () => {
  it('returns error when no subcommand given', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo();
    const code = await runCostCommand([], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Unknown cost subcommand');
  });

  it('returns error when "estimate" subcommand has no file', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo();
    const code = await runCostCommand(['estimate'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('requires <file>');
  });

  it('returns error for --output with invalid format', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo();
    const code = await runCostCommand(['estimate', '--output', 'xml', 'dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('json');
    expect(io.writes.join('')).toContain('pretty');
  });

  it('returns error for unexpected flags', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo();
    const code = await runCostCommand(['estimate', '--weird', 'dag.json'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('unexpected flags');
  });

  it('returns error when file cannot be read', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeIo();
    io.readTextFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
    const code = await runCostCommand(['estimate', 'missing.dag.json'], { io });
    expect(code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// shareCommand / generateShareText
// ---------------------------------------------------------------------------

describe('generateShareText', () => {
  it('generates a share text string from dagId and node count', async () => {
    const { generateShareText } = await import('../commands/share.js');
    const text = generateShareText('my-dag', 0, 2);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('my-dag');
  });
});

describe('shareCommand', () => {
  it('returns error when no file argument provided', async () => {
    const { shareCommand } = await import('../commands/share.js');
    const io = makeIo();
    const code = await shareCommand([], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('file');
  });

  it('returns help with --help', async () => {
    const { shareCommand } = await import('../commands/share.js');
    const io = makeIo();
    const code = await shareCommand(['--help'], { io });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('dag share');
  });

  it('returns failure when GITHUB_TOKEN is missing (with file arg)', async () => {
    const { shareCommand } = await import('../commands/share.js');
    const savedToken = process.env['GITHUB_TOKEN'];
    delete process.env['GITHUB_TOKEN'];
    const io = makeIo();
    const code = await shareCommand(['some.dag.json'], { io });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('GITHUB_TOKEN');
    if (savedToken !== undefined) process.env['GITHUB_TOKEN'] = savedToken;
  });
});

// ---------------------------------------------------------------------------
// compareCommand
// ---------------------------------------------------------------------------

describe('compareCommand', () => {
  it('returns error when fewer than 2 providers provided', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('two provider arguments');
  });

  it('returns error for unknown provider', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['anthropic', 'unknownai'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('Unknown provider');
  });

  it('returns error for unexpected flags', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeIo();
    const code = await compareCommand(['--weird', 'anthropic', 'openai'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('unexpected flags');
  });
});

// ---------------------------------------------------------------------------
// benchmarkCommand
// ---------------------------------------------------------------------------

describe('benchmarkCommand', () => {
  it('prints help with --help', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['--help'], { io });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('benchmark');
  });

  it('returns error for unknown subcommand', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeIo();
    const code = await benchmarkCommand(['--unknown-flag'], { io });
    expect(code).toBe(2);
  });
});
