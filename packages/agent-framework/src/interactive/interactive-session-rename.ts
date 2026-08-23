/**
 * TRANS-007 — renaming a session on disk, and saying so when it cannot be done.
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

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';

/** Thrown when a session exists on disk in a form this build cannot read, so a rename cannot land. */
export class SessionRenameUnavailableError extends Error {
  readonly sessionId: string;
  readonly outcome: 'corrupt' | 'unsupported';

  constructor(sessionId: string, outcome: 'corrupt' | 'unsupported') {
    super(`session ${sessionId} could not be renamed on disk: the stored record is ${outcome}`);
    this.name = 'SessionRenameUnavailableError';
    this.sessionId = sessionId;
    this.outcome = outcome;
  }
}

/**
 * Persist a new name onto the stored record.
 *
 * `missing` is not an error: a session with nothing saved yet is renamed in memory and written by
 * the next persist. `corrupt` and `unsupported` are — the record is there, this build cannot read
 * it, and reporting nothing is what made a rename appear to succeed while changing nothing on disk.
 */
export function persistSessionRename(
  sessionStore: IInteractiveSessionStore,
  sessionId: string,
  name: string,
): void {
  const outcome = sessionStore.load(sessionId);
  if (outcome.status === 'missing') return;
  if (outcome.status !== 'valid') {
    throw new SessionRenameUnavailableError(sessionId, outcome.status);
  }
  const record: IInteractiveSessionRecord = {
    ...outcome.record,
    name,
    updatedAt: new Date().toISOString(),
  };
  sessionStore.save(record);
}
