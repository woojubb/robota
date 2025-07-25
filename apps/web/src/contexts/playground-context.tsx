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
}

export type PlaygroundAction =
    | { type: 'INITIALIZE_EXECUTOR'; payload: { serverUrl: string; userId?: string; sessionId?: string; authToken?: string } }
    | { type: 'SET_EXECUTOR'; payload: PlaygroundExecutor | null }
    | { type: 'SET_INITIALIZED'; payload: boolean }
    | { type: 'SET_EXECUTING'; payload: boolean }
    | { type: 'SET_MODE'; payload: PlaygroundMode }
    | { type: 'SET_AGENT_CONFIG'; payload: PlaygroundAgentConfig }
    | { type: 'SET_TEAM_CONFIG'; payload: PlaygroundTeamConfig }
    | { type: 'ADD_CONVERSATION_EVENT'; payload: ConversationEvent }
    | { type: 'SET_CONVERSATION_HISTORY'; payload: ConversationEvent[] }
    | { type: 'CLEAR_CONVERSATION_HISTORY' }
    | { type: 'SET_EXECUTION_RESULT'; payload: PlaygroundExecutionResult }
    | { type: 'SET_WEBSOCKET_CONNECTED'; payload: boolean }
    | { type: 'SET_AUTH'; payload: { userId: string; sessionId: string; authToken: string } }
    | { type: 'SET_LOADING'; payload: boolean }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'SET_VISUALIZATION_DATA'; payload: PlaygroundVisualizationData }
    | { type: 'DISPOSE_EXECUTOR' };

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
    visualizationData: null
};

// ===== Reducer =====

function playgroundReducer(state: PlaygroundState, action: PlaygroundAction): PlaygroundState {
    switch (action.type) {
        case 'INITIALIZE_EXECUTOR':
            return {
                ...state,
                serverUrl: action.payload.serverUrl,
                userId: action.payload.userId || null,
                sessionId: action.payload.sessionId || null,
                authToken: action.payload.authToken || null,
                isLoading: true,
                error: null
            };

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
            return {
                ...state,
                lastExecutionResult: action.payload,
                isExecuting: false
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

        case 'SET_VISUALIZATION_DATA':
            return {
                ...state,
                visualizationData: action.payload
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
    initializeExecutor: (config: { serverUrl: string; userId?: string; sessionId?: string; authToken?: string }) => Promise<void>;
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

    // ===== Executor Management =====

    const initializeExecutor = useCallback(async (config: { serverUrl: string; userId?: string; sessionId?: string; authToken?: string }) => {
        try {
            dispatch({ type: 'INITIALIZE_EXECUTOR', payload: config });

            // Dispose existing executor if any
            if (executorRef.current) {
                await executorRef.current.dispose();
                executorRef.current = null;
            }

            // Create new executor
            const executor = new PlaygroundExecutor(
                config.serverUrl,
                config.userId,
                config.sessionId,
                config.authToken
            );

            // Initialize executor
            await executor.initialize();

            // Update state and ref
            dispatch({ type: 'SET_INITIALIZED', payload: true });
            dispatch({ type: 'SET_EXECUTOR', payload: executor });
            executorRef.current = executor;

        } catch (error) {
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to initialize executor' });
        }
    }, []);

    const createAgent = useCallback(async (config: PlaygroundAgentConfig) => {
        if (!state.executor || !state.isInitialized) {
            throw new Error('Executor not initialized');
        }

        try {
            dispatch({ type: 'SET_LOADING', payload: true });
            await state.executor.createAgent(config);
            dispatch({ type: 'SET_AGENT_CONFIG', payload: config });
            dispatch({ type: 'SET_LOADING', payload: false });
        } catch (error) {
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to create agent' });
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
        }
    }, [state.executor, state.isInitialized]);

    const executePrompt = useCallback(async (prompt: string): Promise<PlaygroundExecutionResult> => {
        if (!state.executor || !state.isInitialized) {
            throw new Error('Executor not initialized');
        }

        try {
            dispatch({ type: 'SET_EXECUTING', payload: true });
            dispatch({ type: 'SET_ERROR', payload: null });

            const result = await state.executor.run(prompt);

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: result });

            // Get updated conversation history and convert to chat events for UI
            const history = state.executor.getHistory(); // UniversalMessage[]
            dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: history });

            // Convert UniversalMessage[] to chat events for UI display
            const chatEvents = history.map((msg, index) => ({
                id: `msg_${index}_${msg.timestamp?.getTime() || Date.now()}`,
                type: msg.role === 'user' ? 'user_message' as const : 'assistant_response' as const,
                content: msg.content,
                timestamp: msg.timestamp || new Date(),
                metadata: msg.metadata || {}
            }));

            const vizData = {
                mode: state.visualizationData?.mode || 'agent' as const,
                events: chatEvents,
                agents: state.visualizationData?.agents || [],
                stats: {
                    totalEvents: chatEvents.length,
                    totalToolCalls: 0,
                    averageResponseTime: result.duration || 0
                }
            };

            dispatch({ type: 'SET_VISUALIZATION_DATA', payload: vizData });

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
    }, [state.executor, state.isInitialized, state.visualizationData]);

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

            const startTime = Date.now();

            // Process stream and collect chunks
            let fullResponse = '';

            for await (const chunk of state.executor.runStream(prompt)) {
                fullResponse += chunk;
                onChunk(chunk);
            }

            const duration = Date.now() - startTime;

            const result: PlaygroundExecutionResult = {
                success: true,
                response: fullResponse,
                duration
            };

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: result });

            // Get updated conversation history and convert to chat events for UI
            const history = state.executor.getHistory(); // UniversalMessage[]
            dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: history });

            // Convert UniversalMessage[] to chat events for UI display
            const chatEvents = history.map((msg, index) => ({
                id: `msg_${index}_${msg.timestamp?.getTime() || Date.now()}`,
                type: msg.role === 'user' ? 'user_message' as const : 'assistant_response' as const,
                content: msg.content,
                timestamp: msg.timestamp || new Date(),
                metadata: msg.metadata || {}
            }));

            const vizData = {
                mode: state.visualizationData?.mode || 'agent' as const,
                events: chatEvents,
                agents: state.visualizationData?.agents || [],
                stats: {
                    totalEvents: chatEvents.length,
                    totalToolCalls: 0,
                    averageResponseTime: duration
                }
            };

            dispatch({ type: 'SET_VISUALIZATION_DATA', payload: vizData });

            return result;

        } catch (error) {
            const errorResult: PlaygroundExecutionResult = {
                success: false,
                response: 'Stream execution failed',
                duration: 0,
                error: error instanceof Error ? error : new Error(String(error))
            };

            dispatch({ type: 'SET_EXECUTION_RESULT', payload: errorResult });
            dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Stream execution failed' });

            return errorResult;
        } finally {
            dispatch({ type: 'SET_EXECUTING', payload: false });
        }
    }, [state.executor, state.isInitialized, state.visualizationData]);

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
        initializeExecutor,
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
        initializeExecutor,
        createAgent,
        createTeam,
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor
    } = usePlayground();

    return {
        initializeExecutor,
        createAgent,
        createTeam,
        executePrompt,
        executeStreamPrompt,
        clearHistory,
        setAuth,
        disposeExecutor
    };
} 