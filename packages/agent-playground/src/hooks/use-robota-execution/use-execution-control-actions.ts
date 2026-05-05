import { useCallback } from 'react';
import type { IPlaygroundExecutorResult } from '../../lib/playground/robota-executor';
import { clearExecutionTimeout } from './execution-timeout';
import type { IExecutionLocalState } from './types';

interface IExecutionControlActions {
  retryLastExecution: () => Promise<IPlaygroundExecutorResult | null>;
  cancelExecution: () => void;
  clearStreamingResponse: () => void;
}

export function useExecutionControlActions(
  localState: IExecutionLocalState,
  executePrompt: (prompt: string) => Promise<IPlaygroundExecutorResult>,
): IExecutionControlActions {
  const retryLastExecution = useCallback(async (): Promise<IPlaygroundExecutorResult | null> => {
    if (!localState.refs.lastPromptRef.current) {
      return null;
    }

    return executePrompt(localState.refs.lastPromptRef.current);
  }, [executePrompt, localState.refs.lastPromptRef]);

  const cancelExecution = useCallback(() => {
    if (localState.refs.abortControllerRef.current) {
      localState.refs.abortControllerRef.current.abort();
    }

    clearExecutionTimeout(localState.refs.executionTimeoutRef);
    localState.setExecutionState('idle');
    localState.setStreamingResponse('');
  }, [localState]);

  const clearStreamingResponse = useCallback(() => {
    localState.setStreamingResponse('');
  }, [localState]);

  return {
    retryLastExecution,
    cancelExecution,
    clearStreamingResponse,
  };
}
