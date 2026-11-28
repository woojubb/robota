import { ExecutionRecoveryError } from '@robota-sdk/agent-core';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';

import { SessionBusyError } from './turn-claim.js';

import { unresolvedExecutionMessage } from './execution-journal-store.js';
import type { ISessionExecutionJournal } from './execution-journal-store.js';
import type { Session } from './session.js';
import type { ISessionRunOptions } from './session-types.js';

/**
 * One managed turn through the session's durable journal.
 *
 * A managed provider runs the whole turn itself, so the journal is the only proof of what the turn
 * did once the process is gone. The turn is refused while an earlier execution of this session is
 * unresolved (it holds records and was never sealed): resuming it would re-run effects nobody can
 * prove did not happen. A turn that settled in the conversation is sealed, completed or failed; one
 * the session still holds open (parked, or cut off mid-round) stays unsealed until it is abandoned.
 */
export async function runJournaledTurn(
  session: Session,
  journal: ISessionExecutionJournal,
  message: string,
  options?: ISessionRunOptions,
  rawInput?: string,
): Promise<string> {
  const unresolved = await journal.unresolved();
  if (unresolved.length > 0)
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_REQUIRED',
      unresolvedExecutionMessage(unresolved),
    );
  const executions = new Set<string>();
  const tracked = {
    read: (executionId: string) => journal.read(executionId),
    append: (record: TExecutionJournalRecord) => {
      executions.add(record.executionId);
      return journal.append(record);
    },
  };
  let result: Awaited<ReturnType<Session['runRecoverable']>>;
  try {
    result = await session.runRecoverable(
      message,
      { ...options, executionJournal: tracked },
      rawInput,
    );
  } catch (error) {
    if (session.getPendingExecution() === undefined) {
      for (const executionId of executions) {
        try {
          await journal.seal(executionId, { reason: 'failed' });
        } catch {
          // allow-fallback: the turn's own error is the one to report; an execution left unsealed
          // blocks the next turn, which is the fail-closed answer to a journal that cannot be sealed.
        }
      }
    }
    throw error;
  }
  if (result.status === 'waiting')
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_REQUIRED',
      'The managed turn is waiting for an approval this host cannot answer. Abandon the execution to continue.',
    );
  for (const executionId of executions) await journal.seal(executionId, { reason: 'completed' });
  return result.response;
}

export interface IAbandonedExecutions {
  readonly executionIds: readonly string[];
  /** For the person: what was done, and what may already have happened outside the session. */
  readonly message: string;
}

const ABANDON_NOTE =
  'Abandoned by the user. Which tool calls had already run is unknown; effects may exist outside the session.';

/**
 * Give up every unfinished managed execution of a session so it accepts input again. Each is sealed
 * `abandoned` first, so it can never be resumed whatever happens next, and the session then closes
 * the calls its open round left unanswered. Nothing runs and nothing is replayed; the person is told
 * the outcome of those calls is unknown. Refused while a turn runs.
 */
export async function abandonUnresolvedExecutions(
  session: Session,
  journal: ISessionExecutionJournal,
): Promise<IAbandonedExecutions> {
  if (session.isRunning())
    throw new SessionBusyError('Cannot abandon an execution while a turn is running');
  const pending = session.getPendingExecution();
  const executionIds = new Set(await journal.unresolved());
  if (pending) executionIds.add(pending.executionId);
  if (executionIds.size === 0) {
    // A hold placed at start can outlive its executions (another process sealed them since).
    session.releaseUnresolvedExecutions();
    return { executionIds: [], message: 'No managed execution is waiting to be abandoned.' };
  }
  for (const executionId of executionIds)
    await journal.seal(executionId, { reason: 'abandoned', note: ABANDON_NOTE });
  if (pending) session.abandonPendingExecution(pending.executionId);
  session.releaseUnresolvedExecutions();
  session.invalidateManagedContinuation();
  const ids = [...executionIds];
  return {
    executionIds: ids,
    message:
      `Abandoned ${ids.length === 1 ? 'managed execution' : 'managed executions'} ${ids.join(', ')}. ` +
      'It will not be resumed or re-run. Tool calls it had already started may have changed files or ' +
      'reached outside this session; check before repeating the work.',
  };
}
