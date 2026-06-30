/**
 * TC-01 through TC-04 for I18N-002: dag run stderr/stdout channel separation
 */
import { describe, expect, it, vi } from 'vitest';
import type { IDagCliIo } from '../types.js';
import type { LocalDagRunner } from '../local-runner/index.js';
import type { ILocalRunResult } from '../local-runner/local-dag-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSeparateIo() {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const io: IDagCliIo = {
    write: (t) => {
      stdoutChunks.push(t);
    },
    writeError: (t) => {
      stderrChunks.push(t);
    },
    readTextFile: async () => {
      throw new Error('readTextFile not expected in this test');
    },
    writeBinaryStream: async () => {},
  };
  return {
    io,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

function createMockRunner(result?: Partial<ILocalRunResult>): LocalDagRunner {
  const mockResult: ILocalRunResult = {
    dagRun: {
      dagRunId: 'run-1',
      dagId: 'test',
      version: 1,
      status: 'success',
      runKey: 'test:manual:1',
      logicalDate: new Date().toISOString(),
      trigger: 'manual',
    },
    taskRuns: [],
    ...result,
  };
  return {
    run: vi.fn().mockResolvedValue(mockResult),
    events: { subscribe: vi.fn() },
  } as unknown as LocalDagRunner;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('I18N-002 — dag run stderr channel separation', () => {
  // -------------------------------------------------------------------------
  // TC-01: invalid pipeline → usage error JSON to stderr, stdout stays clean
  // -------------------------------------------------------------------------

  it('TC-01: usage error JSON goes to stderr, not stdout', async () => {
    const { runCommand } = await import('../commands/run.js');
    const { io, stdout, stderr } = createSeparateIo();

    const exitCode = await runCommand(['--pipeline', 'no-such-node-type-xyz', '--no-auto-nodes'], {
      io,
      createRunner: createMockRunner,
    });

    expect(exitCode).not.toBe(0);
    expect(stderr()).toContain('"ok": false');
    expect(stdout()).not.toContain('"ok": false');
  });

  // -------------------------------------------------------------------------
  // TC-02: --node-config with a non-existent node → warning to stderr only
  // -------------------------------------------------------------------------

  it('TC-02: node-not-found warning goes to stderr, not stdout', async () => {
    const { runCommand } = await import('../commands/run.js');
    const { io, stdout, stderr } = createSeparateIo();

    await runCommand(
      [
        '--pipeline',
        'input | text-output',
        '--node-config',
        'nonexistent-xyz.key=val',
        '--no-auto-nodes',
      ],
      { io, createRunner: createMockRunner },
    );

    expect(stderr()).toContain('⚠ --node-config: node "nonexistent-xyz" not found');
    expect(stdout()).not.toContain('nonexistent-xyz');
  });

  // -------------------------------------------------------------------------
  // TC-03: --node-config with an unknown key → warning to stderr only
  // The `input` node has a known configSchema with `text` property;
  // `unknownKeyXyz` is not in the schema → warning fires.
  // -------------------------------------------------------------------------

  it('TC-03: unknown-config-key warning goes to stderr, not stdout', async () => {
    const { runCommand } = await import('../commands/run.js');
    const { io, stdout, stderr } = createSeparateIo();

    await runCommand(
      [
        '--pipeline',
        'input | text-output',
        '--node-config',
        'input.unknownKeyXyz=val',
        '--no-auto-nodes',
      ],
      { io, createRunner: createMockRunner },
    );

    expect(stderr()).toContain('⚠ input: unknown config key "unknownKeyXyz"');
    expect(stdout()).not.toContain('unknownKeyXyz');
  });

  // -------------------------------------------------------------------------
  // TC-04: successful run with --result → stdout contains only result text
  // -------------------------------------------------------------------------

  it('TC-04: --result stdout contains only result text, no error JSON', async () => {
    const { runCommand } = await import('../commands/run.js');
    const { io, stdout } = createSeparateIo();

    // Pipeline `input | text-output` builds nodes with IDs `input` and `text-output`
    // (first occurrence of each type uses the bare type name as nodeId).
    const mockResult: ILocalRunResult = {
      dagRun: {
        dagRunId: 'run-1',
        dagId: 'test',
        version: 1,
        status: 'success',
        runKey: 'test:manual:1',
        logicalDate: new Date().toISOString(),
        trigger: 'manual',
      },
      taskRuns: [
        {
          taskRunId: 'task-text-output',
          dagRunId: 'run-1',
          nodeId: 'text-output',
          status: 'success',
          attempt: 1,
          outputSnapshot: JSON.stringify({ text: 'Hello from test' }),
        },
      ],
    };

    const exitCode = await runCommand(
      ['--pipeline', 'input | text-output', '--result', '--no-auto-nodes'],
      { io, createRunner: () => createMockRunner(mockResult) },
    );

    expect(exitCode).toBe(0);
    expect(stdout()).toBe('Hello from test');
    expect(stdout()).not.toContain('"ok": false');
  });
});
