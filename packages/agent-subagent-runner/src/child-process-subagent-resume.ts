/**
 * CLI-1994: how a fork job's conversation reaches the CHILD process.
 *
 * From a plain parent only the id crossed the wire (ARCH-044) — the copy `/fork` wrote stays in the
 * session store on the far side, and this is where the id becomes the conversation again. A sealing
 * parent also hands over the record it holds (`resumeHeld`), since a child never holds the keys that
 * open a sealed one; the store takes it before the claim reads the record. Either way the parent lent
 * the record to this child (`resumeLease`), and the child claims it under that lease, taking the
 * parent's writer marker over, so every save of the record is the child's own. Beside the worker rather
 * than inside it for the same reason the start-payload projection sits beside the wire vocabulary:
 * "how a fork job resumes its record" is a different question from "how a worker process runs a
 * job", and the worker is already at the anti-monolith limit.
 *
 * The store is opened for the PARENT's cwd (`request.cwd`), not the execution root: a
 * worktree-isolated child runs in a directory that holds no session records of its own.
 */

import { decorateSessionStore, restoreSessionRecordIntoSession } from '@robota-sdk/agent-framework';

import type { ISubagentWorkerStartPayload } from './child-process-subagent-ipc.js';
import type { ISubagentWorkerComposition, TResumeSessionStore } from './worker-composition.js';
import type { createSubagentSession } from '@robota-sdk/agent-framework';

/** The child's claim on the record it was lent: the store its session saves through, and the end. */
export interface IClaimedResumeRecord {
  /** The store every save goes through: a save of the record carries the claim. */
  readonly store: TResumeSessionStore;
  /** What the claim's read concluded, which the session restores from. */
  readonly outcome: ReturnType<TResumeSessionStore['load']>;
  /** Ends the claim, removing the writer marker. Idempotent. */
  release(): void;
}

/**
 * Claims the record a job resumes under the lease its parent lent it with, taking the parent's
 * writer marker over; `undefined` for a job that resumes nothing. Refused — and the job fails — when
 * the payload carries no lease, the store cannot claim, or the lease no longer holds.
 */
export function claimRequestedRecord(
  payload: ISubagentWorkerStartPayload,
  store: TResumeSessionStore | undefined,
): IClaimedResumeRecord | undefined {
  const resumeSessionId = payload.request.resumeSessionId;
  if (resumeSessionId === undefined || store === undefined) return undefined;
  if (payload.resumeLease === undefined) {
    throw new Error(
      `subagent worker: job ${payload.taskId} asks to resume session ${resumeSessionId}, but its ` +
        'parent lent it no lease, so it cannot be its writer. The subagent was not started.',
    );
  }
  // Fail closed: a store that cannot claim cannot give the record one writer.
  if (typeof store.claim !== 'function') {
    throw new TypeError('A session store must offer claim: every session claims its record.');
  }
  const claim = store.claim(resumeSessionId, { lease: payload.resumeLease });
  return {
    store: decorateSessionStore(store, {
      save: (record, options) => {
        if (record.id === resumeSessionId) store.save(record, { ...options, claim });
        else if (options === undefined) store.save(record);
        else store.save(record, options);
      },
    }),
    outcome: claim.outcome,
    release: () => claim.release(),
  };
}

/**
 * Restore the record a job names into the freshly built child, before its first turn, from the read
 * its claim made.
 *
 * A job that names no record returns immediately — the ordinary subagent, unchanged. A composition
 * that opens no store FAILS the job, naming the seam to register: starting the child empty would be
 * a fork that silently forgot its parent, and a caller has no way to detect that afterwards.
 */
export function resumeRequestedRecord(
  payload: ISubagentWorkerStartPayload,
  childSession: ReturnType<typeof createSubagentSession>,
  resumeSessionStore: TResumeSessionStore | undefined,
  claimed: IClaimedResumeRecord | undefined,
): void {
  const resumeSessionId = payload.request.resumeSessionId;
  if (resumeSessionId === undefined) return;
  if (resumeSessionStore === undefined || claimed === undefined) {
    throw new Error(
      `subagent worker: job ${payload.taskId} asks to resume session ${resumeSessionId}, but this ` +
        'composition opens no session store. Register ISubagentWorkerComposition.openSessionStore ' +
        'at the composition root — the same place providerDefinitions is registered.',
    );
  }
  try {
    // The child's own writer read, made by its claim: of the record its parent handed it when the
    // parent seals — the owner's only on the parent's word, which the store keeps — or of the file.
    restoreSessionRecordIntoSession(
      resumeSessionStore,
      resumeSessionId,
      childSession,
      claimed.outcome,
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
export async function openResumeSessionStore(
  payload: ISubagentWorkerStartPayload,
  composition: ISubagentWorkerComposition,
): Promise<TResumeSessionStore | undefined> {
  const resumeSessionId = payload.request.resumeSessionId;
  if (resumeSessionId === undefined) return undefined;
  if (composition.openSessionStore === undefined) {
    throw new Error(
      `subagent worker: job ${payload.taskId} asks to resume session ${resumeSessionId}, but this ` +
        'composition opens no session store. Register ISubagentWorkerComposition.openSessionStore ' +
        'at the composition root — the same place providerDefinitions is registered.',
    );
  }
  const store = await composition.openSessionStore({
    cwd: payload.request.cwd,
    ...(payload.resumeStore !== undefined ? { resumeStore: payload.resumeStore } : {}),
  });
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
