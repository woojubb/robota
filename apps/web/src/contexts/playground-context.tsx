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
import { PlaygroundExecutor, type PlaygroundExecutionResult, type PlaygroundAgentConfig, type PlaygroundTeamConfig, type PlaygroundMode, type ConversationEvent, type PlaygroundVisualizationData } from '@/lib/playground/robota-executor';
import { DefaultConsoleLogger } from '@robota-sdk/agents';

// ===== State Types =====

export interface PlaygroundState {
    // Executor state
    executor: PlaygroundExecutor | null;
    isInitialized: boolean;
    isExecuting: boolean;

    // Configuration state
    mode: PlaygroundMode;
    currentAgentConfig: PlaygroundAgentConfig | null;
    currentTeamConfig: PlaygroundTeamConfig | null;

    // Conversation state
    conversationHistory: ConversationEvent[];
    lastExecutionResult: PlaygroundExecutionResult | null;

    // Connection state
    isWebSocketConnected: boolean;
    serverUrl: string;
    authToken: string | null;
    userId: string | null;
    sessionId: string | null;

    // UI state
    isLoading: boolean;
    error: string | null;
    visualizationData: PlaygroundVisualizationData | null;
    // Execution Statistics - Now managed by PlaygroundStatisticsPlugin
    executionStats: {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        averageExecutionTime: 0,
        lastExecutionTime: null,
        // Additional statistics from PlaygroundStatisticsPlugin
        blockCreations: 0,
        uiInteractions: 0,
        streamingExecutions: 0,
        agentModeExecutions: 0,
        teamModeExecutions: 0,
        successRate: 100
    };
}

export type PlaygroundAction =
    | { type: 'SET_EXECUTOR'; payload: PlaygroundExecutor | null }
    | { type: 'SET_INITIALIZED'; payload: boolean }
    | { type: 'SET_AGENT_CONFIG'; payload: PlaygroundAgentConfig | null }
    | { type: 'SET_TEAM_CONFIG'; payload: PlaygroundTeamConfig | null }
    | { type: 'SET_EXECUTING'; payload: boolean }
    | { type: 'SET_WEBSOCKET_CONNECTED'; payload: boolean }
    | { type: 'SET_AUTH'; payload: { userId?: string; sessionId?: string; authToken?: string } }
    | { type: 'SET_LOADING'; payload: boolean }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'UPDATE_VISUALIZATION_DATA'; payload: Partial<PlaygroundVisualizationData> };

// ===== Initial State =====

const initialState: PlaygroundState = {
    executor: null,
    isInitialized: false,
    isExecuting: false,
    mode: 'agent',
    currentAgentConfig: null,
    currentTeamConfig: null,
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
        // Additional statistics from PlaygroundStatisticsPlugin
        blockCreations: 0,
        uiInteractions: 0,
        streamingExecutions: 0,
        agentModeExecutions: 0,
        teamModeExecutions: 0,
        successRate: 100
    }
};

// ===== Reducer =====

