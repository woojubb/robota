import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import type { LocalDagRunner } from '../local-runner/index.js';
import { runCommand } from '../commands/run.js';
import { runsCommand } from '../commands/runs.js';

let testDir: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (testDir !== undefined) await rm(testDir, { recursive: true, force: true });
  testDir = undefined;
});

async function enterTempProject(): Promise<string> {
  testDir = await mkdtemp(join(tmpdir(), 'dag-runs-command-'));
  // Worker threads cannot chdir; keep real SQLite I/O under a per-test project root.
  vi.spyOn(process, 'cwd').mockReturnValue(testDir);
  return testDir;
}

const definition: IDagDefinition = {
  dagId: 'history-dag',
  version: 1,
  status: 'draft',
  nodes: [],
  edges: [],
};

function captureIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      write: (text: string) => { stdout.push(text); },
      writeError: (text: string) => { stderr.push(text); },
      readTextFile: async () => JSON.stringify(definition),
      writeBinaryStream: async () => {},
    },
  };
}

describe('local run history', () => {
  it('lists a completed dag run with the existing JSON fields', async () => {
    await enterTempProject();
    const runIo = captureIo();
    const runner = {
      events: { subscribe: vi.fn() },
      run: vi.fn().mockResolvedValue({
        dagRun: { dagRunId: 'history-run-1', dagId: 'history-dag', status: 'success' },
        taskRuns: [],
      }),
    } as unknown as LocalDagRunner;

    expect(await runCommand(['workflow.dag.json', '--output', 'json', '--no-cta', '--no-cost-warning'], {
      io: runIo.io,
      createRunner: () => runner,
    })).toBe(0);

    const listIo = captureIo();
    expect(await runsCommand(['list', '--output', 'json'], { io: listIo.io })).toBe(0);
    const rows = JSON.parse(listIo.stdout.join('')) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      runId: 'history-run-1',
      dagId: 'history-dag',
      status: 'completed',
      completedAt: expect.any(Number),
      durationMs: expect.any(Number),
    });
  });

  it('records failed results and rejected executions, and applies phase and limit', async () => {
    await enterTempProject();
    const runIo = captureIo();
    const results = [
      { dagRun: { dagRunId: 'success-1', dagId: 'history-dag', status: 'success' }, taskRuns: [] },
      { dagRun: { dagRunId: 'failed-1', dagId: 'history-dag', status: 'failed' }, taskRuns: [] },
    ];
    const runner = {
      events: { subscribe: vi.fn() },
      run: vi.fn()
        .mockResolvedValueOnce(results[0])
        .mockResolvedValueOnce(results[1])
        .mockRejectedValueOnce(new Error('execution failed')),
    } as unknown as LocalDagRunner;
    const args = ['workflow.dag.json', '--output', 'json', '--no-cta', '--no-cost-warning'];
    const options = { io: runIo.io, createRunner: () => runner };
    expect(await runCommand(args, options)).toBe(0);
    expect(await runCommand(args, options)).toBe(1);
    expect(await runCommand(args, options)).toBe(1);

    const failedIo = captureIo();
    expect(await runsCommand(['list', '--phase', 'failed', '--output', 'json'], { io: failedIo.io })).toBe(0);
    const failed = JSON.parse(failedIo.stdout.join('')) as { runId: string; status: string }[];
    expect(failed).toHaveLength(2);
    expect(failed.map((entry) => entry.runId)).toContain('failed-1');
    expect(failed.every((entry) => entry.status === 'failed')).toBe(true);

    const limitedIo = captureIo();
    expect(await runsCommand(['list', '--limit', '1', '--output', 'json'], { io: limitedIo.io })).toBe(0);
    expect(JSON.parse(limitedIo.stdout.join(''))).toHaveLength(1);

    const completedIo = captureIo();
    expect(await runsCommand(['list', '--phase', 'completed', '--output', 'json'], { io: completedIo.io })).toBe(0);
    expect((JSON.parse(completedIo.stdout.join('')) as { runId: string }[]).map((entry) => entry.runId)).toEqual(['success-1']);
  });

  it('reports SQLite write and read failures with nonzero exit codes', async () => {
    const projectDir = await enterTempProject();
    await mkdir(join(projectDir, '.dag/runs.db'), { recursive: true });
    const runIo = captureIo();
    const runner = {
      events: { subscribe: vi.fn() },
      run: vi.fn().mockResolvedValue({
        dagRun: { dagRunId: 'unrecorded', dagId: 'history-dag', status: 'success' },
        taskRuns: [],
      }),
    } as unknown as LocalDagRunner;
    expect(await runCommand(['workflow.dag.json', '--output', 'json', '--no-cta', '--no-cost-warning'], {
      io: runIo.io,
      createRunner: () => runner,
    })).toBe(1);
    expect(runIo.stderr.join('')).toContain('failed to record local run history');

    const listIo = captureIo();
    expect(await runsCommand(['list', '--output', 'json'], { io: listIo.io })).toBe(1);
    expect(listIo.stderr.join('')).toContain('failed to read local run history');
  });
});
