'use client';

/**
 * PlaygroundContext - Global State Management for Robota Playground
 * 
 * This context provides centralized state management for the Playground interface,
 * integrating with PlaygroundExecutor and real-time WebSocket communication.
 * 
 * Follows React best practices:
 * - Type-safe context with proper TypeScript definitions
 * - Separation of state and actions
 * - Error boundaries and loading states
 * - Real-time synchronization with backend
 */

import React, { createContext, useContext, useReducer, useEffect, useCallback, ReactNode, useRef } from 'react';
import { PlaygroundExecutor, type IPlaygroundExecutorResult, type IPlaygroundAgentConfig, type TPlaygroundMode, type IConversationEvent, type IVisualizationData } from '../lib/playground/robota-executor';
import { DefaultEventService, SilentLogger } from '@robota-sdk/agents';
import { getPlaygroundToolCatalog, type IPlaygroundToolMeta } from '../tools/catalog';

// ===== State Types =====

export interface IPlaygroundState {
    // Executor state
    executor: PlaygroundExecutor | null;
    isInitialized: boolean;
    isExecuting: boolean;

    // Configuration state
    mode: TPlaygroundMode;
    // Deprecated single-slot configs (kept for selection-only semantics)
    currentAgentConfig: IPlaygroundAgentConfig | null;
    // New multi-entity arrays
    agentConfigs: IPlaygroundAgentConfig[];

    // Conversation state
    conversationHistory: IConversationEvent[];
    lastExecutionResult: IPlaygroundExecutorResult | null;

    // Connection state
    isWebSocketConnected: boolean;
    serverUrl: string;
    authToken: string | null;
    userId: string | null;
    sessionId: string | null;

    // UI state
    isLoading: boolean;
    error: string | null;
    visualizationData: IVisualizationData | null;

    // Execution statistics - now managed by PlaygroundStatisticsPlugin
    executionStats: IPlaygroundExecutionStats;

    // Tools DnD state (UI overlay)
    toolItems: IPlaygroundToolMeta[];
    addedToolsByAgent: Record<string, string[]>;
}

export interface IPlaygroundExecutionStats {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
    lastExecutionTime: Date | null;
    blockCreations: number;
    uiInteractions: number;
    streamingExecutions: number;
    agentModeExecutions: number;
    successRate: number;
}

export type TPlaygroundReducerAction =
    | { type: 'SET_EXECUTOR'; payload: PlaygroundExecutor | null }
    | { type: 'SET_INITIALIZED'; payload: boolean }
    | { type: 'SET_AGENT_CONFIG'; payload: IPlaygroundAgentConfig | null }
    | { type: 'ADD_AGENT_CONFIG'; payload: IPlaygroundAgentConfig }
    | { type: 'UPDATE_AGENT_CONFIG'; payload: { index: number; config: IPlaygroundAgentConfig } }
    | { type: 'SET_EXECUTING'; payload: boolean }
    | { type: 'SET_WEBSOCKET_CONNECTED'; payload: boolean }
    | { type: 'SET_AUTH'; payload: { userId?: string; sessionId?: string; authToken?: string } }
    | { type: 'SET_LOADING'; payload: boolean }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'UPDATE_VISUALIZATION_DATA'; payload: Partial<IVisualizationData> }
    | { type: 'SET_MODE'; payload: TPlaygroundMode }
    | { type: 'ADD_CONVERSATION_EVENT'; payload: IConversationEvent }
    | { type: 'SET_CONVERSATION_HISTORY'; payload: IConversationEvent[] }
    | { type: 'CLEAR_CONVERSATION_HISTORY' }
    | { type: 'SET_EXECUTION_RESULT'; payload: IPlaygroundExecutorResult }
    | { type: 'SET_TOOL_ITEMS'; payload: IPlaygroundToolMeta[] }
    | { type: 'ADD_TOOL_TO_AGENT_OVERLAY'; payload: { agentId: string; toolId: string } };

