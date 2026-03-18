'use client';

const PROMPT_PREVIEW_LENGTH = 100;
const WS_CHECK_INTERVAL_MS = 1000;

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
  useRef,
} from 'react';
import {
  PlaygroundExecutor,
  type IPlaygroundExecutorResult,
  type IPlaygroundAgentConfig,
  type TPlaygroundMode,
  type IConversationEvent,
  type IVisualizationData,
} from '../lib/playground/robota-executor';
import { SilentLogger } from '@robota-sdk/agents';
import { DefaultEventService } from '@robota-sdk/event-service';
import type { IPlaygroundToolMeta } from '../tools/catalog';
import {
  type IPlaygroundState,
  type IPlaygroundExecutionStats,
  type TPlaygroundReducerAction,
  initialState,
  playgroundReducer,
} from './playground-reducer';

export type {
  IPlaygroundState,
  IPlaygroundExecutionStats,
  TPlaygroundReducerAction,
} from './playground-reducer';

interface IPlaygroundActionsValue {
  createAgent: (config: IPlaygroundAgentConfig) => Promise<void>;
  addAgentConfig: (config: IPlaygroundAgentConfig) => void;
  updateAgentConfig: (index: number, config: IPlaygroundAgentConfig) => void;
  executePrompt: (prompt: string) => Promise<IPlaygroundExecutorResult>;
  executeStreamPrompt: (
    prompt: string,
    onChunk: (chunk: string) => void,
  ) => Promise<IPlaygroundExecutorResult>;
  clearHistory: () => void;
  setAuth: (userId: string, sessionId: string, authToken: string) => void;
  disposeExecutor: () => Promise<void>;
  setExecuting: (isExecuting: boolean) => void;
  setToolItems: (tools: IPlaygroundToolMeta[]) => void;
  addToolToAgentOverlay: (agentId: string, toolId: string) => void;
  getVisualizationData: () => IVisualizationData | null;
  getConnectionStatus: () => { connected: boolean; url: string };
}

/** @deprecated Use usePlaygroundState() or usePlaygroundActions() for better performance. */
interface IPlaygroundContextValue extends IPlaygroundActionsValue {
  state: IPlaygroundState;
}

const PlaygroundStateContext = createContext<IPlaygroundState | undefined>(undefined);
const PlaygroundActionsContext = createContext<IPlaygroundActionsValue | undefined>(undefined);

interface IPlaygroundProviderProps {
  children: ReactNode;
  defaultServerUrl?: string;
}

