import type { IRecoverableExecutionJournal } from '@robota-sdk/agent-core';

/**
 * How a journaled execution ended. A host seals an execution once nothing will append to it again:
 * `completed` and `failed` when the turn settled in the conversation's own history, `abandoned`
 * when a person gave up an unfinished one.
 */
export type TExecutionSealReason = 'completed' | 'failed' | 'abandoned';

export interface IExecutionSeal {
  readonly reason: TExecutionSealReason;
  readonly sealedAt: string;
  /** What the person was told might already have happened outside; kept for the record. */
  readonly note?: string;
  /** How many complete records the journal held when it was sealed. */
  readonly records: number;
}

export type TExecutionJournalStoreErrorCode =
  | 'torn-tail'
  | 'corrupt-record'
  | 'sealed'
  | 'conflict'
  | 'invalid-identity'
  | 'unsupported-sealing';

/**
 * A journal that cannot be trusted or extended. It is thrown instead of repaired: the stored history
 * may hold the only proof that an effect was dispatched, so nothing here truncates, skips or
 * rewrites a line it cannot read.
 */
export class ExecutionJournalStoreError extends Error {
  readonly code: TExecutionJournalStoreErrorCode;
  constructor(code: TExecutionJournalStoreErrorCode, message: string) {
    super(message);
    this.name = 'ExecutionJournalStoreError';
    this.code = code;
  }
}

/**
 * The durable journal of one session's executions: the recoverable-journal port, plus what a host
 * needs to decide, after a crash, whether an execution may still be continued.
 */
export interface ISessionExecutionJournal extends IRecoverableExecutionJournal {
  /**
   * Executions that hold records and were never sealed, oldest first: a turn that ended without the
   * host recording how. Their effects are unproven either way, so they are never resumed silently.
   * Read from the directory listing, so a damaged journal is still reported.
   */
  unresolved(): Promise<readonly string[]>;
  /**
   * Refuse every further append and record how the execution ended. Sealing again with the same
   * reason is a no-op that returns the first seal; a different reason is refused.
   */
  seal(
    executionId: string,
    outcome: { reason: TExecutionSealReason; note?: string },
  ): Promise<IExecutionSeal>;
  sealOf(executionId: string): Promise<IExecutionSeal | undefined>;
}

/** Durable journals kept beside the session records, one per session. */
export interface IExecutionJournalStore {
  forSession(sessionId: string): ISessionExecutionJournal;
}

/** What a person is told when an unfinished managed execution blocks the session. */
export function unresolvedExecutionMessage(executionIds: readonly string[]): string {
  return (
    `A managed execution did not finish (${executionIds.join(', ')}). Which of its tool calls ` +
    'already ran cannot be known, so it is not resumed and nothing new is sent behind it. ' +
    'Abandon it to continue.'
  );
}
