/**
 * CLI-1994: how a fork job's conversation reaches the CHILD process.
 *
 * Only the id crossed the wire (ARCH-044) — the copy `/fork` wrote stays in the session store on the
 * far side, and this is where the id becomes the conversation again. Beside the worker rather than
 * inside it for the same reason the start-payload projection sits beside the wire vocabulary: "how a
 * fork job resumes its record" is a different question from "how a worker process runs a job", and
 * the worker is already at the anti-monolith limit.
 *
 * The store is opened for the PARENT's cwd (`request.cwd`), not the execution root: a
 * worktree-isolated child runs in a directory that holds no session records of its own.
 */

import { restoreSessionRecordIntoSession } from '@robota-sdk/agent-framework';

import type { ISubagentWorkerStartPayload } from './child-process-subagent-ipc.js';
import type { ISubagentWorkerComposition, TResumeSessionStore } from './worker-composition.js';
import type { createSubagentSession } from '@robota-sdk/agent-framework';

/**
 * Restore the record a job names into the freshly built child, before its first turn.
 *
 * A job that names no record returns immediately — the ordinary subagent, unchanged. A composition
 * that opens no store FAILS the job, naming the seam to register: starting the child empty would be
 * a fork that silently forgot its parent, and a caller has no way to detect that afterwards.
 */
export function resumeRequestedRecord(
  payload: ISubagentWorkerStartPayload,
  childSession: ReturnType<typeof createSubagentSession>,
  resumeSessionStore: TResumeSessionStore | undefined,
): void {
  const resumeSessionId = payload.request.resumeSessionId;
  if (resumeSessionId === undefined) return;
  if (resumeSessionStore === undefined) {
    throw new Error(
      `subagent worker: job ${payload.taskId} asks to resume session ${resumeSessionId}, but this ` +
        'composition opens no session store. Register ISubagentWorkerComposition.openSessionStore ' +
        'at the composition root — the same place providerDefinitions is registered.',
    );
  }
  restoreSessionRecordIntoSession(resumeSessionStore, resumeSessionId, childSession);
}

/** Open the store once so the resumed child can both restore and persist its copied record. */
export function openResumeSessionStore(
  payload: ISubagentWorkerStartPayload,
  composition: ISubagentWorkerComposition,
): TResumeSessionStore | undefined {
  const resumeSessionId = payload.request.resumeSessionId;
  if (resumeSessionId === undefined) return undefined;
  if (composition.openSessionStore === undefined) {
    throw new Error(
      `subagent worker: job ${payload.taskId} asks to resume session ${resumeSessionId}, but this ` +
        'composition opens no session store. Register ISubagentWorkerComposition.openSessionStore ' +
        'at the composition root — the same place providerDefinitions is registered.',
    );
  }
  return composition.openSessionStore({ cwd: payload.request.cwd });
}
