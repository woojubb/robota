/**
 * Tests for runner.ts — the main CLI dispatcher.
 * All subcommand handlers are mocked so these tests only cover routing logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all heavy dependencies that would make network/FS calls
vi.mock('../commands/run.js', () => ({
  runCommand: vi.fn().mockResolvedValue(0),
  applyEnvFile: vi.fn().mockResolvedValue(undefined),
  extractFinalOutput: vi.fn().mockReturnValue(null),
}));
vi.mock('../commands/validate.js', () => ({ validateCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/node.js', () => ({ nodeCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/init.js', () => ({ initCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/mcp.js', () => ({
  mcpCommand: vi.fn().mockResolvedValue(0),
  createLocalMcpServer: vi.fn(),
}));
vi.mock('../commands/catalog.js', () => ({ catalogCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/template.js', () => ({ templateCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/migrate.js', () => ({ runMigrateCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/doctor.js', () => ({ doctorCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/build.js', () => ({ buildCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/convert.js', () => ({ convertCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/diff.js', () => ({ diffCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/cost.js', () => ({ runCostCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/share.js', () => ({ shareCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/demo.js', () => ({ demoCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/explain.js', () => ({ explainCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/compare.js', () => ({ compareCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/tutorial.js', () => ({ tutorialCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/lock.js', () => ({ lockCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/telemetry.js', () => ({ telemetryCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/lint.js', () => ({ lintCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/keys.js', () => ({ keysCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/benchmark.js', () => ({ benchmarkCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/perf.js', () => ({ perfCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/aav.js', () => ({ aavCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/pipe.js', () => ({ pipeCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/save.js', () => ({ saveCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/alias.js', () => ({ aliasCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/from-mermaid.js', () => ({
  fromMermaidCommand: vi.fn().mockResolvedValue(0),
}));
vi.mock('../commands/describe.js', () => ({ describeCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/fix.js', () => ({ fixCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/studio.js', () => ({ studioCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../commands/view.js', () => ({ viewCommand: vi.fn().mockResolvedValue(0) }));
vi.mock('../telemetry.js', () => ({
  recordTelemetry: vi.fn().mockResolvedValue(undefined),
  isTelemetryEnabled: vi.fn().mockResolvedValue(false),
  readTelemetryConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock('@robota-sdk/dag-orchestration-client', () => ({
  DagOrchestrationHttpClient: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../runner-dispatch.js', () => ({
  dispatchDagCliCommand: vi.fn().mockResolvedValue({ payload: { ok: true }, exitCode: 0 }),
}));

import { runDagCli, toServerExitCode } from '../runner.js';
import type { IDagCliIo } from '../types.js';

function makeMockIo(): IDagCliIo & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write: vi.fn((msg: string) => {
      written.push(msg);
    }),
    writeError: vi.fn(),
    readTextFile: vi.fn(),
    writeBinaryStream: vi.fn(),
  };
}

describe('runDagCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows help text when no args given', async () => {
    const io = makeMockIo();
    const code = await runDagCli([], { io });
    expect(code).toBe(0);
    expect(io.written.join('')).toContain('dag');
  });

  it('shows help text with --help flag', async () => {
    const io = makeMockIo();
    const code = await runDagCli(['--help'], { io });
    expect(code).toBe(0);
    expect(io.written.join('')).toContain('dag');
  });

  it('shows help text with -h flag', async () => {
    const io = makeMockIo();
    const code = await runDagCli(['-h'], { io });
    expect(code).toBe(0);
  });

  it('routes "run" to runCommand', async () => {
    const { runCommand } = await import('../commands/run.js');
    const io = makeMockIo();
    await runDagCli(['run', 'workflow.dag.json'], { io });
    expect(runCommand).toHaveBeenCalled();
  });

  it('routes "validate" to validateCommand', async () => {
    const { validateCommand } = await import('../commands/validate.js');
    const io = makeMockIo();
    await runDagCli(['validate', 'workflow.dag.json'], { io });
    expect(validateCommand).toHaveBeenCalled();
  });

  it('routes "node" to nodeCommand', async () => {
    const { nodeCommand } = await import('../commands/node.js');
    const io = makeMockIo();
    await runDagCli(['node', 'list'], { io });
    expect(nodeCommand).toHaveBeenCalled();
  });

  it('routes "init" to initCommand', async () => {
    const { initCommand } = await import('../commands/init.js');
    const io = makeMockIo();
    await runDagCli(['init'], { io });
    expect(initCommand).toHaveBeenCalled();
  });

  it('routes "mcp" to mcpCommand', async () => {
    const { mcpCommand } = await import('../commands/mcp.js');
    const io = makeMockIo();
    await runDagCli(['mcp'], { io });
    expect(mcpCommand).toHaveBeenCalled();
  });

  it('routes "catalog" to catalogCommand', async () => {
    const { catalogCommand } = await import('../commands/catalog.js');
    const io = makeMockIo();
    await runDagCli(['catalog', 'list'], { io });
    expect(catalogCommand).toHaveBeenCalled();
  });

  it('routes "template" to templateCommand', async () => {
    const { templateCommand } = await import('../commands/template.js');
    const io = makeMockIo();
    await runDagCli(['template', 'list'], { io });
    expect(templateCommand).toHaveBeenCalled();
  });

  it('routes "migrate" to runMigrateCommand', async () => {
    const { runMigrateCommand } = await import('../commands/migrate.js');
    const io = makeMockIo();
    await runDagCli(['migrate', 'workflow.dag.json'], { io });
    expect(runMigrateCommand).toHaveBeenCalled();
  });

  it('routes "doctor" to doctorCommand', async () => {
    const { doctorCommand } = await import('../commands/doctor.js');
    const io = makeMockIo();
    await runDagCli(['doctor'], { io });
    expect(doctorCommand).toHaveBeenCalled();
  });

  it('routes "build" to buildCommand', async () => {
    const { buildCommand } = await import('../commands/build.js');
    const io = makeMockIo();
    await runDagCli(['build'], { io });
    expect(buildCommand).toHaveBeenCalled();
  });

  it('routes "convert" to convertCommand', async () => {
    const { convertCommand } = await import('../commands/convert.js');
    const io = makeMockIo();
    await runDagCli(['convert'], { io });
    expect(convertCommand).toHaveBeenCalled();
  });

  it('routes "diff" to diffCommand', async () => {
    const { diffCommand } = await import('../commands/diff.js');
    const io = makeMockIo();
    await runDagCli(['diff'], { io });
    expect(diffCommand).toHaveBeenCalled();
  });

  it('routes "cost" to runCostCommand', async () => {
    const { runCostCommand } = await import('../commands/cost.js');
    const io = makeMockIo();
    await runDagCli(['cost'], { io });
    expect(runCostCommand).toHaveBeenCalled();
  });

  it('routes "share" to shareCommand', async () => {
    const { shareCommand } = await import('../commands/share.js');
    const io = makeMockIo();
    await runDagCli(['share'], { io });
    expect(shareCommand).toHaveBeenCalled();
  });

  it('routes "demo" to demoCommand', async () => {
    const { demoCommand } = await import('../commands/demo.js');
    const io = makeMockIo();
    await runDagCli(['demo'], { io });
    expect(demoCommand).toHaveBeenCalled();
  });

  it('routes "explain" to explainCommand', async () => {
    const { explainCommand } = await import('../commands/explain.js');
    const io = makeMockIo();
    await runDagCli(['explain'], { io });
    expect(explainCommand).toHaveBeenCalled();
  });

  it('routes "compare" to compareCommand', async () => {
    const { compareCommand } = await import('../commands/compare.js');
    const io = makeMockIo();
    await runDagCli(['compare'], { io });
    expect(compareCommand).toHaveBeenCalled();
  });

  it('routes "tutorial" to tutorialCommand', async () => {
    const { tutorialCommand } = await import('../commands/tutorial.js');
    const io = makeMockIo();
    await runDagCli(['tutorial'], { io });
    expect(tutorialCommand).toHaveBeenCalled();
  });

  it('routes "lock" to lockCommand', async () => {
    const { lockCommand } = await import('../commands/lock.js');
    const io = makeMockIo();
    await runDagCli(['lock'], { io });
    expect(lockCommand).toHaveBeenCalled();
  });

  it('routes "telemetry" to telemetryCommand', async () => {
    const { telemetryCommand } = await import('../commands/telemetry.js');
    const io = makeMockIo();
    await runDagCli(['telemetry', 'status'], { io });
    expect(telemetryCommand).toHaveBeenCalled();
  });

  it('routes "lint" to lintCommand', async () => {
    const { lintCommand } = await import('../commands/lint.js');
    const io = makeMockIo();
    await runDagCli(['lint'], { io });
    expect(lintCommand).toHaveBeenCalled();
  });

  it('routes "keys" to keysCommand', async () => {
    const { keysCommand } = await import('../commands/keys.js');
    const io = makeMockIo();
    await runDagCli(['keys'], { io });
    expect(keysCommand).toHaveBeenCalled();
  });

  it('routes "benchmark" to benchmarkCommand', async () => {
    const { benchmarkCommand } = await import('../commands/benchmark.js');
    const io = makeMockIo();
    await runDagCli(['benchmark'], { io });
    expect(benchmarkCommand).toHaveBeenCalled();
  });

  it('routes "perf" to perfCommand', async () => {
    const { perfCommand } = await import('../commands/perf.js');
    const io = makeMockIo();
    await runDagCli(['perf'], { io });
    expect(perfCommand).toHaveBeenCalled();
  });

  it('routes "aav" to aavCommand', async () => {
    const { aavCommand } = await import('../commands/aav.js');
    const io = makeMockIo();
    await runDagCli(['aav'], { io });
    expect(aavCommand).toHaveBeenCalled();
  });

  it('routes "pipe" to pipeCommand', async () => {
    const { pipeCommand } = await import('../commands/pipe.js');
    const io = makeMockIo();
    await runDagCli(['pipe'], { io });
    expect(pipeCommand).toHaveBeenCalled();
  });

  it('routes "save" to saveCommand', async () => {
    const { saveCommand } = await import('../commands/save.js');
    const io = makeMockIo();
    await runDagCli(['save'], { io });
    expect(saveCommand).toHaveBeenCalled();
  });

  it('routes "alias" to aliasCommand', async () => {
    const { aliasCommand } = await import('../commands/alias.js');
    const io = makeMockIo();
    await runDagCli(['alias'], { io });
    expect(aliasCommand).toHaveBeenCalled();
  });

  it('routes "from-mermaid" to fromMermaidCommand', async () => {
    const { fromMermaidCommand } = await import('../commands/from-mermaid.js');
    const io = makeMockIo();
    await runDagCli(['from-mermaid'], { io });
    expect(fromMermaidCommand).toHaveBeenCalled();
  });

  it('routes "describe" to describeCommand', async () => {
    const { describeCommand } = await import('../commands/describe.js');
    const io = makeMockIo();
    await runDagCli(['describe'], { io });
    expect(describeCommand).toHaveBeenCalled();
  });

  it('routes "fix" to fixCommand', async () => {
    const { fixCommand } = await import('../commands/fix.js');
    const io = makeMockIo();
    await runDagCli(['fix'], { io });
    expect(fixCommand).toHaveBeenCalled();
  });

  it('routes "studio" to studioCommand', async () => {
    const { studioCommand } = await import('../commands/studio.js');
    const io = makeMockIo();
    await runDagCli(['studio'], { io });
    expect(studioCommand).toHaveBeenCalled();
  });

  it('routes "view" to viewCommand', async () => {
    const { viewCommand } = await import('../commands/view.js');
    const io = makeMockIo();
    await runDagCli(['view', 'workflow.dag.json'], { io });
    expect(viewCommand).toHaveBeenCalled();
  });

  it('routes "run" with --server flag through HTTP client dispatch', async () => {
    const { runCommand } = await import('../commands/run.js');
    const { dispatchDagCliCommand } = await import('../runner-dispatch.js');
    const io = makeMockIo();
    await runDagCli(['run', '--server', 'workflow.dag.json'], { io });
    // With --server flag, should NOT call runCommand
    expect(runCommand).not.toHaveBeenCalled();
    // Should go through dispatchDagCliCommand
    expect(dispatchDagCliCommand).toHaveBeenCalled();
  });

  it('dispatches to HTTP client for unknown subcommand with server URL', async () => {
    const { dispatchDagCliCommand } = await import('../runner-dispatch.js');
    const io = makeMockIo();
    await runDagCli(['run', '--server', 'http://localhost:3000', 'workflow.dag.json'], {
      io,
      env: { ROBOTA_DAG_SERVER_URL: 'http://localhost:3000' },
    });
    expect(dispatchDagCliCommand).toHaveBeenCalled();
  });

  it('appends doctor footer to error output in non-CI non-doctor context', async () => {
    const { validateCommand } = await import('../commands/validate.js');
    vi.mocked(validateCommand).mockImplementationOnce(async (_args, opts) => {
      opts.io.write('Error: something went wrong\n');
      return 1;
    });

    const io = makeMockIo();
    delete process.env['CI'];
    await runDagCli(['validate', 'bad.dag.json'], { io });
    const output = io.written.join('');
    expect(output).toContain('dag doctor');
  });

  it('does NOT append doctor footer for doctor subcommand itself', async () => {
    const { doctorCommand } = await import('../commands/doctor.js');
    vi.mocked(doctorCommand).mockImplementationOnce(async (_args, opts) => {
      opts.io.write('Error: something\n');
      return 1;
    });

    const io = makeMockIo();
    await runDagCli(['doctor'], { io });
    const output = io.written.join('');
    // doctor footer should NOT be appended
    expect(output).not.toContain('dag doctor');
  });
});

describe('toServerExitCode', () => {
  it('returns 0 for true', () => {
    expect(toServerExitCode(true)).toBe(0);
  });

  it('returns 1 for false', () => {
    expect(toServerExitCode(false)).toBe(1);
  });
});
