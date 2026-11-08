/**
 * `exit` is not ordered against a child's IPC channel: a `result` the worker had already written and
 * flushed can still be unread when the parent is told the worker exited. These cases deliver the
 * events in that order to the real result controller, so the order is not left to the host's
 * scheduling.
 */
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChildProcessSubagentResult } from '../child-process-subagent-runner-result.js';

import type { ISubagentJobStart } from '@robota-sdk/agent-executor';
import type { ChildProcess } from 'node:child_process';

import type { ISubagentWorkerStartPayload } from '../child-process-subagent-ipc.js';

/** Longer than the controller's wait for a channel to close after `exit`. */
const PAST_THE_EXIT_WAIT_MS = 10_000;

const job: ISubagentJobStart = {
  taskId: 'agent_1',
  request: {
    permissionPolicy: 'inherit-allowlist',
    agentType: 'tester',
    label: 'Tester',
    parentSessionId: 'session_1',
    mode: 'background',
    depth: 1,
    cwd: process.cwd(),
    prompt: 'do work',
  },
};

/** A child that is only an event source: these cases never start it, they only report what it did. */
class FakeChild extends EventEmitter {
  connected = true;

  closeChannel(): void {
    this.connected = false;
    this.emit('disconnect');
  }
}

function startJob(child: FakeChild) {
  return createChildProcessSubagentResult({
    runtime: { job, child: child as unknown as ChildProcess, killGraceMs: 10 },
    payload: new Promise<ISubagentWorkerStartPayload>(() => undefined),
    resolveTranscriptPath: () => undefined,
    permissionAbort: new AbortController(),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a worker reported as exited before its result was read', () => {
  it('still delivers a result that arrives after the exit, before the channel closes', async () => {
    const child = new FakeChild();
    const result = startJob(child);

    child.emit('exit', 0, null);
    child.emit('message', { type: 'result', output: 'done' });
    child.closeChannel();

    await expect(result).resolves.toEqual({ taskId: 'agent_1', output: 'done' });
  });

  it('reports a worker that exited without a result once its channel has closed', async () => {
    const child = new FakeChild();
    const result = startJob(child);

    child.emit('exit', 1, null);
    child.closeChannel();

    await expect(result).rejects.toThrow('Subagent worker exited before result: exit code 1');
  });

  it('reports a worker whose channel was already closed at exit without waiting', async () => {
    const child = new FakeChild();
    const result = startJob(child);

    child.connected = false;
    child.emit('exit', 0, null);

    await expect(result).rejects.toThrow('Subagent worker exited before result: exit code 0');
  });

  it('reports a worker whose channel never closes after the wait', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const result = startJob(child);
    const failed = expect(result).rejects.toThrow('Subagent worker exited before result: signal');

    child.emit('exit', null, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(PAST_THE_EXIT_WAIT_MS);

    await failed;
  });
});
