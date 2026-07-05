import { describe, it, expect, vi, beforeEach } from 'vitest';
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
          { nodeId: 'input', status: 'success', outputSnapshot: JSON.stringify({ text: 'hello' }) },
          {
            nodeId: 'text-template',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'Processing: hello' }),
          },
          {
            nodeId: 'text-output',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'Processing: hello' }),
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
    buildNodeDefinitionAssembly: vi.fn().mockReturnValue({
      ok: true,
      value: {
        manifests: [
          { nodeType: 'input', defaultOutputPort: 'text' },
          { nodeType: 'text-template', defaultInputPort: 'text', defaultOutputPort: 'text' },
          { nodeType: 'text-output', defaultInputPort: 'text' },
        ],
      },
    }),
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

describe('demoCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs demo pipeline and returns success', async () => {
    const { demoCommand } = await import('../commands/demo.js');
    const io = makeIo();
    const code = await demoCommand([], { io });
    expect(code).toBe(0);
    const output = io.writes.join('');
    expect(output).toContain('demo pipeline');
    expect(output).toContain('Completed');
  });

  it('shows node outputs with checkmarks', async () => {
    const { demoCommand } = await import('../commands/demo.js');
    const io = makeIo();
    await demoCommand([], { io });
    const output = io.writes.join('');
    expect(output).toContain('input');
    expect(output).toContain('text-output');
  });

  it('returns failure when runner.run returns failed status', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            dagRun: { status: 'failed' },
            taskRuns: [{ nodeId: 'input', status: 'failed' }],
          }),
        }) as unknown as InstanceType<typeof LocalDagRunner>,
    );
    const { demoCommand } = await import('../commands/demo.js');
    const io = makeIo();
    const code = await demoCommand([], { io });
    expect(code).toBe(1);
  });

  it('handles invalid output snapshot gracefully', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            dagRun: { status: 'success' },
            taskRuns: [
              { nodeId: 'input', status: 'success', outputSnapshot: 'not-valid-json' },
              { nodeId: 'text-template', status: 'success', outputSnapshot: null },
              { nodeId: 'text-output', status: 'success', outputSnapshot: '{"count": 5}' },
            ],
          }),
        }) as unknown as InstanceType<typeof LocalDagRunner>,
    );
    const { demoCommand } = await import('../commands/demo.js');
    const io = makeIo();
    const code = await demoCommand([], { io });
    expect(code).toBe(0);
  });

  it('returns failure when runner.run throws', async () => {
    const { LocalDagRunner } = await import('../local-runner/index.js');
    vi.mocked(LocalDagRunner).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockRejectedValue(new Error('crash')),
        }) as unknown as InstanceType<typeof LocalDagRunner>,
    );
    const { demoCommand } = await import('../commands/demo.js');
    const io = makeIo();
    const code = await demoCommand([], { io });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('crash');
  });

  it('returns failure when node registry fails to assemble', async () => {
    const { buildNodeDefinitionAssembly } = await import('@robota-sdk/dag-node');
    vi.mocked(buildNodeDefinitionAssembly).mockReturnValueOnce({
      ok: false,
      error: { code: 'ASSEMBLY_ERROR' },
    } as unknown as ReturnType<typeof buildNodeDefinitionAssembly>);
    const { demoCommand } = await import('../commands/demo.js');
    const io = makeIo();
    const code = await demoCommand([], { io });
    expect(code).toBe(1);
    expect(io.writes.join('')).toContain('Failed to initialize');
  });
});