// ===== Initial State =====

const initialState: IPlaygroundState = {
    executor: null,
    isInitialized: false,
    isExecuting: false,
    mode: 'agent',
    currentAgentConfig: null,
    agentConfigs: [],
    conversationHistory: [],
    lastExecutionResult: null,
    isWebSocketConnected: false,
    serverUrl: '',
    authToken: null,
    userId: null,
    sessionId: null,
    isLoading: false,
    error: null,
    visualizationData: null,
    // Execution Statistics - Now managed by PlaygroundStatisticsPlugin
    executionStats: {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        averageExecutionTime: 0,
        lastExecutionTime: null,
        blockCreations: 0,
        uiInteractions: 0,
        streamingExecutions: 0,
        agentModeExecutions: 0,
        successRate: 100,
    },
    toolItems: getPlaygroundToolCatalog(),
    addedToolsByAgent: {}
};

// ===== Reducer =====

function playgroundReducer(state: IPlaygroundState, action: TPlaygroundReducerAction): IPlaygroundState {
    switch (action.type) {
        case 'SET_EXECUTOR':
            return {
                ...state,
                executor: action.payload
            };

        case 'SET_INITIALIZED':
            return {
                ...state,
                isInitialized: action.payload,
                isLoading: false
            };

        case 'SET_EXECUTING':
            return {
                ...state,
                isExecuting: action.payload
            };

        case 'SET_MODE':
            return {
                ...state,
                mode: action.payload
            };

        case 'SET_AGENT_CONFIG':
            return {
                ...state,
                currentAgentConfig: action.payload,
                mode: 'agent'
            };

        case 'ADD_AGENT_CONFIG':
            return {
                ...state,
                agentConfigs: [...state.agentConfigs, action.payload],
                currentAgentConfig: action.payload,
                mode: 'agent'
            };

        case 'UPDATE_AGENT_CONFIG':
            return {
                ...state,
                agentConfigs: state.agentConfigs.map((cfg, i) => i === action.payload.index ? action.payload.config : cfg)
            };

        case 'ADD_CONVERSATION_EVENT':
            return {
                ...state,
                conversationHistory: [...state.conversationHistory, action.payload]
            };

        case 'SET_CONVERSATION_HISTORY':
            return {
                ...state,
                conversationHistory: action.payload
            };

        case 'CLEAR_CONVERSATION_HISTORY':
            return {
                ...state,
                conversationHistory: [],
                lastExecutionResult: null
            };

        case 'SET_EXECUTION_RESULT':
            {
                // Update execution statistics based on result
                const newStats: IPlaygroundExecutionStats = {
                    ...state.executionStats,
                    totalExecutions: state.executionStats.totalExecutions + 1,
                    successfulExecutions: state.executionStats.successfulExecutions + (action.payload.success ? 1 : 0),
                    failedExecutions: state.executionStats.failedExecutions + (action.payload.success ? 0 : 1),
                    averageExecutionTime: state.executionStats.totalExecutions > 0
                        ? (state.executionStats.averageExecutionTime * state.executionStats.totalExecutions + (action.payload.duration || 0)) / (state.executionStats.totalExecutions + 1)
                        : (action.payload.duration || 0),
                    lastExecutionTime: new Date()
                };

                return {
                    ...state,
                    lastExecutionResult: action.payload,
                    executionStats: newStats
                };
            }



        case 'SET_WEBSOCKET_CONNECTED':
            return {
                ...state,
                isWebSocketConnected: action.payload
            };

        case 'SET_AUTH':
            return {
                ...state,
                userId: action.payload.userId || null,
                sessionId: action.payload.sessionId || null,
                authToken: action.payload.authToken || null
            };

        case 'SET_LOADING':
            return {
                ...state,
                isLoading: action.payload
            };

        case 'SET_ERROR':
            return {
                ...state,
                error: action.payload,
                isLoading: false
            };

        case 'UPDATE_VISUALIZATION_DATA': {
            const baseVisualization: IVisualizationData = state.visualizationData ?? { events: [], agents: [] };
            return {
                ...state,
                visualizationData: {
                    ...baseVisualization,
                    ...action.payload
                }
            };
        }

        case 'SET_TOOL_ITEMS':
            return {
                ...state,
                toolItems: [...action.payload]
            };

        case 'ADD_TOOL_TO_AGENT_OVERLAY': {
            const { agentId, toolId } = action.payload;
            const prev = state.addedToolsByAgent[agentId] ?? [];
            const next = [...prev, toolId];
            return {
                ...state,
                addedToolsByAgent: {
                    ...state.addedToolsByAgent,
                    [agentId]: next
                }
            };
        }
        default:
            return state;
    }
}

