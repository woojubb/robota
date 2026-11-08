/**
 * The parent's side of a follow-up prompt to a child-process job.
 *
 * `send` resolves when the child says it queued the prompt, and rejects when it says it can take no
 * more (it has begun to finish) or when the child is gone before it answered — so a caller is never
 * told a prompt was taken that the child dropped. There is no timeout on purpose: a child that has
 * stopped answering is ended by the job's own watchdogs, which settles every send still waiting, and
 * a timeout would leave a prompt that may still run reported as failed.
 */

import { BackgroundTaskError } from '@robota-sdk/agent-executor';

import { isSubagentWorkerChildMessage } from './child-process-subagent-ipc.js';
import { sendWorkerMessage } from './child-process-subagent-transport.js';

import type { TSubagentWorkerWireValue } from './child-process-subagent-ipc.js';
import type { ChildProcess } from 'node:child_process';

interface IPendingSend {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

/** Sends `prompt`s to `child` and answers each once the child has said what became of it. */
export function createSendChannel(child: ChildProcess): (prompt: string) => Promise<void> {
  const pending = new Map<number, IPendingSend>();
  let nextId = 0;
  const settleAll = (reason: string): void => {
    for (const waiting of pending.values()) waiting.reject(new BackgroundTaskError('crash', reason));
    pending.clear();
  };
  child.on('message', (message: TSubagentWorkerWireValue) => {
    if (!isSubagentWorkerChildMessage(message)) return;
    if (message.type !== 'send_accepted' && message.type !== 'send_refused') return;
    const waiting = pending.get(message.sendId);
    if (waiting === undefined) return;
    pending.delete(message.sendId);
    if (message.type === 'send_accepted') waiting.resolve();
    else {
      waiting.reject(
        new BackgroundTaskError('runner', 'The job is finishing; it takes no more input.'),
      );
    }
  });
  const gone = (): void => settleAll('The job ended before it took the prompt.');
  child.once('exit', gone);
  child.once('disconnect', gone);
  child.once('error', gone);
  return (prompt) =>
    new Promise<void>((resolve, reject) => {
      nextId += 1;
      const sendId = nextId;
      pending.set(sendId, { resolve, reject });
      sendWorkerMessage(child, { type: 'send', prompt, sendId }).catch((error: unknown) => {
        pending.delete(sendId);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
}
