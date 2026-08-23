/**
 * TRANS-007 — narrowing helpers for tests whose subject is not the load outcome.
 *
 * `load` returns an outcome rather than `record | undefined`, because `undefined` was one answer for
 * four situations. Tests about something else should not restate that at every call site — but they
 * must not silently pass when a load fails either, which is what an `as` cast would produce. These
 * throw with the outcome in the message, so a test that regresses to `corrupt` says which.
 */

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';

/** The stored record when there is one, `undefined` for `missing` — a failure for the other two. */
export function loadedOrMissing(
  store: IInteractiveSessionStore,
  id: string,
): IInteractiveSessionRecord | undefined {
  const outcome = store.load(id);
  if (outcome.status === 'valid') return outcome.record;
  if (outcome.status === 'missing') return undefined;
  throw new Error(
    `expected a readable or absent record for ${id}, store reported ${outcome.status}`,
  );
}

/** Every readable record in a listing. */
export function listedRecords(store: IInteractiveSessionStore): IInteractiveSessionRecord[] {
  return store
    .list()
    .flatMap((entry) => (entry.outcome.status === 'valid' ? [entry.outcome.record] : []));
}
