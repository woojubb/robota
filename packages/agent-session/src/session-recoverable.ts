import { ExecutionRecoveryError, ExecutionSuspendedError } from '@robota-sdk/agent-core';
import type {
  IRecoverableExecutionJournal,
  IResumeExecutionOptions,
  IToolWaitRequest,
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
