/**
 * CLI-1994: how a fork job's conversation reaches the CHILD process.
 *
 * From a plain parent only the id crossed the wire (ARCH-044) — the copy `/fork` wrote stays in the
 * session store on the far side, and this is where the id becomes the conversation again. A sealing
 * parent also hands over the record it holds (`resumeHeld`), since a child never holds the keys that
 * open a sealed one; the store takes it before the restore reads the record. Beside the worker rather
 * than inside it for the same reason the start-payload projection sits beside the wire vocabulary:
 * "how a fork job resumes its record" is a different question from "how a worker process runs a
 * job", and the worker is already at the anti-monolith limit.
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
  try {
    // The child's own writer read: of the record its parent handed it when the parent seals — the
    // owner's only on the parent's word, which the store keeps — or else of the plain file.
    restoreSessionRecordIntoSession(
      resumeSessionStore,
      resumeSessionId,
      childSession,
      resumeSessionStore.load(resumeSessionId, { hold: true }),
    );
  } catch (error) {
    const refusal = sealedRecordRefusal(payload, resumeSessionId, resumeSessionStore);
    if (refusal !== undefined) throw new Error(refusal);
    throw error;
  }
}

/**
 * Why a sealed record could not be resumed here, in words that fit a subagent process: it holds no
 * keys and has no way to unlock, so the only unlock it names is the parent's, and only when the keys
 * being locked is the reason. `undefined` when the record is not sealed out of reach. A probe: what
 * it reads is not held.
 */
function sealedRecordRefusal(
  payload: ISubagentWorkerStartPayload,
  resumeSessionId: string,
  store: TResumeSessionStore,
): string | undefined {
  const outcome = store.loadHeld?.(resumeSessionId) ?? store.load(resumeSessionId);
  if (outcome.status !== 'locked') return undefined;
  const cannot = `subagent worker: job ${payload.taskId} cannot resume session ${resumeSessionId}: `;
  switch (outcome.reason) {
    case 'changed':
      return (
        `${cannot}its record changed after the parent handed it over, so the copy this job holds ` +
        'is not what is saved. Run /fork again from the parent session.'
      );
    case 'no-keys':
      return (
        `${cannot}its record is sealed and was not handed to this job, and a subagent process holds ` +
        'no keys that open it. Start the fork again from the parent session.'
      );
    default:
      return (
        `${cannot}its record is sealed and the keys that open it are locked. Unlock in the parent ` +
        'session, then run /fork again.'
      );
  }
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
  const store = composition.openSessionStore({ cwd: payload.request.cwd });
  if (payload.resumeHeld !== undefined) {
    if (store.importHeld === undefined) {
      throw new Error(
        `subagent worker: job ${payload.taskId} was handed the sealed record of session ` +
          `${resumeSessionId}, but this composition's store cannot take it ` +
          '(IInteractiveSessionStore.importHeld). The subagent was not started.',
      );
    }
    store.importHeld(resumeSessionId, payload.resumeHeld);
  }
  return store;
}
