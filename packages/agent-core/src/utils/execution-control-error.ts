import { ExecutionJournalError } from './execution-journal-error';
import { ExecutionRecoveryError } from './execution-recovery-error';
import { ExecutionSuspendedError } from './execution-suspended-error';

export function isExecutionControlError(
  error: unknown,
): error is ExecutionJournalError | ExecutionRecoveryError | ExecutionSuspendedError {
  return (
    error instanceof ExecutionJournalError ||
    error instanceof ExecutionRecoveryError ||
    error instanceof ExecutionSuspendedError
  );
}

/** Persistence/unknown-effect failures outrank waiting; all settled waits remain observable. */
export function prioritizeExecutionError(first: unknown, next: unknown): unknown {
  if (first instanceof ExecutionJournalError) return first;
  if (next instanceof ExecutionJournalError) return next;
  if (first instanceof ExecutionRecoveryError) return first;
  if (next instanceof ExecutionRecoveryError) return next;
  if (first instanceof ExecutionSuspendedError && next instanceof ExecutionSuspendedError) {
    const requests = new Map(
      [...first.requests, ...next.requests].map((request) => [request.requestId, request]),
    );
    return new ExecutionSuspendedError([...requests.values()]);
  }
  if (first instanceof ExecutionSuspendedError) return first;
  return next;
}
