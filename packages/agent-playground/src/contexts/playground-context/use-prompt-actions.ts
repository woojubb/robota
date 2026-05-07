import type { ILogger } from '@robota-sdk/agent-core';
import { useCallback } from 'react';

import type {
  IPlaygroundExecutorResult,
  PlaygroundExecutor,
} from '../../lib/playground/robota-executor';
import { buildErrorResult } from './execution-result';
import type { IPlaygroundRefs, TPlaygroundDispatch } from './types';

type TRunExecution = (input: {
  executor: PlaygroundExecutor;
  prompt: string;
  mode: IPlaygroundRefs['modeRef']['current'];
  executeFn: () => Promise<IPlaygroundExecutorResult>;
}) => Promise<IPlaygroundExecutorResult>;

export function usePromptActions(
  refs: Pick<IPlaygroundRefs, 'executorRef' | 'isInitializedRef' | 'modeRef'>,
  dispatch: TPlaygroundDispatch,
  runExecution: TRunExecution,
  logger: ILogger,
) {
  const executePrompt = useExecutePromptAction(refs, dispatch, runExecution);
  const executeStreamPrompt = useExecuteStreamPromptAction(refs, dispatch, runExecution, logger);

  return { executePrompt, executeStreamPrompt };
}

function useExecutePromptAction(
  refs: Pick<IPlaygroundRefs, 'executorRef' | 'isInitializedRef' | 'modeRef'>,
  dispatch: TPlaygroundDispatch,
  runExecution: TRunExecution,
) {
  return useCallback(
    async (prompt: string): Promise<IPlaygroundExecutorResult> => {
      const executor = getReadyExecutor(refs);
      try {
        return await runExecution({
          executor,
          prompt,
          mode: refs.modeRef.current,
          executeFn: () => executor.run(prompt),
        });
      } catch (error) {
        const executionError = error instanceof Error ? error : new Error(String(error));
        const errorResult = buildErrorResult(executionError);
        dispatch({ type: 'SET_EXECUTION_RESULT', payload: errorResult });
        dispatch({
          type: 'SET_ERROR',
          payload: errorResult.uiError?.message ?? 'Execution failed',
        });
        return errorResult;
      } finally {
        dispatch({ type: 'SET_EXECUTING', payload: false });
      }
    },
    [dispatch, refs, runExecution],
  );
}

function useExecuteStreamPromptAction(
  refs: Pick<IPlaygroundRefs, 'executorRef' | 'isInitializedRef' | 'modeRef'>,
  dispatch: TPlaygroundDispatch,
  runExecution: TRunExecution,
  logger: ILogger,
) {
  return useCallback(
    async (
      prompt: string,
      onChunk: (chunk: string) => void,
    ): Promise<IPlaygroundExecutorResult> => {
      const executor = getReadyExecutor(refs);
      try {
        return await runExecution({
          executor,
          prompt,
          mode: refs.modeRef.current,
          executeFn: () => executor.execute(prompt, onChunk),
        });
      } catch (error) {
        logger.error('executeStreamPrompt error', {
          error: error instanceof Error ? error.message : String(error),
        });
        const executionError = error instanceof Error ? error : new Error(String(error));
        const errorResult = buildErrorResult(executionError);
        dispatch({ type: 'SET_EXECUTION_RESULT', payload: errorResult });
        dispatch({
          type: 'SET_ERROR',
          payload: errorResult.uiError?.message ?? 'Execution failed',
        });
        return errorResult;
      } finally {
        dispatch({ type: 'SET_EXECUTING', payload: false });
      }
    },
    [dispatch, logger, refs, runExecution],
  );
}

function getReadyExecutor(
  refs: Pick<IPlaygroundRefs, 'executorRef' | 'isInitializedRef'>,
): PlaygroundExecutor {
  if (!refs.executorRef.current || !refs.isInitializedRef.current) {
    throw new Error('Executor not initialized');
  }
  return refs.executorRef.current;
}
