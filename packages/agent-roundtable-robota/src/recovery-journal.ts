import type { IRecoverableExecutionJournal, TExecutionJournalRecord } from '@robota-sdk/agent-core';
import type { ParticipantCheckpoint, ParticipantOutcome } from '@robota-sdk/agent-roundtable';
import {
  TOOL_EFFECT_CALL_PREFIX,
  type EffectCallIds,
  type ToolEffectStart,
} from './metering-journal';
import { RuntimeParticipantError } from './errors';

/** Whose journal this is: one per (conversation, participant), so one participant never reads another's. */
export interface RecoveryScope {
  conversationId: string;
  participantId: string;
}

/**
 * Everything the adapter writes to its durable journal, in the one order the writer produced it.
 * Entries are structured-cloneable values (a record may hold a `Date`); how they are encoded on disk
 * is the journal's own business.
 */
export type RecoveryJournalEntry =
  /** Written before the first record of an execution passes through, and never changed. */
  | { kind: 'binding'; attemptId: string; sessionId: string; executionId: string; cwd: string }
  /** The ledger call id taken for a paid effect, written before the call is admitted under it. */
  | { kind: 'effect-call'; attemptId: string; actionId: string; callId: string }
  /** What an attempt's turn returned, written before it is returned, so a lost reply is not a rerun. */
  | {
      kind: 'turn-end';
      attemptId: string;
      phase: string;
      outcome: Exclude<ParticipantOutcome, { kind: 'failed' }>;
      checkpoint: ParticipantCheckpoint;
    }
  | { kind: 'record'; record: TExecutionJournalRecord };

/**
 * The adapter's recovery journal for one scope. `append` resolves only once the entry survives the
 * writer's death, and `read` returns every entry in append order. One writer per scope: the
 * conversation claim does not fence it.
 */
export interface RecoveryJournal {
  /** 'durable' only when an entry that `append` acknowledged is still there after a restart. */
  readonly durability: 'durable' | 'volatile';
  append(entry: RecoveryJournalEntry): Promise<void>;
  read(): Promise<readonly RecoveryJournalEntry[]>;
}

export interface SessionRecoveryOptions {
  /** Called when a session opens and when recovery reconciles; the result is that scope's journal. */
  journal(scope: RecoveryScope): RecoveryJournal;
}

/** Refuses a journal that would lose acknowledged entries, before anything depends on it. */
export function assertDurableJournal(journal: RecoveryJournal): void {
  if (journal.durability !== 'durable')
    throw new RuntimeParticipantError(
      'journal-not-durable',
      'Recovery needs a journal whose acknowledged entries survive a restart',
    );
}

/** Serializes appends and keeps a mirror of the scope's entries; the only writer of its journal. */
export class ScopeLog {
  private mirror: RecoveryJournalEntry[] | undefined;
  private recordIds = new Map<string, TExecutionJournalRecord>();
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly journal: RecoveryJournal) {}

  private queued<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async loaded(): Promise<RecoveryJournalEntry[]> {
    if (!this.mirror) {
      const entries = structuredClone([...(await this.journal.read())]);
      this.recordIds = new Map();
      for (const entry of entries) {
        if (entry.kind === 'record') this.recordIds.set(entry.record.recordId, entry.record);
      }
      this.mirror = entries;
    }
    return this.mirror;
  }

  entries(): Promise<readonly RecoveryJournalEntry[]> {
    return this.queued(async () => structuredClone(await this.loaded()));
  }

  /**
   * A record with an id already used is a no-op when identical and a conflict when it differs.
   * `guard` runs in turn, right before the entry is written, so a write queued behind others still
   * sees what happened while it waited.
   */
  append(entry: RecoveryJournalEntry, guard?: () => void): Promise<void> {
    return this.queued(async () => {
      const entries = await this.loaded();
      guard?.();
      if (entry.kind === 'record') {
        const existing = this.recordIds.get(entry.record.recordId);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(entry.record))
            throw new Error(
              `Journal record id was already used with different content: ${entry.record.recordId}`,
            );
          return;
        }
      }
      const saved = structuredClone(entry);
      await this.journal.append(saved);
      entries.push(saved);
      if (saved.kind === 'record') this.recordIds.set(saved.record.recordId, saved.record);
    });
  }
}

/**
 * Hides every model invocation at the tail that never got a response: agent-core refuses to resume
 * past an unanswered latest request, and nothing after such a request ever depended on it, so the run
 * continues from the last round that did settle and asks the provider again under a new call id.
 * Several can pile up when a restart is itself killed before its new request is answered.
 */
