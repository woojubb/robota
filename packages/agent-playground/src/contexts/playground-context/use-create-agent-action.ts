import { useCallback } from 'react';

import type { IPlaygroundAgentConfig } from '../../lib/playground/robota-executor';
import type { IPlaygroundRefs, TPlaygroundDispatch } from './types';

export function useCreateAgentAction(
  refs: Pick<IPlaygroundRefs, 'executorRef' | 'isInitializedRef'>,
  dispatch: TPlaygroundDispatch,
) {
  return useCallback(
    async (config: IPlaygroundAgentConfig) => {
      if (!refs.executorRef.current || !refs.isInitializedRef.current) {
        throw new Error('Executor not initialized');
      }
      try {
        dispatch({ type: 'SET_LOADING', payload: true });
        await refs.executorRef.current.createAgent(config);
        dispatch({ type: 'ADD_AGENT_CONFIG', payload: config });
        dispatch({ type: 'SET_LOADING', payload: false });
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload: error instanceof Error ? error.message : 'Failed to create agent',
        });
        dispatch({ type: 'SET_LOADING', payload: false });
        throw error;
      }
    },
    [dispatch, refs.executorRef, refs.isInitializedRef],
  );
}
