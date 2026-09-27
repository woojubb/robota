import {
  ExecutionRecoveryError,
  ExecutionSuspendedError,
  createToolMessage,
} from '@robota-sdk/agent-core';
import type {
  IRecoverableExecutionJournal,
  IResumeExecutionOptions,
  IToolWaitRequest,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type { ISessionRunOptions } from './session-types.js';
import type { TSessionResumeOptions } from './session-resume.js';

export interface ISessionRecoverableRunOptions extends ISessionRunOptions {
  executionJournal: IRecoverableExecutionJournal;
}
export type TSessionRecoverableResumeOptions = TSessionResumeOptions &
  Pick<IResumeExecutionOptions, 'toolResponses'>;
export type TSessionExecutionResult =
  | { status: 'completed'; response: string }
  | { status: 'waiting'; requests: readonly IToolWaitRequest[] };
/**
 * A journaled execution whose round is open in history — parked on saved waits, or stopped by a
 * failure — so the Session accepts no new input until it is resumed or abandoned. `requests` are
 * the saved waits whose effect has not been admitted; empty when a failure left the round open.
 */
export interface ISessionPendingExecution {
  executionId: string;
  requests: readonly IToolWaitRequest[];
}

export function pendingExecution(
  error: ExecutionSuspendedError,
): ISessionPendingExecution | undefined {
  const executionId = error.requests[0]?.executionId;
  return executionId ? { executionId, requests: structuredClone(error.requests) } : undefined;
}

function lastRound(history: readonly TUniversalMessage[]) {
  const index = history.findLastIndex((message) => message.role === 'assistant');
  const assistant = history[index];
  if (assistant?.role !== 'assistant') return undefined;
  const answered = new Set(
    history
      .slice(index + 1)
      .flatMap((message) => (message.role === 'tool' ? [message.toolCallId] : [])),
  );
  return {
    assistant,
    open: (assistant.toolCalls ?? []).filter((call) => !answered.has(call.id)),
    ending: history.slice(index + 1).every((message) => message.role === 'tool'),
  };
}

/**
 * After a journaled attempt fails, the execution whose round it left open at the end of history
 * stays pending, so the next input is never sent after unanswered calls. Only saved waits whose
 * effect was never admitted remain answerable.
 */
export function unfinishedExecution(
  history: readonly TUniversalMessage[],
  previous: ISessionPendingExecution | undefined,
  admitted: ReadonlySet<string>,
): ISessionPendingExecution | undefined {
  const round = lastRound(history);
  const executionId = round?.assistant.metadata?.executionId;
  if (!round?.ending || !round.open.length || typeof executionId !== 'string') return undefined;
  const open = new Set(round.open.map((call) => call.id));
  const requests =
    previous?.executionId === executionId
      ? previous.requests.filter(
          (request) => open.has(request.toolCallId) && !admitted.has(request.actionId),
        )
      : [];
  return { executionId, requests: structuredClone(requests) };
}

/** Note each action whose effect admission is attempted: its outcome is no longer known not to exist. */
export function noteEffectAdmissions(
  journal: IRecoverableExecutionJournal,
  admitted: Set<string>,
): IRecoverableExecutionJournal {
  return {
    read: (executionId) => journal.read(executionId),
    append: (record) => {
      if (record.kind === 'tool-effect-start') admitted.add(record.actionId);
      return journal.append(record);
    },
  };
}

/**
 * Close the tool calls an abandoned round left open so the conversation stays well-formed. Nothing
 * runs and nothing is journaled; a call that awaited a response never started its effect.
 */
export function abandonedRoundResults(
  history: readonly TUniversalMessage[],
  pending: ISessionPendingExecution,
): TUniversalMessage[] {
  const round = lastRound(history);
  if (!round || round.assistant.metadata?.executionId !== pending.executionId) return [];
  const waiting = new Set(pending.requests.map((request) => request.toolCallId));
  return round.open.map((call) => {
    const error = waiting.has(call.id)
      ? 'Not run: the execution was abandoned while this call awaited a response.'
      : 'Execution abandoned before this call recorded a result; its outcome is unknown.';
    return createToolMessage(`Error: ${error}`, {
      toolCallId: call.id,
      name: call.function.name,
      metadata: { success: false, error, toolName: call.function.name },
    });
  });
}

/** Preserve typed persistence/recovery failures; only a durably parked execution becomes waiting. */
export async function recoverableSessionExecution(
  run: () => Promise<string>,
  journal: IRecoverableExecutionJournal,
): Promise<TSessionExecutionResult> {
  if (!journal || typeof journal.append !== 'function' || typeof journal.read !== 'function')
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_INVALID',
      'Recoverable Session execution requires a readable journal',
    );
  try {
    return { status: 'completed', response: await run() };
  } catch (error) {
    if (error instanceof ExecutionSuspendedError)
      return { status: 'waiting', requests: structuredClone(error.requests) };
    throw error;
  }
}
