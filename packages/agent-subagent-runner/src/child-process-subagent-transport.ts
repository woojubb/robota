import {
  BackgroundTaskError,
  type ISubagentJobStart,
  type TBackgroundTaskRunnerEvent,
} from '@robota-sdk/agent-executor';
import { killProcessTree } from '@robota-sdk/agent-process';

/** POSIX children are forked detached so a process-group kill reaps grandchildren (CORE-023). */
const SPAWN_DETACHED = process.platform !== 'win32';

/** Resolve when the child exits or after `ms` — lets the graceful IPC cancel land before signalling. */
function waitForExitOrTimeout(child: ChildProcess, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve();
    }, ms);
    timer.unref?.();
    const onExit = (): void => {
      clearTimeout(timer);
      resolve();
    };
    child.once('exit', onExit);
  });
}

import type {
  ISubagentWorkerResultMessage,
  TSubagentWorkerChildMessage,
  TSubagentWorkerParentMessage,
} from './child-process-subagent-ipc.js';
import type { TToolArgs } from '@robota-sdk/agent-core';
import type { ChildProcess } from 'node:child_process';

export interface IChildProcessRuntime {
  job: ISubagentJobStart;
  child: ChildProcess;
  killGraceMs: number;
}

export function handleWorkerMessage(
  message: TSubagentWorkerChildMessage,
  startWorker: () => void,
  resolveOnce: (result: ISubagentWorkerResultMessage) => void,
  rejectOnce: (error: Error) => void,
  emit?: (event: TBackgroundTaskRunnerEvent) => void,
): void {
  switch (message.type) {
    case 'ready':
      startWorker();
      break;
    case 'result':
      resolveOnce(message);
      break;
    case 'error':
      rejectOnce(new BackgroundTaskError('runner', message.message));
      break;
    case 'cancelled':
      rejectOnce(new BackgroundTaskError('runner', message.reason ?? 'Subagent worker cancelled'));
      break;
    case 'text_delta':
      emit?.({ type: 'background_task_text_delta', delta: message.delta });
      break;
    case 'tool_start':
      emit?.({
        type: 'background_task_tool_start',
        toolName: message.toolName,
        firstArg: extractFirstArg(message.toolArgs),
      });
      break;
    case 'tool_end':
      emit?.({
        type: 'background_task_tool_end',
        toolName: message.toolName,
        success: message.success,
      });
      break;
    default:
      rejectOnce(new BackgroundTaskError('runner', 'Unhandled subagent worker message'));
  }
}

function extractFirstArg(toolArgs?: TToolArgs): string | undefined {
  if (!toolArgs) return undefined;
  const firstValue = Object.values(toolArgs)[0];
  if (firstValue === undefined) return undefined;
  return typeof firstValue === 'object' ? JSON.stringify(firstValue) : String(firstValue);
}

export function sendWorkerMessage(
  child: ChildProcess,
  message: TSubagentWorkerParentMessage,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!child.connected) {
      reject(new BackgroundTaskError('crash', 'Subagent worker IPC channel is closed'));
      return;
    }
    child.send(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function cancelChildProcess(
  runtime: IChildProcessRuntime,
  reason?: string,
): Promise<void> {
  // CORE-023: graceful IPC cancel first (preKill), then SIGTERM→grace→SIGKILL over the process
  // group — the previous path signalled SIGTERM only and never escalated, so a worker ignoring
  // SIGTERM survived forever.
  await killProcessTree(runtime.child, {
    graceMs: runtime.killGraceMs,
    processGroup: SPAWN_DETACHED,
    preKill: async () => {
      if (!runtime.child.connected) return;
      await sendWorkerMessage(runtime.child, { type: 'cancel', reason }).catch(() => undefined);
      // Give the worker the grace window to shut down cleanly on the IPC cancel before signalling.
      await waitForExitOrTimeout(runtime.child, runtime.killGraceMs);
    },
  });
}
