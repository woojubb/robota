import type {
  IInteractiveSessionStore,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

/**
 * What a writer should read before it saves, to keep the members of a record it does not own.
 *
 * `load` is the answer, asked to `hold` the session, since the caller is about to save it: a store
 * that seals then remembers the record it opened, so the process can keep saving after the keys lock.
 * Sealing needs only the public key, so a process running a session keeps saving it after the lock —
 * but `load` then says `locked`, and a writer that stops on that would stop saving the whole
 * conversation. The store that wrote or holds the record still has that copy, and hands it back for
 * as long as the file on disk is exactly what it remembers. Anything else stays `locked`, and the
 * writer refuses.
 */
export function loadSessionForUpdate(
  store: IInteractiveSessionStore,
  id: string,
): TSessionLoadOutcome {
  const outcome = store.load(id, { hold: true });
  if (outcome.status !== 'locked') return outcome;
  return store.loadHeld?.(id) ?? outcome;
}
