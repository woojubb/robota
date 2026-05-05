import { useCallback } from 'react';

import type {
  IPlaygroundExecutorResult,
  PlaygroundExecutor,
  TPlaygroundMode,
} from '../../lib/playground/robota-executor';
import { PROMPT_PREVIEW_LENGTH } from './constants';
import { buildConversationEvents } from './conversation-events';
import type { TPlaygroundDispatch } from './types';

interface IRunExecutionInput {
  executor: PlaygroundExecutor;
  prompt: string;
  mode: TPlaygroundMode;
  executeFn: () => Promise<IPlaygroundExecutorResult>;
}

export function useRunExecutionAction(dispatch: TPlaygroundDispatch) {
  return useCallback(
    async ({
      executor,
      prompt,
      mode,
      executeFn,
    }: IRunExecutionInput): Promise<IPlaygroundExecutorResult> => {
      dispatch({ type: 'SET_EXECUTING', payload: true });
      dispatch({ type: 'SET_ERROR', payload: null });

      if (typeof executor.recordPlaygroundAction === 'function') {
        await executor.recordPlaygroundAction('chat_send', {
          prompt: prompt.substring(0, PROMPT_PREVIEW_LENGTH),
          mode,
        });
      }

      const result = await executeFn();
      dispatch({ type: 'SET_EXECUTION_RESULT', payload: result });
      if (!result.success) {
        dispatch({ type: 'SET_ERROR', payload: result.uiError?.message || 'Execution failed' });
      }

      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: buildConversationEvents(executor) });
      dispatch({ type: 'UPDATE_VISUALIZATION_DATA', payload: executor.getVisualizationData() });

      return result;
    },
    [dispatch],
  );
}
