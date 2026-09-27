import type { TExecutionJournalRecord } from '../interfaces/execution-journal';

/** A persistence/admission failure must never become a model-visible, retryable tool failure. */
export class ExecutionJournalError extends Error {
  readonly code = 'EXECUTION_JOURNAL_FAILED';
  readonly recordId: string;
  readonly kind: TExecutionJournalRecord['kind'];
  constructor(record: TExecutionJournalRecord, cause: unknown) {
    super(`Execution journal failed at ${record.kind}`, { cause });
    this.name = 'ExecutionJournalError';
    this.recordId = record.recordId;
    this.kind = record.kind;
  }
}
