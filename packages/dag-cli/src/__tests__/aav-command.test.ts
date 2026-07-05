import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aavCommand } from '../commands/aav.js';
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
        dagRun: { dagRunId: 'run-1', status: 'success' },
        taskRuns: [
          { nodeId: 'input', status: 'success', outputSnapshot: JSON.stringify({ text: 'ok' }) },
          {
            nodeId: 'llm-text-anthropic',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'result' }),
          },
          {
            nodeId: 'text-output',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'done' }),
          },
        ],
      }),
    })),
  };
});

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

describe('aavCommand - help', () => {
  it('prints help with --help', async () => {
    const io = makeIo();
    const code = await aavCommand(['--help'], { io });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('dag aav');
  });

  it('prints help with -h', async () => {
    const io = makeIo();
    const code = await aavCommand(['-h'], { io });
    expect(code).toBe(0);
    expect(io.writes.join('')).toContain('dag aav');
  });
});

describe('aavCommand - argument errors', () => {
  it('returns error for --pipeline with no value', async () => {
    const io = makeIo();
    const code = await aavCommand(['--pipeline'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--pipeline requires a value');
  });

  it('returns error for --input with no value', async () => {
    const io = makeIo();
    const code = await aavCommand(['--input'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('--input requires a value');
  });

  it('returns error for unknown flag', async () => {
    const io = makeIo();
    const code = await aavCommand(['--unknown'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('unexpected flags');
  });

  it('returns error when pipeline has only 1 node', async () => {
    const io = makeIo();
    const code = await aavCommand(['--pipeline', 'input'], { io });
    expect(code).toBe(2);
    expect(io.writes.join('')).toContain('at least 2 nodes');
  });
});

describe('aavCommand - execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs with default pipeline and returns success', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            dagRun: { status: 'success' },
            taskRuns: [
              { nodeId: 'input', status: 'success' },
              { nodeId: 'llm-text-anthropic', status: 'success' },
              { nodeId: 'text-output', status: 'success' },
            ],
          }),
        }) as unknown as InstanceType<typeof LocalDagRunner>,
    );

    const io = makeIo();
    const code = await aavCommand([], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('Total time');
    expect(output).toContain('AAV');
  });

  it('runs with --json flag', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            dagRun: { status: 'success' },
            taskRuns: [
              { nodeId: 'input', status: 'success' },
              { nodeId: 'llm-text-anthropic', status: 'success' },
              { nodeId: 'text-output', status: 'success' },
            ],
          }),
        }) as unknown as InstanceType<typeof LocalDagRunner>,
    );

    const io = makeIo();
    const code = await aavCommand(['--json'], { io });
    expect(code).toBe(0);
    const combined = io.writes.join('').trim();
    const parsed = JSON.parse(combined) as {
      pipeline: string;
      totalMs: number;
      ok: boolean;
    };
    expect(parsed.pipeline).toContain('input');
    expect(parsed.ok).toBe(true);
    expect(typeof parsed.totalMs).toBe('number');
  });

  it('runs with custom --pipeline and --input', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            dagRun: { status: 'success' },
            taskRuns: [
              { nodeId: 'input', status: 'success' },
              { nodeId: 'text-output', status: 'success' },
            ],
          }),
        }) as unknown as InstanceType<typeof LocalDagRunner>,
    );

    const io = makeIo();
    const code = await aavCommand(['--pipeline', 'input | text-output', '--input', 'hello world'], {
      io,
    });
    expect(code).toBe(0);
  });

  it('reports failure when some nodes do not complete', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            dagRun: { status: 'failed' },
            taskRuns: [
              { nodeId: 'input', status: 'success' },
              { nodeId: 'llm-text-anthropic', status: 'failed' },
              { nodeId: 'text-output', status: 'failed' },
            ],
          }),
        }) as unknown as InstanceType<typeof LocalDagRunner>,
    );

    const io = makeIo();
    const code = await aavCommand([], { io });
    expect(code).toBe(1);
    const output = io.writes.join('');
    expect(output).toContain('node(s) did not complete');
  });

  it('returns failure when runner.run throws', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockRejectedValue(new Error('network error')),
        }) as unknown as InstanceType<typeof LocalDagRunner>,
    );

    const io = makeIo();
    const code = await aavCommand([], { io });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('network error');
  });

  it('returns failure when runner.run throws a non-Error (covers String(runErr) branch)', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockRejectedValue('non-error string thrown'),
        }) as unknown as InstanceType<typeof LocalDagRunner>,
    );

    const io = makeIo();
    const code = await aavCommand([], { io });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('non-error string thrown');
  });

  it('builds dag with special-char node types (covers fallback nodeId branch)', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            dagRun: { status: 'success' },
            taskRuns: [
              { nodeId: 'node-0', status: 'success' },
              { nodeId: 'node-1', status: 'success' },
            ],
          }),
        }) as unknown as InstanceType<typeof LocalDagRunner>,
    );

    const io = makeIo();
    // Node types with only special chars become empty string after replace, triggering fallback nodeId
    const code = await aavCommand(['--pipeline', '!!! | ???'], { io });
    expect(typeof code).toBe('number');
  });
});
