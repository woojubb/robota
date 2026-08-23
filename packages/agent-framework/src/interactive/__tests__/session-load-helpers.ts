/**
 * TRANS-007 — narrowing helpers for tests that only care about a readable record.
 *
 * `IInteractiveSessionStore.load` returns an outcome rather than `record | undefined`, because
 * `undefined` was one answer for four situations and a caller that read it as "no record" then
 * overwrote a file it merely could not read. Tests whose subject is something else should not have
 * to restate that at every call site — but they also must not silently pass when a load fails, which
 * is what an `as` cast here would produce.
 *
 * So these throw with the outcome in the message. A test that regresses to `corrupt` says so.
 */

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';

/** The stored record, or a failure naming the outcome that was not `valid`. */
export function loadedRecord(
  store: IInteractiveSessionStore,
  id: string,
): IInteractiveSessionRecord {
  const outcome = store.load(id);
  if (outcome.status !== 'valid') {
    throw new Error(
      `expected a readable session record for ${id}, store reported ${outcome.status}`,
    );
  }
  return outcome.record;
}

/** The stored record when there is one, `undefined` for `missing` — a failure for the other two. */
export function loadedRecordOrMissing(
  store: IInteractiveSessionStore,
  id: string,
): IInteractiveSessionRecord | undefined {
  const outcome = store.load(id);
  if (outcome.status === 'valid') return outcome.record;
  if (outcome.status === 'missing') return undefined;
  throw new Error(
    `expected a readable or absent session record for ${id}, store reported ${outcome.status}`,
  );
}

/** Every readable record in a listing, for tests whose subject is the records rather than the entries. */
export function listedRecords(store: IInteractiveSessionStore): IInteractiveSessionRecord[] {
  return store
    .list()
    .flatMap((entry) => (entry.outcome.status === 'valid' ? [entry.outcome.record] : []));
}