// ===== Context Definition =====

interface IPlaygroundContextValue {
    // State
    state: IPlaygroundState;

    // Actions
    createAgent: (config: IPlaygroundAgentConfig) => Promise<void>;
    addAgentConfig: (config: IPlaygroundAgentConfig) => void;
    updateAgentConfig: (index: number, config: IPlaygroundAgentConfig) => void;
    executePrompt: (prompt: string) => Promise<IPlaygroundExecutorResult>;
    executeStreamPrompt: (prompt: string, onChunk: (chunk: string) => void) => Promise<IPlaygroundExecutorResult>;
    clearHistory: () => void;
    setAuth: (userId: string, sessionId: string, authToken: string) => void;
    disposeExecutor: () => Promise<void>;
    setExecuting: (isExecuting: boolean) => void;
    setToolItems: (tools: IPlaygroundToolMeta[]) => void;
    addToolToAgentOverlay: (agentId: string, toolId: string) => void;

    // Getters
    getVisualizationData: () => IVisualizationData | null;
    getConnectionStatus: () => { connected: boolean; url: string };
}

const PlaygroundContext = createContext<IPlaygroundContextValue | undefined>(undefined);

// ===== Provider Component =====

interface IPlaygroundProviderProps {
    children: ReactNode;
    defaultServerUrl?: string;
}

