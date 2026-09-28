import { afterEach, describe, expect, it, vi } from 'vitest';

const runner = vi.hoisted(() => ({ runSubagentWorkerMain: vi.fn() }));
const core = vi.hoisted(() => ({ startCliCore: vi.fn(async () => undefined) }));

vi.mock('@robota-sdk/agent-subagent-runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-subagent-runner')>()),
  runSubagentWorkerMain: runner.runSubagentWorkerMain,
}));
vi.mock('../cli-core.js', () => ({ startCliCore: core.startCliCore }));

const { SUBAGENT_WORKER_MODE_FLAG } = await import('@robota-sdk/agent-subagent-runner');
const { startCli } = await import('../cli.js');

describe('startCli() from an embedder’s own entry', () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    vi.clearAllMocks();
  });

  it('runs the subagent worker when started again as one, instead of a second CLI', async () => {
    process.argv = ['node', '/embedder/entry.js', SUBAGENT_WORKER_MODE_FLAG];

    await startCli();

    expect(runner.runSubagentWorkerMain).toHaveBeenCalledTimes(1);
    expect(core.startCliCore).not.toHaveBeenCalled();
  });

  it('starts the CLI otherwise', async () => {
    process.argv = ['node', '/embedder/entry.js'];

    await startCli();

    expect(core.startCliCore).toHaveBeenCalledTimes(1);
    expect(runner.runSubagentWorkerMain).not.toHaveBeenCalled();
  });
});
