import type { ILogger } from '@robota-sdk/agent-core';
import { useCallback } from 'react';

import type { IPlaygroundAgentConfig } from '../../lib/playground/robota-executor';
import type { IPlaygroundToolMeta } from '../../tools/catalog';
import type { IPlaygroundRefs, TPlaygroundDispatch } from './types';

export function useCommonActions(
  refs: Pick<
    IPlaygroundRefs,
    'executorRef' | 'isInitializedRef' | 'visualizationDataRef' | 'connectionStatusRef'
  >,
  dispatch: TPlaygroundDispatch,
  logger: ILogger,
) {
  const historyAuthActions = useHistoryAuthActions(refs, dispatch, logger);
  const stateUpdateActions = useStateUpdateActions(dispatch);
  const refGetters = useRefGetters(refs);

  return {
    ...historyAuthActions,
    ...stateUpdateActions,
    ...refGetters,
  };
}

function useHistoryAuthActions(
  refs: Pick<IPlaygroundRefs, 'executorRef' | 'isInitializedRef'>,
  dispatch: TPlaygroundDispatch,
  logger: ILogger,
) {
  const clearHistory = useCallback(() => {
    if (refs.executorRef.current && refs.isInitializedRef.current) {
      refs.executorRef.current.clearHistory();
    }
    dispatch({ type: 'CLEAR_CONVERSATION_HISTORY' });
  }, [dispatch, refs.executorRef, refs.isInitializedRef]);

  const setAuth = useCallback(
    (userId: string, sessionId: string, authToken: string) => {
      dispatch({ type: 'SET_AUTH', payload: { userId, sessionId, authToken } });
      if (refs.executorRef.current)
        refs.executorRef.current.updateAuth(userId, sessionId, authToken);
    },
    [dispatch, refs.executorRef],
  );

  const disposeExecutor = useCallback(async () => {
    if (!refs.executorRef.current) return;
    try {
      await refs.executorRef.current.dispose();
      refs.executorRef.current = null;
    } catch (error) {
      logger.error('Error disposing executor', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [logger, refs.executorRef]);

  return {
    clearHistory,
    setAuth,
    disposeExecutor,
  };
}

function useStateUpdateActions(dispatch: TPlaygroundDispatch) {
  const addAgentConfig = useCallback(
    (config: IPlaygroundAgentConfig) => dispatch({ type: 'ADD_AGENT_CONFIG', payload: config }),
    [dispatch],
  );

  const updateAgentConfig = useCallback(
    (index: number, config: IPlaygroundAgentConfig) =>
      dispatch({ type: 'UPDATE_AGENT_CONFIG', payload: { index, config } }),
    [dispatch],
  );

  const setExecuting = useCallback(
    (isExecuting: boolean) => dispatch({ type: 'SET_EXECUTING', payload: isExecuting }),
    [dispatch],
  );

  const setToolItems = useCallback(
    (tools: IPlaygroundToolMeta[]) => dispatch({ type: 'SET_TOOL_ITEMS', payload: tools }),
    [dispatch],
  );

  const addToolToAgentOverlay = useCallback(
    (agentId: string, toolId: string) =>
      dispatch({ type: 'ADD_TOOL_TO_AGENT_OVERLAY', payload: { agentId, toolId } }),
    [dispatch],
  );

  return {
    addAgentConfig,
    updateAgentConfig,
    setExecuting,
    setToolItems,
    addToolToAgentOverlay,
  };
}

function useRefGetters(
  refs: Pick<IPlaygroundRefs, 'visualizationDataRef' | 'connectionStatusRef'>,
) {
  const getVisualizationData = useCallback(
    () => refs.visualizationDataRef.current,
    [refs.visualizationDataRef],
  );

  const getConnectionStatus = useCallback(
    () => refs.connectionStatusRef.current,
    [refs.connectionStatusRef],
  );

  return {
    getVisualizationData,
    getConnectionStatus,
  };
}
