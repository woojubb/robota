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
/** An execution parked on saved waits; the Session accepts no new input until it is resumed or abandoned. */
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

/**
 * Close the tool calls an abandoned round left open so the conversation stays well-formed. Nothing
 * runs and nothing is journaled; a call that awaited a response never started its effect.
 */
export function abandonedRoundResults(
  history: readonly TUniversalMessage[],
  pending: ISessionPendingExecution,
): TUniversalMessage[] {
  const index = history.findLastIndex((message) => message.role === 'assistant');
  const assistant = history[index];
  if (assistant?.role !== 'assistant' || assistant.metadata?.executionId !== pending.executionId)
    return [];
  const answered = new Set(
    history
      .slice(index + 1)
      .flatMap((message) => (message.role === 'tool' ? [message.toolCallId] : [])),
  );
  const waiting = new Set(pending.requests.map((request) => request.toolCallId));
  return (assistant.toolCalls ?? [])
    .filter((call) => !answered.has(call.id))
    .map((call) => {
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
