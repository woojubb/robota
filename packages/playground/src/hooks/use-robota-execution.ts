'use client';

/**
 * useRobotaExecution - Agent Execution State Hook
 * 
 * Specialized hook for managing Robota agent and team execution operations.
 * Provides state management for execution flows, error handling, and real-time updates.
 * 
 * This hook handles:
 * - Agent/Team creation and configuration
 * - Execution state tracking (idle, running, streaming, error)
 * - Real-time prompt execution with streaming support
 * - Error recovery and retry logic
 * - Performance monitoring and statistics
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { usePlayground } from '../contexts/playground-context';
import type { IPlaygroundExecutorResult, IPlaygroundAgentConfig } from '../lib/playground/robota-executor';
import { WebLogger } from '../lib/web-logger';

export type TExecutionState = 'idle' | 'initializing' | 'running' | 'streaming' | 'error' | 'completed';

export interface IRobotaExecutionHookReturn {
    // Execution State
    executionState: TExecutionState;
    isExecuting: boolean;
    isStreaming: boolean;
    canExecute: boolean;

    // Current Configuration
    currentAgentConfig: IPlaygroundAgentConfig | null;
    currentMode: 'agent';

    // Execution Results
    lastResult: IPlaygroundExecutorResult | null;
    executionHistory: IPlaygroundExecutorResult[];

    // Error Handling
    lastError: Error | null;
    errorCount: number;

    // Performance Metrics
    averageExecutionTime: number;
    totalExecutions: number;
    successRate: number;

    // Actions
    createAgent: (config: IPlaygroundAgentConfig) => Promise<void>;
    executePrompt: (prompt: string) => Promise<IPlaygroundExecutorResult>;
    executeStreamPrompt: (prompt: string, onChunk?: (chunk: string) => void) => Promise<IPlaygroundExecutorResult>;
    retryLastExecution: () => Promise<IPlaygroundExecutorResult | null>;
    cancelExecution: () => void;
    clearExecutionHistory: () => void;

    // Streaming Control
    streamingResponse: string;
    clearStreamingResponse: () => void;

    // Configuration Helpers
    getDefaultAgentConfig: () => IPlaygroundAgentConfig;
    validateConfiguration: (config: IPlaygroundAgentConfig) => { isValid: boolean; errors: string[] };
}

export function useRobotaExecution(): IRobotaExecutionHookReturn {
    const {
        state,
        createAgent: contextCreateAgent,
        executePrompt: contextExecutePrompt,
        executeStreamPrompt: contextExecuteStreamPrompt
    } = usePlayground();

    // Local state for execution management
    const [executionState, setExecutionState] = useState<TExecutionState>('idle');
    const [executionHistory, setExecutionHistory] = useState<IPlaygroundExecutorResult[]>([]);
    const [lastError, setLastError] = useState<Error | null>(null);
    const [errorCount, setErrorCount] = useState(0);
    const [streamingResponse, setStreamingResponse] = useState('');

    // Refs for tracking execution
    const lastPromptRef = useRef<string>('');
    const executionTimeouRef = useRef<NodeJS.Timeout | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Derived state
    const isExecuting = state.isExecuting || executionState === 'running' || executionState === 'streaming';
    const isStreaming = executionState === 'streaming';
    const canExecute = state.isInitialized && !isExecuting && Boolean(state.currentAgentConfig);

    // Debug log for canExecute (only when values change)
    useEffect(() => {
        WebLogger.debug('canExecute state check', {
            isInitialized: state.isInitialized,
            isExecuting: isExecuting,
            hasAgentConfig: !!state.currentAgentConfig,
            canExecute: canExecute,
            executionState: executionState
        });
    }, [state.isInitialized, isExecuting, state.currentAgentConfig, canExecute, executionState]);

    // Performance metrics
    const averageExecutionTime = executionHistory.length > 0
        ? executionHistory.reduce((sum, result) => sum + result.duration, 0) / executionHistory.length
        : 0;

    const totalExecutions = executionHistory.length;

    const successRate = totalExecutions > 0
        ? (executionHistory.filter(result => result.success).length / totalExecutions) * 100
        : 0;

    // Update execution state based on context state
    useEffect(() => {
        if (state.isExecuting && executionState === 'idle') {
            setExecutionState('running');
        } else if (!state.isExecuting && (executionState === 'running' || executionState === 'streaming')) {
            setExecutionState('completed');

            // Auto-reset to idle after a short delay
            setTimeout(() => {
                setExecutionState('idle');
            }, 1000);
        }
    }, [state.isExecuting, executionState]);

    // Update execution history when new results arrive
    useEffect(() => {
        if (state.lastExecutionResult &&
            !executionHistory.find(result => result === state.lastExecutionResult)) {
            setExecutionHistory(prev => [...prev, state.lastExecutionResult!]);

            if (state.lastExecutionResult.error) {
                setLastError(state.lastExecutionResult.error);
                setErrorCount(prev => prev + 1);
            } else {
                setLastError(null);
            }
        }
    }, [state.lastExecutionResult, executionHistory]);

    // Actions
    const createAgent = useCallback(async (config: IPlaygroundAgentConfig) => {
        try {
            setExecutionState('initializing');
            setLastError(null);

            await contextCreateAgent(config);

            setExecutionState('idle');
        } catch (error) {
            WebLogger.error('createAgent error', { error: error instanceof Error ? error.message : String(error) });
            setExecutionState('error');
            setLastError(error instanceof Error ? error : new Error(String(error)));
            setErrorCount(prev => prev + 1);
            throw error;
        }
    }, [contextCreateAgent]);

    const executePrompt = useCallback(async (prompt: string): Promise<IPlaygroundExecutorResult> => {
        if (!canExecute) {
            const error = new Error('Cannot execute: executor not ready or already running');
            WebLogger.warn('executePrompt blocked', { error: error.message });
            throw error;
        }

        try {
            setExecutionState('running');
            setLastError(null);
            setStreamingResponse('');
            lastPromptRef.current = prompt;

            // Set execution timeout
            const timeoutMs = 30000; // 30 seconds
            executionTimeouRef.current = setTimeout(() => {
                setExecutionState('error');
                setLastError(new Error('Execution timeout'));
            }, timeoutMs);

            const result = await contextExecutePrompt(prompt);

            // Clear timeout
            if (executionTimeouRef.current) {
                clearTimeout(executionTimeouRef.current);
                executionTimeouRef.current = null;
            }

            setExecutionState('completed');
            return result;

        } catch (error) {
            setExecutionState('error');
            setLastError(error instanceof Error ? error : new Error(String(error)));
            setErrorCount(prev => prev + 1);

            // Clear timeout
            if (executionTimeouRef.current) {
                clearTimeout(executionTimeouRef.current);
                executionTimeouRef.current = null;
            }

            throw error;
        }
    }, [canExecute, contextExecutePrompt]);

    const executeStreamPrompt = useCallback(async (
        prompt: string,
        onChunk?: (chunk: string) => void
    ): Promise<IPlaygroundExecutorResult> => {
        if (!canExecute) {
            const error = new Error('Cannot execute: executor not ready or already running');
            WebLogger.warn('executeStreamPrompt blocked', { error: error.message });
            throw error;
        }

        try {
            setExecutionState('streaming');
            setLastError(null);
            setStreamingResponse('');
            lastPromptRef.current = prompt;

            const result = await contextExecuteStreamPrompt(prompt, (chunk: string) => {
                setStreamingResponse(prev => prev + chunk);
                onChunk?.(chunk);
            });

            setExecutionState('completed');
            return result;

        } catch (error) {
            setExecutionState('error');
            setLastError(error instanceof Error ? error : new Error(String(error)));
            setErrorCount(prev => prev + 1);
            throw error;
        }
    }, [canExecute, contextExecuteStreamPrompt]);

    const retryLastExecution = useCallback(async (): Promise<IPlaygroundExecutorResult | null> => {
        if (!lastPromptRef.current) {
            return null;
        }

        return executePrompt(lastPromptRef.current);
    }, [executePrompt]);

    const cancelExecution = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        if (executionTimeouRef.current) {
            clearTimeout(executionTimeouRef.current);
            executionTimeouRef.current = null;
        }

        setExecutionState('idle');
        setStreamingResponse('');
    }, []);

    const clearExecutionHistory = useCallback(() => {
        setExecutionHistory([]);
        setErrorCount(0);
        setLastError(null);
    }, []);

    const clearStreamingResponse = useCallback(() => {
        setStreamingResponse('');
    }, []);

    // Configuration helpers
    const getDefaultAgentConfig = useCallback((): IPlaygroundAgentConfig => {
        return {
            name: 'New Agent',
            aiProviders: [],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                temperature: 0.6,
                maxTokens: 2000,
                systemMessage: ''
            },
            tools: [],
            plugins: []
        };
    }, []);

    const validateConfiguration = useCallback((config: IPlaygroundAgentConfig): { isValid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (!config.name || config.name.trim().length === 0) {
            errors.push('Name is required');
        }

            if (!config.aiProviders || config.aiProviders.length === 0) {
                errors.push('At least one AI provider is required');
            }

            if (!config.defaultModel || !config.defaultModel.provider || !config.defaultModel.model) {
                errors.push('Default model configuration is required');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (executionTimeouRef.current) {
                clearTimeout(executionTimeouRef.current);
            }
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    return {
        // Execution State
        executionState,
        isExecuting,
        isStreaming,
        canExecute,

        // Current Configuration
        currentAgentConfig: state.currentAgentConfig,
        currentMode: state.mode,

        // Execution Results
        lastResult: state.lastExecutionResult,
        executionHistory,

        // Error Handling
        lastError,
        errorCount,

        // Performance Metrics
        averageExecutionTime,
        totalExecutions,
        successRate,

        // Actions
        createAgent,
        executePrompt,
        executeStreamPrompt,
        retryLastExecution,
        cancelExecution,
        clearExecutionHistory,

        // Streaming Control
        streamingResponse,
        clearStreamingResponse,

        // Configuration Helpers
        getDefaultAgentConfig,
        validateConfiguration
    };
} 