export function PlaygroundProvider({ children, defaultServerUrl = '' }: IPlaygroundProviderProps) {
  const logger = SilentLogger;
  const [state, dispatch] = useReducer(playgroundReducer, defaultServerUrl, (url) => ({
    ...initialState,
    serverUrl: url,
  }));
  const executorRef = useRef<PlaygroundExecutor | null>(null);
  const isInitializedRef = useRef(state.isInitialized);
  isInitializedRef.current = state.isInitialized;
  const modeRef = useRef(state.mode);
  modeRef.current = state.mode;

  useEffect(() => {
    if (!state.executor && defaultServerUrl) {
      try {
        const eventService = new DefaultEventService();
        const executor = new PlaygroundExecutor(defaultServerUrl, 'playground-token', {
          logger,
          eventService,
        });
        dispatch({ type: 'SET_INITIALIZED', payload: true });
        dispatch({ type: 'SET_EXECUTOR', payload: executor });
        executorRef.current = executor;
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          payload: error instanceof Error ? error.message : 'Failed to create executor',
        });
      }
    }
  }, [defaultServerUrl]);

  const createAgent = useCallback(async (config: IPlaygroundAgentConfig) => {
    if (!executorRef.current || !isInitializedRef.current)
      throw new Error('Executor not initialized');
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      await executorRef.current.createAgent(config);
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
  }, []);

  const runExecution = useCallback(
    async (
      executor: PlaygroundExecutor,
      prompt: string,
      mode: TPlaygroundMode,
      executeFn: () => Promise<IPlaygroundExecutorResult>,
    ): Promise<IPlaygroundExecutorResult> => {
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
    [],
  );

  const executePrompt = useCallback(
    async (prompt: string): Promise<IPlaygroundExecutorResult> => {
      if (!executorRef.current || !isInitializedRef.current)
        throw new Error('Executor not initialized');
      const executor = executorRef.current;
      try {
        return await runExecution(executor, prompt, modeRef.current, () => executor.run(prompt));
      } catch (error) {
        const errorResult = buildErrorResult(error);
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
    [runExecution],
  );

  const executeStreamPrompt = useCallback(
    async (
      prompt: string,
      onChunk: (chunk: string) => void,
    ): Promise<IPlaygroundExecutorResult> => {
      if (!executorRef.current || !isInitializedRef.current)
        throw new Error('Executor not initialized');
      const executor = executorRef.current;
      try {
        return await runExecution(executor, prompt, modeRef.current, () =>
          executor.execute(prompt, onChunk),
        );
      } catch (error) {
        logger.error('executeStreamPrompt error', {
          error: error instanceof Error ? error.message : String(error),
        });
        const errorResult = buildErrorResult(error);
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
    [runExecution],
  );

  const clearHistory = useCallback(() => {
    if (executorRef.current && isInitializedRef.current) executorRef.current.clearHistory();
    dispatch({ type: 'CLEAR_CONVERSATION_HISTORY' });
  }, []);

  const setAuth = useCallback((userId: string, sessionId: string, authToken: string) => {
    dispatch({ type: 'SET_AUTH', payload: { userId, sessionId, authToken } });
    if (executorRef.current) executorRef.current.updateAuth(userId, sessionId, authToken);
  }, []);

  const disposeExecutor = useCallback(async () => {
    if (executorRef.current) {
      try {
        await executorRef.current.dispose();
        executorRef.current = null;
      } catch (error) {
        logger.error('Error disposing executor', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }, []);

  const wsConnectedRef = useRef(state.isWebSocketConnected);
  wsConnectedRef.current = state.isWebSocketConnected;

  useEffect(() => {
    if (state.executor) {
      const executor = state.executor;
      const checkConnection = () => {
        const isConnected = executor.isWebSocketConnected();
        if (isConnected !== wsConnectedRef.current)
          dispatch({ type: 'SET_WEBSOCKET_CONNECTED', payload: isConnected });
      };
      const interval = setInterval(checkConnection, WS_CHECK_INTERVAL_MS);
      return () => clearInterval(interval);
    }
    return;
  }, [state.executor]);

  useEffect(() => {
    return () => {
      if (executorRef.current) {
        executorRef.current.dispose().catch((error) => {
          logger.error('Executor dispose failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    };
  }, []);

  const addAgentConfig = useCallback(
    (config: IPlaygroundAgentConfig) => dispatch({ type: 'ADD_AGENT_CONFIG', payload: config }),
    [],
  );
  const updateAgentConfig = useCallback(
    (index: number, config: IPlaygroundAgentConfig) =>
      dispatch({ type: 'UPDATE_AGENT_CONFIG', payload: { index, config } }),
    [],
  );
  const setExecuting = useCallback(
    (isExecuting: boolean) => dispatch({ type: 'SET_EXECUTING', payload: isExecuting }),
    [],
  );
  const setToolItems = useCallback(
    (tools: IPlaygroundToolMeta[]) => dispatch({ type: 'SET_TOOL_ITEMS', payload: tools }),
    [],
  );
  const addToolToAgentOverlay = useCallback(
    (agentId: string, toolId: string) =>
      dispatch({ type: 'ADD_TOOL_TO_AGENT_OVERLAY', payload: { agentId, toolId } }),
    [],
  );
  const visualizationDataRef = useRef(state.visualizationData);
  visualizationDataRef.current = state.visualizationData;
  const getVisualizationData = useCallback(
    (): IVisualizationData | null => visualizationDataRef.current,
    [],
  );

  const connectionStatusRef = useRef({
    connected: state.isWebSocketConnected,
    url: state.serverUrl,
  });
  connectionStatusRef.current = { connected: state.isWebSocketConnected, url: state.serverUrl };
  const getConnectionStatus = useCallback(() => connectionStatusRef.current, []);

  const actionsValue: IPlaygroundActionsValue = useMemo(
    () => ({
      createAgent,
      addAgentConfig,
      updateAgentConfig,
      executePrompt,
      executeStreamPrompt,
      clearHistory,
      setAuth,
      disposeExecutor,
      setExecuting,
      setToolItems,
      addToolToAgentOverlay,
      getVisualizationData,
      getConnectionStatus,
    }),
    [
      createAgent,
      addAgentConfig,
      updateAgentConfig,
      executePrompt,
      executeStreamPrompt,
      clearHistory,
      setAuth,
      disposeExecutor,
      setExecuting,
      setToolItems,
      addToolToAgentOverlay,
      getVisualizationData,
      getConnectionStatus,
    ],
  );

  return (
    <PlaygroundStateContext.Provider value={state}>
      <PlaygroundActionsContext.Provider value={actionsValue}>
        {children}
      </PlaygroundActionsContext.Provider>
    </PlaygroundStateContext.Provider>
  );
}

export function usePlaygroundState(): IPlaygroundState {
  const state = useContext(PlaygroundStateContext);
  if (state === undefined)
    throw new Error('usePlaygroundState must be used within a PlaygroundProvider');
  return state;
}

export function usePlaygroundActions(): IPlaygroundActionsValue {
  const actions = useContext(PlaygroundActionsContext);
  if (actions === undefined)
    throw new Error('usePlaygroundActions must be used within a PlaygroundProvider');
  return actions;
}

/**
 * Returns both state and actions. Prefer usePlaygroundState() or usePlaygroundActions()
 * when you only need one — this hook re-renders on every state change.
 */
export function usePlayground(): IPlaygroundContextValue {
  const state = usePlaygroundState();
  const actions = usePlaygroundActions();
  return useMemo(() => ({ state, ...actions }), [state, actions]);
}

function buildConversationEvents(executor: PlaygroundExecutor): IConversationEvent[] {
  if (typeof executor.getPlaygroundEvents === 'function') return executor.getPlaygroundEvents();
  const history = executor.getHistory();
  return history.map((msg, index) => ({
    id: `msg_${index}_${msg.timestamp?.getTime() || Date.now()}`,
    type: msg.role === 'user' ? ('user_message' as const) : ('assistant_response' as const),
    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || ''),
    timestamp: msg.timestamp || new Date(),
    parentEventId: undefined,
    childEventIds: [],
    executionLevel: 0,
    executionPath: 'basic',
    metadata:
      typeof msg.metadata === 'object' && msg.metadata !== null
        ? JSON.parse(JSON.stringify(msg.metadata))
        : {},
  }));
}

function buildErrorResult(error: unknown): IPlaygroundExecutorResult {
  return {
    success: false,
    response: 'Execution failed',
    duration: 0,
    error: error instanceof Error ? error : new Error(String(error)),
    uiError: {
      kind: 'recoverable',
      message: error instanceof Error ? error.message : 'Execution failed',
    },
  };
}
