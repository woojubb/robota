import type { ChildProcess } from 'node:child_process';
import type { TToolArgs } from '@robota-sdk/agent-core';
import {
  BackgroundTaskError,
  type ISubagentJobStart,
  type TBackgroundTaskRunnerEvent,
} from '@robota-sdk/agent-runtime';
import type {
  TSubagentWorkerChildMessage,
  TSubagentWorkerParentMessage,
} from './child-process-subagent-ipc.js';

export interface IChildProcessRuntime {
  job: ISubagentJobStart;
  child: ChildProcess;
  killGraceMs: number;
  killTimer?: ReturnType<typeof setTimeout>;
}

export function handleWorkerMessage(
  message: TSubagentWorkerChildMessage,
  startWorker: () => void,
  resolveOnce: (output: string) => void,
  rejectOnce: (error: Error) => void,
  emit?: (event: TBackgroundTaskRunnerEvent) => void,
): void {
  switch (message.type) {
    case 'ready':
      startWorker();
      break;
    case 'result':
      resolveOnce(message.output);
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
  if (runtime.child.connected) {
    await sendWorkerMessage(runtime.child, { type: 'cancel', reason }).catch(() => undefined);
  }
  runtime.killTimer = setTimeout(() => {
    if (!runtime.child.killed) {
      runtime.child.kill('SIGTERM');
    }
  }, runtime.killGraceMs);
}
