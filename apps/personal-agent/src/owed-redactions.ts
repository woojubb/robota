/**
 * Text a forget still owes to conversations that were busy when it ran, and the store view that pays
 * it on every save meanwhile.
 *
 * A running turn keeps its whole conversation in memory and saves it whole, so cleaning the saved copy
 * would be undone by that turn's next save. Until the session is idle and can be cleaned in memory,
 * every record it saves is cleaned on the way to disk. The texts are held only while the debt lasts,
 * only in memory, and are dropped the moment it is paid: a list kept for later would keep the fact.
 */
import { createForgottenTextRedactor } from '@robota-sdk/agent-product/personal';
import { decorateSessionStore, redactSessionRecord } from '@robota-sdk/agent-framework';

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  TTextRedactor,
} from '@robota-sdk/agent-framework';

export interface IOwedRedactions {
  /** Add texts a session's saved records must not carry; repeated texts are kept once. */
  owe(sessionId: string, texts: readonly string[]): void;
  /** The debt is paid: later saves of this session are left as they are. */
  settle(sessionId: string): void;
  /** What a save of this session is cleaned with; absent when nothing is owed. */
  redactorFor(sessionId: string): TTextRedactor | undefined;
}

export function createOwedRedactions(): IOwedRedactions {
  const owed = new Map<string, { texts: Set<string>; redact: TTextRedactor }>();
  return {
    owe(sessionId, texts) {
      const held = owed.get(sessionId)?.texts ?? new Set<string>();
      for (const text of texts) held.add(text);
      owed.set(sessionId, { texts: held, redact: createForgottenTextRedactor([...held]) });
    },
    settle: (sessionId) => {
      owed.delete(sessionId);
    },
    redactorFor: (sessionId) => owed.get(sessionId)?.redact,
  };
}

/**
 * `store`, with every save of a session that owes a redaction cleaned first. Every other member is
 * the store's own, so claims, provenance and the atomic owner-only write are unchanged.
 */
export function withOwedRedactions(
  store: IInteractiveSessionStore,
  owed: IOwedRedactions,
): IInteractiveSessionStore {
  const cleaned = (record: IInteractiveSessionRecord): IInteractiveSessionRecord => {
    const redact = owed.redactorFor(record.id);
    return redact === undefined ? record : (redactSessionRecord(record, redact) ?? record);
  };
  const saveRestoreTransaction = store.saveRestoreTransaction?.bind(store);
  return decorateSessionStore(store, {
    save: (record, options) => store.save(cleaned(record), options),
    ...(saveRestoreTransaction !== undefined && {
      saveRestoreTransaction: (record, options) => saveRestoreTransaction(cleaned(record), options),
    }),
  });
}