export function PlaygroundProvider({ children, defaultServerUrl = '' }: IPlaygroundProviderProps) {
    const logger = SilentLogger;
    logger.debug('PlaygroundProvider rendering', { defaultServerUrl });

    const [state, dispatch] = useReducer(playgroundReducer, {
        ...initialState,
        serverUrl: defaultServerUrl
    });

    logger.debug('PlaygroundProvider state', { hasExecutor: !!state.executor });

    // Use ref to track executor for cleanup without causing re-renders
    const executorRef = useRef<PlaygroundExecutor | null>(null);

    // Auto-initialize executor on mount
    useEffect(() => {
        logger.debug('Executor init effect triggered', { hasExecutor: !!state.executor, defaultServerUrl });
        if (!state.executor && defaultServerUrl) {
            try {
                logger.debug('Creating PlaygroundExecutor');

                const eventService = new DefaultEventService();

                const executor = new PlaygroundExecutor(defaultServerUrl, 'playground-token', {
                    logger,
                    eventService
                });

                // Update state and ref
                dispatch({ type: 'SET_INITIALIZED', payload: true });
                dispatch({ type: 'SET_EXECUTOR', payload: executor });
                executorRef.current = executor;
                logger.debug('PlaygroundExecutor created and stored');

            } catch (error) {
                logger.error('Failed to create executor', { error: error instanceof Error ? error.message : String(error) });
                dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to create executor' });
            }
        }
    }, [defaultServerUrl]); // Only run when defaultServerUrl changes

    // Event System Setup for Tool Call and Agent Creation (REMOVED manual mutations)
    useEffect(() => {
        // UI does not manually mutate workflow anymore. SDK is the single source of truth.
    }, [state.executor, state.mode, state.isInitialized]);

    // ===== Executor Management =====

    const createAgent = useCallback(async (config: IPlaygroundAgentConfig) => {
        if (!state.executor || !state.isInitialized) {
            const error = new Error('Executor not initialized');
            logger.error('Executor not ready', { error: error.message });
            throw error;
        }

        try {
            dispatch({ type: 'SET_LOADING', payload: true });
            await state.executor.createAgent(config);
            dispatch({ type: 'ADD_AGENT_CONFIG', payload: config });
            dispatch({ type: 'SET_LOADING', payload: false });
        } catch (error) {
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to create agent' });
            dispatch({ type: 'SET_LOADING', payload: false });
            throw error; // Re-throw error so useRobotaExecution can handle it
        }
    }, [state.executor, state.isInitialized]);

    const executePrompt = useCallback(async (prompt: string): Promise<IPlaygroundExecutorResult> => {
        if (!state.executor || !state.isInitialized) {
            throw new Error('Executor not initialized');
        }

        try {
            dispatch({ type: 'SET_EXECUTING', payload: true });
            dispatch({ type: 'SET_ERROR', payload: null });

            // Record UI interaction - chat send
            if (typeof state.executor.recordPlaygroundAction === 'function') {
                await state.executor.recordPlaygroundAction('chat_send', {
                    prompt: prompt.substring(0, 100), // First 100 chars for tracking
                    mode: state.mode
                });
            }

            // Execute via PlaygroundExecutor (which handles statistics automatically)
            const result = await state.executor.run(prompt);

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: result });
            if (!result.success) {
                dispatch({ type: 'SET_ERROR', payload: result.uiError?.message || 'Execution failed' });
            }

            // Get all events from PlaygroundHistoryPlugin (EventService events)
            let allEvents: IConversationEvent[] = [];
            if (typeof state.executor.getPlaygroundEvents === 'function') {
                allEvents = state.executor.getPlaygroundEvents();
            } else {
                // Compatibility conversion: convert basic TUniversalMessage[] to IConversationEvent[].
                const history = state.executor.getHistory();
                allEvents = history.map((msg, index) => ({
                    id: `msg_${index}_${msg.timestamp?.getTime() || Date.now()}`,
                    type: msg.role === 'user' ? 'user_message' as const : 'assistant_response' as const,
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || ''),
                    timestamp: msg.timestamp || new Date(),
                    parentEventId: undefined,
                    childEventIds: [],
                    executionLevel: 0,
                    executionPath: 'basic',
                    metadata: typeof msg.metadata === 'object' && msg.metadata !== null ?
                        JSON.parse(JSON.stringify(msg.metadata)) : {}
                }));
            }

            dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: allEvents });

            // Update visualization data with latest stats from plugin
            let pluginStats = { totalEvents: allEvents.length, totalToolCalls: 0, averageResponseTime: result.duration || 0 };
            if (typeof state.executor.getPlaygroundStatistics === 'function') {
                const stats = state.executor.getPlaygroundStatistics();
                pluginStats = {
                    totalEvents: stats.totalChatExecutions,
                    totalToolCalls: 0, // Will be enhanced later
                    averageResponseTime: stats.averageResponseTime
                };
            }

            const vizData: IVisualizationData = state.executor.getVisualizationData();

            dispatch({ type: 'UPDATE_VISUALIZATION_DATA', payload: vizData });

            return result;

        } catch (error) {
            const errorResult: IPlaygroundExecutorResult = {
                success: false,
                response: 'Execution failed',
                duration: 0,
                error: error instanceof Error ? error : new Error(String(error)),
                uiError: { kind: 'recoverable', message: error instanceof Error ? error.message : 'Execution failed' }
            };

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: errorResult });
            dispatch({ type: 'SET_ERROR', payload: errorResult.uiError?.message ?? 'Execution failed' });

            return errorResult;
        } finally {
            dispatch({ type: 'SET_EXECUTING', payload: false });
        }
    }, [state.executor, state.isInitialized, state.visualizationData, state.mode]);

    const executeStreamPrompt = useCallback(async (
        prompt: string,
        onChunk: (chunk: string) => void
    ): Promise<IPlaygroundExecutorResult> => {
        if (!state.executor || !state.isInitialized) {
            throw new Error('Executor not initialized');
        }

        try {
            dispatch({ type: 'SET_EXECUTING', payload: true });
            dispatch({ type: 'SET_ERROR', payload: null });

            logger.debug('Executing prompt via real workflow system');
            const timestamp = Date.now();

            // Record UI interaction - streaming chat send
            if (typeof state.executor.recordPlaygroundAction === 'function') {
                await state.executor.recordPlaygroundAction('chat_send', {
                    prompt: prompt.substring(0, 100),
                    mode: state.mode,
                    streaming: true
                });
            }

            // Example 26 alignment: minimal executor.execute call flow.
            logger.debug('Starting execution with prompt', { preview: prompt.substring(0, 100) });

            const result = await state.executor.execute(prompt, onChunk);

            logger.debug('Execution completed');

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: result });
            if (!result.success) {
                dispatch({ type: 'SET_ERROR', payload: result.uiError?.message || 'Execution failed' });
            }

            // SDK owns workflow updates; no manual node status mutation

            // SDK owns workflow graph; do not add artificial response nodes/edges

            // Sync conversation history from executor (central source of truth)
            // Get all events from PlaygroundHistoryPlugin (EventService events)
            let allEvents: IConversationEvent[] = [];
            if (typeof state.executor.getPlaygroundEvents === 'function') {
                allEvents = state.executor.getPlaygroundEvents();
            } else {
                // Compatibility conversion: convert basic TUniversalMessage[] to IConversationEvent[].
                const history = state.executor.getHistory();
                allEvents = history.map((msg, index) => ({
                    id: `msg_${index}_${msg.timestamp?.getTime() || Date.now()}`,
                    type: msg.role === 'user' ? 'user_message' as const : 'assistant_response' as const,
                    content: msg.content || '',
                    timestamp: msg.timestamp || new Date(),
                    parentEventId: undefined,
                    childEventIds: [],
                    executionLevel: 0,
                    executionPath: 'basic',
                    metadata: msg.metadata || {}
                }));
            }

            dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: allEvents });

            // Update visualization data with latest stats from plugin
            let pluginStats = { totalEvents: allEvents.length, totalToolCalls: 0, averageResponseTime: 0 };
            if (typeof state.executor.getPlaygroundStatistics === 'function') {
                const stats = state.executor.getPlaygroundStatistics();
                pluginStats = {
                    totalEvents: stats.totalChatExecutions,
                    totalToolCalls: 0, // Will be enhanced later
                    averageResponseTime: stats.averageResponseTime
                };
            }

            const vizData: IVisualizationData = state.executor.getVisualizationData();

            dispatch({ type: 'UPDATE_VISUALIZATION_DATA', payload: vizData });

            return result;

        } catch (error) {
            logger.error('executeStreamPrompt error', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                hasExecutor: !!state.executor,
                isInitialized: state.isInitialized
            });

            const errorResult: IPlaygroundExecutorResult = {
                success: false,
                response: 'Execution failed',
                duration: 0,
                error: error instanceof Error ? error : new Error(String(error)),
                uiError: { kind: 'recoverable', message: error instanceof Error ? error.message : 'Execution failed' }
            };

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: errorResult });
            dispatch({ type: 'SET_ERROR', payload: errorResult.uiError?.message ?? 'Execution failed' });

            // SDK owns workflow updates; no manual node status mutation

            return errorResult;
        } finally {
            dispatch({ type: 'SET_EXECUTING', payload: false });
        }
    }, [state.executor, state.isInitialized, state.visualizationData, state.mode]);

    const clearHistory = useCallback(() => {
        if (state.executor && state.isInitialized) {
            state.executor.clearHistory();
        }
        dispatch({ type: 'CLEAR_CONVERSATION_HISTORY' });
    }, [state.executor, state.isInitialized]);

    const setAuth = useCallback((userId: string, sessionId: string, authToken: string) => {
        dispatch({ type: 'SET_AUTH', payload: { userId, sessionId, authToken } });

        if (executorRef.current) {
            executorRef.current.updateAuth(userId, sessionId, authToken);
        }
    }, []);

    const disposeExecutor = useCallback(async () => {
        if (executorRef.current) {
            try {
                await executorRef.current.dispose();
                executorRef.current = null;
            } catch (error) {
                logger.error('Error disposing executor', { error: error instanceof Error ? error.message : String(error) });
            }
        }
        // Dispose is handled by setting state.executor to null.
    }, []);

    const setToolItems = useCallback((tools: IPlaygroundToolMeta[]) => {
        dispatch({ type: 'SET_TOOL_ITEMS', payload: tools });
    }, []);

    const addToolToAgentOverlay = useCallback((agentId: string, toolId: string) => {
        dispatch({ type: 'ADD_TOOL_TO_AGENT_OVERLAY', payload: { agentId, toolId } });
    }, []);

    const setExecuting = useCallback((isExecuting: boolean) => {
        dispatch({ type: 'SET_EXECUTING', payload: isExecuting });
    }, []);



    // ===== Getters =====

    const getVisualizationData = useCallback((): IVisualizationData | null => {
        return state.visualizationData;
    }, [state.visualizationData]);

    const getConnectionStatus = useCallback(() => {
        return {
            connected: state.isWebSocketConnected,
            url: state.serverUrl
        };
    }, [state.isWebSocketConnected, state.serverUrl]);

    // ===== Effects =====

    // Monitor WebSocket connection status
    useEffect(() => {
        if (state.executor) {
            const executor = state.executor;
            const checkConnection = () => {
                const isConnected = executor.isWebSocketConnected();
                if (isConnected !== state.isWebSocketConnected) {
                    dispatch({ type: 'SET_WEBSOCKET_CONNECTED', payload: isConnected });
                }
            };

            const interval = setInterval(checkConnection, 1000);
            return () => clearInterval(interval);
        }
        return;
    }, [state.executor, state.isWebSocketConnected]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Clean up executor on unmount using ref
            if (executorRef.current) {
                executorRef.current.dispose().catch((error) => {
                    logger.error('Executor dispose failed', { error: error instanceof Error ? error.message : String(error) });
                });
            }
        };
    }, []); // Empty dependency array - only cleanup on unmount

    // ===== Context Value =====

    const contextValue: IPlaygroundContextValue = {
        state,
        createAgent,
        addAgentConfig: (config) => dispatch({ type: 'ADD_AGENT_CONFIG', payload: config }),
        updateAgentConfig: (index, config) => dispatch({ type: 'UPDATE_AGENT_CONFIG', payload: { index, config } }),
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor,
        setExecuting,
        setToolItems,
        addToolToAgentOverlay,
        getVisualizationData,
        getConnectionStatus
    };

    return (
        <PlaygroundContext.Provider value={contextValue}>
            {children}
        </PlaygroundContext.Provider>
    );
}

// ===== Hook =====

export function usePlayground() {
    const context = useContext(PlaygroundContext);
    if (context === undefined) {
        throw new Error('usePlayground must be used within a PlaygroundProvider');
    }
    return context;
}

// ===== Additional Hooks =====

export function usePlaygroundState() {
    const { state } = usePlayground();
    return state;
}

export function usePlaygroundActions() {
    const {
        createAgent,
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor
    } = usePlayground();

    return {
        createAgent,
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor
    };
} 