export function hideUnansweredRequest(
  records: readonly TExecutionJournalRecord[],
): TExecutionJournalRecord[] {
  let visible = [...records];
  for (;;) {
    const index = visible.findLastIndex((record) => record.kind === 'model-request');
    if (index < 0) return visible;
    const request = visible[index]!;
    const callId = 'callId' in request ? request.callId : undefined;
    const settled =
      visible.some((record) => record.kind === 'model-response' && record.callId === callId) ||
      visible
        .slice(index + 1)
        .some((record) => record.kind === 'model-cache-hit' || record.kind === 'managed-frame');
    if (settled) return visible;
    visible = visible.filter((record) => !('callId' in record) || record.callId !== callId);
  }
}

/** What `sessionParticipant` hands the Session for one attempt of one turn. */
export interface AttemptJournal extends IRecoverableExecutionJournal {
  readonly effectCalls: EffectCallIds;
  /** Writes what the turn returned; later reconciliation answers from it instead of rerunning. */
  turnEnd(entry: Extract<RecoveryJournalEntry, { kind: 'turn-end' }>): Promise<void>;
  /**
   * Ends the attempt's right to write: its appends and effect-call claims are refused with
   * `attempt-sealed` from now on, while reads stay open so the attempt can still be reconciled.
   * A stopped run seals the Session's writes by itself, the instant its signal aborts.
   */
  seal(): void;
}

/**
 * The journal a Session sees for one attempt. Before the first record of an execution passes
 * through, the attempt's binding (attempt, session, execution, cwd) is written, so recovery can find
 * the session and execution a crashed attempt belonged to even on a participant's first turn, which
 * has no checkpoint. Reads show the journal without an unanswered trailing request.
 */
export function attemptJournal(
  log: ScopeLog,
  attempt: { attemptId: string; sessionId: string; cwd: string },
  /** The run the attempt belongs to: once it is stopped, nothing the Session does is journaled. */
  signal?: AbortSignal,
): AttemptJournal {
  const binding = new Map<string, Promise<void>>();
  const effectIds = new Map<string, string>();
  let sealed = false;
  /** The adapter's own writes: allowed until the turn has settled. */
  const open = (): void => {
    if (sealed)
      throw new RuntimeParticipantError(
        'attempt-sealed',
        `Attempt ${attempt.attemptId} is sealed: its turn ended, so it may not write to its journal`,
      );
  };
  /**
   * The Session's writes: also refused once the run is stopped. What a Session writes while it
   * unwinds from a stop (a result for a call it cancelled, a failure for a request it dropped) is not
   * what happened outside, and a later reconciliation would take it for the truth; a stop therefore
   * leaves the journal as a process death at that instant would.
   */
  const writable = (): void => {
    open();
    if (signal?.aborted)
      throw new RuntimeParticipantError(
        'attempt-sealed',
        `Attempt ${attempt.attemptId} is sealed: its run was stopped, so its Session may not write to its journal`,
      );
  };

  function bound(executionId: string): Promise<void> {
    let pending = binding.get(executionId);
    if (!pending) {
      pending = (async () => {
        const entries = await log.entries();
        const saved = entries.some(
          (entry) =>
            entry.kind === 'binding' &&
            entry.attemptId === attempt.attemptId &&
            entry.executionId === executionId,
        );
        if (!saved) await log.append({ kind: 'binding', ...attempt, executionId }, writable);
      })();
      binding.set(executionId, pending);
      // A failed write must not be remembered as done.
      pending.catch(() => binding.delete(executionId));
    }
    return pending;
  }

  return {
    async append(record) {
      writable();
      await bound(record.executionId);
      await log.append({ kind: 'record', record }, writable);
    },
    async read(executionId) {
      const records = (await log.entries()).flatMap((entry) =>
        entry.kind === 'record' && entry.record.executionId === executionId ? [entry.record] : [],
      );
      return hideUnansweredRequest(records);
    },
    effectCalls: {
      async claim(record: ToolEffectStart) {
        writable();
        const known = effectIds.get(record.actionId);
        if (known) return known;
        await bound(record.executionId);
        const callId = `${TOOL_EFFECT_CALL_PREFIX}${crypto.randomUUID()}`;
        await log.append(
          {
            kind: 'effect-call',
            attemptId: attempt.attemptId,
            actionId: record.actionId,
            callId,
          },
          writable,
        );
        effectIds.set(record.actionId, callId);
        return callId;
      },
    },
    async turnEnd(entry) {
      open();
      await log.append(entry, open);
    },
    seal() {
      sealed = true;
    },
  };
}
