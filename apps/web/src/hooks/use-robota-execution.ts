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
import { usePlayground } from '@/contexts/playground-context';
import type { PlaygroundExecutionResult, PlaygroundAgentConfig, PlaygroundTeamConfig } from '@/lib/playground/robota-executor';

export type ExecutionState = 'idle' | 'initializing' | 'running' | 'streaming' | 'error' | 'completed';

export interface RobotaExecutionHookReturn {
    // Execution State
    executionState: ExecutionState;
    isExecuting: boolean;
    isStreaming: boolean;
    canExecute: boolean;

    // Current Configuration
    currentAgentConfig: PlaygroundAgentConfig | null;
    currentTeamConfig: PlaygroundTeamConfig | null;
    currentMode: 'agent' | 'team';

    // Execution Results
    lastResult: PlaygroundExecutionResult | null;
    executionHistory: PlaygroundExecutionResult[];

    // Error Handling
    lastError: Error | null;
    errorCount: number;

    // Performance Metrics
    averageExecutionTime: number;
    totalExecutions: number;
    successRate: number;

    // Actions
    createAgent: (config: PlaygroundAgentConfig) => Promise<void>;
    createTeam: (config: PlaygroundTeamConfig) => Promise<void>;
    executePrompt: (prompt: string) => Promise<PlaygroundExecutionResult>;
    executeStreamPrompt: (prompt: string, onChunk?: (chunk: string) => void) => Promise<PlaygroundExecutionResult>;
    retryLastExecution: () => Promise<PlaygroundExecutionResult | null>;
    cancelExecution: () => void;
    clearExecutionHistory: () => void;

    // Streaming Control
    streamingResponse: string;
    clearStreamingResponse: () => void;

    // Configuration Helpers
    getDefaultAgentConfig: () => PlaygroundAgentConfig;
    getDefaultTeamConfig: () => PlaygroundTeamConfig;
    validateConfiguration: (config: PlaygroundAgentConfig | PlaygroundTeamConfig) => { isValid: boolean; errors: string[] };
}

export function useRobotaExecution(): RobotaExecutionHookReturn {
    const {
        state,
        createAgent: contextCreateAgent,
        createTeam: contextCreateTeam,
        executePrompt: contextExecutePrompt,
        executeStreamPrompt: contextExecuteStreamPrompt
    } = usePlayground();

    // Local state for execution management
    const [executionState, setExecutionState] = useState<ExecutionState>('idle');
    const [executionHistory, setExecutionHistory] = useState<PlaygroundExecutionResult[]>([]);
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
    const canExecute = state.isInitialized && !isExecuting && Boolean(state.currentAgentConfig || state.currentTeamConfig);

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
    const createAgent = useCallback(async (config: PlaygroundAgentConfig) => {
        try {
            setExecutionState('initializing');
            setLastError(null);

            await contextCreateAgent(config);

            setExecutionState('idle');
        } catch (error) {
            setExecutionState('error');
            setLastError(error instanceof Error ? error : new Error(String(error)));
            setErrorCount(prev => prev + 1);
            throw error;
        }
    }, [contextCreateAgent]);

    const createTeam = useCallback(async (config: PlaygroundTeamConfig) => {
        try {
            setExecutionState('initializing');
            setLastError(null);

            await contextCreateTeam(config);

            setExecutionState('idle');
        } catch (error) {
            setExecutionState('error');
            setLastError(error instanceof Error ? error : new Error(String(error)));
            setErrorCount(prev => prev + 1);
            throw error;
        }
    }, [contextCreateTeam]);

    const executePrompt = useCallback(async (prompt: string): Promise<PlaygroundExecutionResult> => {
        if (!canExecute) {
            throw new Error('Cannot execute: executor not ready or already running');
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
    ): Promise<PlaygroundExecutionResult> => {
        if (!canExecute) {
            throw new Error('Cannot execute: executor not ready or already running');
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

    const retryLastExecution = useCallback(async (): Promise<PlaygroundExecutionResult | null> => {
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
    const getDefaultAgentConfig = useCallback((): PlaygroundAgentConfig => {
        return {
            name: 'Default Agent',
            aiProviders: [],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4',
                temperature: 0.7,
                maxTokens: 2000,
                systemMessage: 'You are a helpful AI assistant.'
            },
            tools: [],
            plugins: [],
            metadata: {
                createdAt: new Date().toISOString(),
                version: '1.0.0'
            }
        };
    }, []);

    const getDefaultTeamConfig = useCallback((): PlaygroundTeamConfig => {
        return {
            name: 'Default Team',
            agents: [getDefaultAgentConfig()],
            workflow: {
                coordinator: 'round-robin',
                maxDepth: 3
            }
        };
    }, [getDefaultAgentConfig]);

    const validateConfiguration = useCallback((config: PlaygroundAgentConfig | PlaygroundTeamConfig): { isValid: boolean; errors: string[] } => {
        const errors: string[] = [];

        if (!config.name || config.name.trim().length === 0) {
            errors.push('Name is required');
        }

        if ('aiProviders' in config) {
            // Agent config validation
            if (!config.aiProviders || config.aiProviders.length === 0) {
                errors.push('At least one AI provider is required');
            }

            if (!config.defaultModel || !config.defaultModel.provider || !config.defaultModel.model) {
                errors.push('Default model configuration is required');
            }
        } else {
            // Team config validation
            if (!config.agents || config.agents.length === 0) {
                errors.push('At least one agent is required in a team');
            }

            // Validate each agent in the team
            config.agents.forEach((agent, index) => {
                const agentValidation = validateConfiguration(agent);
                if (!agentValidation.isValid) {
                    errors.push(`Agent ${index + 1}: ${agentValidation.errors.join(', ')}`);
                }
            });
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
        currentTeamConfig: state.currentTeamConfig,
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
        createTeam,
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
        getDefaultTeamConfig,
        validateConfiguration
    };
} 