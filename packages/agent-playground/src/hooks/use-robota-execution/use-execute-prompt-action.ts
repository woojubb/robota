import { useCallback } from 'react';
import type { IPlaygroundExecutorResult } from '../../lib/playground/robota-executor';
import { WebLogger } from '../../lib/web-logger';
import { clearExecutionTimeout, scheduleExecutionTimeout } from './execution-timeout';
import type { IExecutionLocalState, IRobotaExecutionContextActions } from './types';

export function useExecutePromptAction(
  contextActions: IRobotaExecutionContextActions,
  localState: IExecutionLocalState,
): (prompt: string) => Promise<IPlaygroundExecutorResult> {
  return useCallback(
    async (prompt: string): Promise<IPlaygroundExecutorResult> => {
      if (!localState.canExecute) {
        const error = new Error('Cannot execute: executor not ready or already running');
        WebLogger.warn('executePrompt blocked', { error: error.message });
        throw error;
      }

      try {
        localState.setExecutionState('running');
        localState.clearLastError();
        localState.setStreamingResponse('');
        localState.refs.lastPromptRef.current = prompt;
        scheduleExecutionTimeout(
          localState.refs.executionTimeoutRef,
          localState.setExecutionState,
          localState.recordError,
        );
        const result = await contextActions.executePrompt(prompt);
        clearExecutionTimeout(localState.refs.executionTimeoutRef);
        localState.setExecutionState('completed');
        return result;
      } catch (error) {
        clearExecutionTimeout(localState.refs.executionTimeoutRef);
        localState.setExecutionState('error');
        localState.recordError(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },
    [contextActions, localState],
  );
}
