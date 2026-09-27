import type { IRecoverableExecutionJournal, TExecutionJournalRecord } from '@robota-sdk/agent-core';

/**
 * Default journal for `sessionParticipant`/`robotaParticipant` when the host supplies none.
 *
 * Keyed by `sessionId` at module scope, so it survives a session lease being discarded and
 * reopened — including a fresh `Conversation` built by `loadRoundtable` in the same process — for
 * as long as the process runs. It is not durable across a process restart: a host that needs an
 * approval wait to survive that must supply its own `journal` that persists records elsewhere.
 */
const journals = new Map<string, TExecutionJournalRecord[]>();

function sameRecord(a: TExecutionJournalRecord, b: TExecutionJournalRecord): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createInProcessJournal(sessionId: string): IRecoverableExecutionJournal {
  let records = journals.get(sessionId);
  if (!records) {
    records = [];
    journals.set(sessionId, records);
  }
  const store = records;
  return {
    async append(record: TExecutionJournalRecord): Promise<void> {
      const existing = store.find((saved) => saved.recordId === record.recordId);
      if (existing) {
        if (!sameRecord(existing, record))
          throw new Error(
            `Journal record id was already used with different content: ${record.recordId}`,
          );
        return;
      }
      store.push(structuredClone(record));
    },
    async read(executionId: string): Promise<readonly TExecutionJournalRecord[]> {
      return structuredClone(store.filter((record) => record.executionId === executionId));
    },
  };
}

/**
 * SHOULD 7: drop every record kept for `sessionId` — called once a turn settles with no wait
 * parked, since nothing reads a settled execution's records back afterward. Mutates the same
 * array `createInProcessJournal` handed out for this `sessionId` (rather than replacing the map
 * entry), so a journal instance created earlier for the same id observes the drop too.
 */
export function clearInProcessJournal(sessionId: string): void {
  const records = journals.get(sessionId);
  if (records) records.length = 0;
}

/**
 * SHOULD 7: remove `sessionId`'s entry entirely — called on `release()` when no wait is parked, so
 * the module-level map does not keep one entry per session that ever opened for the life of the
 * process. A wait still parked needs its records reachable for a later resume, so the caller must
 * not call this while one is outstanding; `clearInProcessJournal` already emptied everything else.
 */
export function forgetInProcessJournal(sessionId: string): void {
  journals.delete(sessionId);
}