function playgroundReducer(state: PlaygroundState, action: PlaygroundAction): PlaygroundState {
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

        case 'SET_TEAM_CONFIG':
            return {
                ...state,
                currentTeamConfig: action.payload,
                mode: 'team'
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
            // Update execution statistics based on result
            const newStats = {
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

        case 'UPDATE_EXECUTION_STATS':
            const { success, duration } = action.payload;
            const updatedStats = {
                totalExecutions: state.executionStats.totalExecutions + 1,
                successfulExecutions: state.executionStats.successfulExecutions + (success ? 1 : 0),
                failedExecutions: state.executionStats.failedExecutions + (success ? 0 : 1),
                averageExecutionTime: state.executionStats.totalExecutions > 0
                    ? (state.executionStats.averageExecutionTime * state.executionStats.totalExecutions + duration) / (state.executionStats.totalExecutions + 1)
                    : duration,
                lastExecutionTime: new Date()
            };

            return {
                ...state,
                executionStats: updatedStats
            };

        case 'SET_WEBSOCKET_CONNECTED':
            return {
                ...state,
                isWebSocketConnected: action.payload
            };

        case 'SET_AUTH':
            return {
                ...state,
                userId: action.payload.userId,
                sessionId: action.payload.sessionId,
                authToken: action.payload.authToken
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

        case 'UPDATE_VISUALIZATION_DATA':
            return {
                ...state,
                visualizationData: {
                    ...state.visualizationData,
                    ...action.payload
                }
            };

        case 'DISPOSE_EXECUTOR':
            return {
                ...initialState
            };

        default:
            return state;
    }
}

// ===== Context Definition =====

interface PlaygroundContextValue {
    // State
    state: PlaygroundState;

    // Actions
    createAgent: (config: PlaygroundAgentConfig) => Promise<void>;
    createTeam: (config: PlaygroundTeamConfig) => Promise<void>;
    executePrompt: (prompt: string) => Promise<PlaygroundExecutionResult>;
    executeStreamPrompt: (prompt: string, onChunk: (chunk: string) => void) => Promise<PlaygroundExecutionResult>;
    clearHistory: () => void;
    setAuth: (userId: string, sessionId: string, authToken: string) => void;
    disposeExecutor: () => Promise<void>;

    // Getters
    getVisualizationData: () => PlaygroundVisualizationData | null;
    getConnectionStatus: () => { connected: boolean; url: string };
}

const PlaygroundContext = createContext<PlaygroundContextValue | undefined>(undefined);

// ===== Provider Component =====

interface PlaygroundProviderProps {
    children: ReactNode;
    defaultServerUrl?: string;
}

export function PlaygroundProvider({ children, defaultServerUrl = '' }: PlaygroundProviderProps) {
    const [state, dispatch] = useReducer(playgroundReducer, {
        ...initialState,
        serverUrl: defaultServerUrl
    });

    // Use ref to track executor for cleanup without causing re-renders
    const executorRef = useRef<PlaygroundExecutor | null>(null);

    // Auto-initialize executor on mount
    useEffect(() => {
        if (!state.executor && defaultServerUrl) {
            try {
                // Create executor directly (no separate initialization needed)
                const executor = new PlaygroundExecutor(
                    defaultServerUrl,
                    'playground-token',
                    DefaultConsoleLogger // Add logger for development
                );

                // Update state and ref
                dispatch({ type: 'SET_INITIALIZED', payload: true });
                dispatch({ type: 'SET_EXECUTOR', payload: executor });
                executorRef.current = executor;

            } catch (error) {
                dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to create executor' });
            }
        }
    }, [defaultServerUrl]); // Only run when defaultServerUrl changes

    // ===== Executor Management =====

    const createAgent = useCallback(async (config: PlaygroundAgentConfig) => {
        if (!state.executor || !state.isInitialized) {
            const error = new Error('Executor not initialized');
            console.error('❌ Executor not ready:', error);
            throw error;
        }

        try {
            dispatch({ type: 'SET_LOADING', payload: true });
            await state.executor.createAgent(config);
            dispatch({ type: 'SET_AGENT_CONFIG', payload: config });
            dispatch({ type: 'SET_LOADING', payload: false });
        } catch (error) {
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to create agent' });
            dispatch({ type: 'SET_LOADING', payload: false });
            throw error; // Re-throw error so useRobotaExecution can handle it
        }
    }, [state.executor, state.isInitialized]);

    const createTeam = useCallback(async (config: PlaygroundTeamConfig) => {
        if (!state.executor || !state.isInitialized) {
            throw new Error('Executor not initialized');
        }

        try {
            dispatch({ type: 'SET_LOADING', payload: true });
            await state.executor.createTeam(config);
            dispatch({ type: 'SET_TEAM_CONFIG', payload: config });
            dispatch({ type: 'SET_LOADING', payload: false });
        } catch (error) {
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to create team' });
            dispatch({ type: 'SET_LOADING', payload: false });
            throw error; // Re-throw error so useRobotaExecution can handle it
        }
    }, [state.executor, state.isInitialized]);

    const executePrompt = useCallback(async (prompt: string): Promise<PlaygroundExecutionResult> => {
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

            // Sync conversation history from executor (central source of truth)
            const history = state.executor.getHistory(); // UniversalMessage[]

            // Convert UniversalMessage[] to ConversationEvent[] for UI display
            const chatEvents = history.map((msg, index) => ({
                id: `msg_${index}_${msg.timestamp?.getTime() || Date.now()}`,
                type: msg.role === 'user' ? 'user_message' as const : 'assistant_response' as const,
                content: msg.content || '',
                timestamp: msg.timestamp || new Date(),
                metadata: msg.metadata || {}
            }));

            dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: chatEvents });

            // Update visualization data with latest stats from plugin
            let pluginStats = { totalEvents: chatEvents.length, totalToolCalls: 0, averageResponseTime: result.duration || 0 };
            if (typeof state.executor.getPlaygroundStatistics === 'function') {
                const stats = state.executor.getPlaygroundStatistics();
                pluginStats = {
                    totalEvents: stats.totalChatExecutions,
                    totalToolCalls: 0, // Will be enhanced later
                    averageResponseTime: stats.averageResponseTime
                };
            }

            const vizData = {
                mode: state.visualizationData?.mode || state.mode,
                events: chatEvents,
                agents: state.visualizationData?.agents || [],
                stats: pluginStats
            };

            dispatch({ type: 'UPDATE_VISUALIZATION_DATA', payload: vizData });

            return result;

        } catch (error) {
            const errorResult: PlaygroundExecutionResult = {
                success: false,
                response: 'Execution failed',
                duration: 0,
                error: error instanceof Error ? error : new Error(String(error))
            };

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: errorResult });
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Execution failed' });

            return errorResult;
        } finally {
            dispatch({ type: 'SET_EXECUTING', payload: false });
        }
    }, [state.executor, state.isInitialized, state.visualizationData, state.mode]);

    const executeStreamPrompt = useCallback(async (
        prompt: string,
        onChunk: (chunk: string) => void
    ): Promise<PlaygroundExecutionResult> => {
        if (!state.executor || !state.isInitialized) {
            throw new Error('Executor not initialized');
        }

        try {
            dispatch({ type: 'SET_EXECUTING', payload: true });
            dispatch({ type: 'SET_ERROR', payload: null });

            // Record UI interaction - streaming chat send
            if (typeof state.executor.recordPlaygroundAction === 'function') {
                await state.executor.recordPlaygroundAction('chat_send', {
                    prompt: prompt.substring(0, 100),
                    mode: state.mode,
                    streaming: true
                });
            }

            // Process stream (PlaygroundExecutor handles statistics automatically)
            let fullResponse = '';

            for await (const chunk of state.executor.runStream(prompt)) {
                fullResponse += chunk;
                onChunk(chunk);
            }

            const result: PlaygroundExecutionResult = {
                success: true,
                response: fullResponse,
                duration: 0 // Duration tracked by PlaygroundStatisticsPlugin
            };

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: result });

            // Sync conversation history from executor (central source of truth)
            const history = state.executor.getHistory(); // UniversalMessage[]

            // Convert UniversalMessage[] to ConversationEvent[] for UI display
            const chatEvents = history.map((msg, index) => ({
                id: `msg_${index}_${msg.timestamp?.getTime() || Date.now()}`,
                type: msg.role === 'user' ? 'user_message' as const : 'assistant_response' as const,
                content: msg.content || '',
                timestamp: msg.timestamp || new Date(),
                metadata: msg.metadata || {}
            }));

            dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: chatEvents });

            // Update visualization data with latest stats from plugin
            let pluginStats = { totalEvents: chatEvents.length, totalToolCalls: 0, averageResponseTime: 0 };
            if (typeof state.executor.getPlaygroundStatistics === 'function') {
                const stats = state.executor.getPlaygroundStatistics();
                pluginStats = {
                    totalEvents: stats.totalChatExecutions,
                    totalToolCalls: 0, // Will be enhanced later
                    averageResponseTime: stats.averageResponseTime
                };
            }

            const vizData = {
                mode: state.visualizationData?.mode || state.mode,
                events: chatEvents,
                agents: state.visualizationData?.agents || [],
                stats: pluginStats
            };

            dispatch({ type: 'UPDATE_VISUALIZATION_DATA', payload: vizData });

            return result;

        } catch (error) {
            console.error('❌ executeStreamPrompt error in context:', error);
            console.error('❌ Context error details:', {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                prompt,
                hasExecutor: !!state.executor,
                isInitialized: state.isInitialized
            });

            const errorResult: PlaygroundExecutionResult = {
                success: false,
                response: 'Execution failed',
                duration: 0,
                error: error instanceof Error ? error : new Error(String(error))
            };

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: errorResult });
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Execution failed' });

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
            // Update executor auth (if method exists)
            (executorRef.current as any).updateAuth?.(userId, sessionId, authToken);
        }
    }, []);

    const disposeExecutor = useCallback(async () => {
        if (executorRef.current) {
            try {
                await executorRef.current.dispose();
                executorRef.current = null;
            } catch (error) {
                console.error('Error disposing executor:', error);
            }
        }
        dispatch({ type: 'DISPOSE_EXECUTOR' });
    }, []);

    // ===== Getters =====

    const getVisualizationData = useCallback((): PlaygroundVisualizationData | null => {
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
            const checkConnection = () => {
                const isConnected = (state.executor as any).isWebSocketConnected?.() || false;
                if (isConnected !== state.isWebSocketConnected) {
                    dispatch({ type: 'SET_WEBSOCKET_CONNECTED', payload: isConnected });
                }
            };

            const interval = setInterval(checkConnection, 1000);
            return () => clearInterval(interval);
        }
    }, [state.executor, state.isWebSocketConnected]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Clean up executor on unmount using ref
            if (executorRef.current) {
                executorRef.current.dispose().catch(console.error);
            }
        };
    }, []); // Empty dependency array - only cleanup on unmount

    // ===== Context Value =====

    const contextValue: PlaygroundContextValue = {
        state,
        createAgent,
        createTeam,
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor,
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
        createTeam,
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor
    } = usePlayground();

    return {
        createAgent,
        createTeam,
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor
    };
} 