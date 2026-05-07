import { useCallback } from 'react';
import type { IPlaygroundExecutorResult } from '../../lib/playground/robota-executor';
import { WebLogger } from '../../lib/web-logger';
import type { IExecutionLocalState, IRobotaExecutionContextActions } from './types';

export function useExecuteStreamPromptAction(
  contextActions: IRobotaExecutionContextActions,
  localState: IExecutionLocalState,
): (prompt: string, onChunk?: (chunk: string) => void) => Promise<IPlaygroundExecutorResult> {
  return useCallback(
    async (
      prompt: string,
      onChunk?: (chunk: string) => void,
    ): Promise<IPlaygroundExecutorResult> => {
      if (!localState.canExecute) {
        const error = new Error('Cannot execute: executor not ready or already running');
        WebLogger.warn('executeStreamPrompt blocked', { error: error.message });
        throw error;
      }

      try {
        localState.setExecutionState('streaming');
        localState.clearLastError();
        localState.setStreamingResponse('');
        localState.refs.lastPromptRef.current = prompt;
        const result = await contextActions.executeStreamPrompt(prompt, (chunk: string) => {
          localState.setStreamingResponse((previous) => previous + chunk);
          onChunk?.(chunk);
        });
        localState.setExecutionState('completed');
        return result;
      } catch (error) {
        localState.setExecutionState('error');
        localState.recordError(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },
    [contextActions, localState],
  );
}
