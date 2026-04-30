import type { ChildProcess } from 'node:child_process';
import { BackgroundTaskError, type ISubagentJobStart } from '@robota-sdk/agent-sdk';
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
    case 'tool_start':
    case 'tool_end':
      break;
    default:
      rejectOnce(new BackgroundTaskError('runner', 'Unhandled subagent worker message'));
  }
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
