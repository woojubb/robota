/**
 * Renaming a session on disk, and saying so when it cannot be done.
 *
 * This lives in its own module for two reasons. `interactive-session.ts` is at its size ratchet, so
 * the logic had to move rather than grow there. And it was wrong in place: the rename sat inside a
 * `try { … } catch { /* Session not initialized yet *\/ }`, so a thrown report of "this record
 * cannot be written" was swallowed by a catch meant for an uninitialised session — silence replacing
 * silence, which is the defect this leaf exists to remove, reintroduced while removing it.
 *
 * The split here is between the two things that catch was covering: obtaining the session id may
 * legitimately fail before initialisation and is handled; the STORE outcome may not be swallowed.
 */

import { loadSessionForUpdate } from '@robota-sdk/agent-session';

import { lockedReasonOf, sealedSessionState } from './locked-session-wording.js';
import { provenanceOfOutcome } from './session-authorship-gate.js';

import type { TLockedSessionReason } from './locked-session-wording.js';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';

/** Thrown when a session exists on disk in a form this process cannot read, so a rename cannot land. */
export class SessionRenameUnavailableError extends Error {
  readonly sessionId: string;
  readonly outcome: 'corrupt' | 'unsupported' | 'locked';

  /** `reason`: why a `locked` record does not open here; only locked keys are worded with an unlock. */
  constructor(
    sessionId: string,
    outcome: 'corrupt' | 'unsupported' | 'locked',
    reason: TLockedSessionReason = 'locked',
  ) {
    super(
      outcome === 'locked'
        ? `session ${sessionId} could not be renamed on disk: the stored record is ` +
            `${sealedSessionState(reason)}${reason === 'locked' ? '; unlock to rename it' : ''}`
        : `session ${sessionId} could not be renamed on disk: the stored record is ${outcome}`,
    );
    this.name = 'SessionRenameUnavailableError';
    this.sessionId = sessionId;
    this.outcome = outcome;
  }
}

/**
 * Persist a new name onto the stored record.
 *
 * `missing` is not an error: a session with nothing saved yet is renamed in memory and written by
 * the next persist. `corrupt`, `unsupported` and `locked` are — the record is there, this build or
 * this process cannot read it, and reporting nothing is what made a rename appear to succeed while
 * changing nothing on disk. It reads the way every writer does, so a session this process holds is
 * still renamed after the keys lock.
 */
export function persistSessionRename(
  sessionStore: IInteractiveSessionStore,
  sessionId: string,
  name: string,
): void {
  const outcome = loadSessionForUpdate(sessionStore, sessionId);
  if (outcome.status === 'missing') return;
  if (outcome.status !== 'valid') {
    throw new SessionRenameUnavailableError(
      sessionId,
      outcome.status,
      outcome.status === 'locked' ? lockedReasonOf(outcome) : undefined,
    );
  }
  const record: IInteractiveSessionRecord = {
    ...outcome.record,
    name,
    updatedAt: new Date().toISOString(),
  };
  // Whose the record is follows what was read: a rename never makes a record the owner's.
  const provenance = provenanceOfOutcome(outcome);
  if (provenance === undefined) sessionStore.save(record);
  else sessionStore.save(record, { provenance });
}
