/**
 * usePlaygroundStatistics Hook
 *
 * React hook for consuming Playground statistics.
 * - Pulls metrics from PlaygroundExecutor
 * - Supports periodic refresh for real-time updates
 * - Uses memoization for UI-friendly derived values
 *
 * @example
 * ```tsx
 * function SystemStatusPanel() {
 *   const {
 *     chatExecutions,
 *     averageResponseTime,
 *     errorCount,
 *     isLoading,
 *     lastUpdated
 *   } = usePlaygroundStatistics();
 * 
 *   return (
 *     <div>
 *       <p>Total Executions: {chatExecutions}</p>
 *       <p>Avg Response: {averageResponseTime}ms</p>
 *       <p>Errors: {errorCount}</p>
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePlayground } from '../contexts/playground-context';
import type { IPlaygroundMetrics } from '../types/playground-statistics';
import type { PlaygroundExecutor } from '../lib/playground/robota-executor';
import { WebLogger } from '../lib/web-logger';
import type { TUniversalValue } from '@robota-sdk/agents';

type TPlaygroundActionName = Parameters<PlaygroundExecutor['recordPlaygroundAction']>[0];

/**
 * Hook return type - UI-friendly derived statistics
 */
export interface IPlaygroundStatisticsHookResult {
    // Core execution metrics
    chatExecutions: number;
    agentExecutions: number;
    teamExecutions: number;
    streamingExecutions: number;

    // UI interaction metrics
    blockCreations: number;
    uiInteractions: number;

    // Performance metrics
    averageResponseTime: number;
    lastExecutionTime: number | null;
    formattedResponseTime: string;

    // Quality indicators
    errorCount: number;
    successRate: number;

    // State
    isActive: boolean;
    isLoading: boolean;
    lastUpdated: Date;

    // Actions
    recordAction: (actionName: TPlaygroundActionName, metadata?: Record<string, TUniversalValue>) => Promise<void>;
    recordBlockCreation: (blockType: string, metadata?: Record<string, TUniversalValue>) => Promise<void>;
    resetStatistics: () => void;
}

/**
 * Default statistics (used while loading or when executor is unavailable)
 */
const defaultStatistics: IPlaygroundStatisticsHookResult = {
    chatExecutions: 0,
    agentExecutions: 0,
    teamExecutions: 0,
    streamingExecutions: 0,
    blockCreations: 0,
    uiInteractions: 0,
    averageResponseTime: 0,
    lastExecutionTime: null,
    formattedResponseTime: '0ms',
    errorCount: 0,
    successRate: 100,
    isActive: false,
    isLoading: true,
    lastUpdated: new Date(),
    recordAction: async () => { },
    recordBlockCreation: async () => { },
    resetStatistics: () => { }
};

/**
 * usePlaygroundStatistics Hook
 *
 * Pulls statistics from PlaygroundExecutor and returns UI-friendly values.
 */
export function usePlaygroundStatistics(): IPlaygroundStatisticsHookResult {
    const { state } = usePlayground();
    const [rawStatistics, setRawStatistics] = useState<IPlaygroundMetrics | null>(null);

    // Type guard for executor availability
    const executor = state.executor as PlaygroundExecutor | null;
    const isExecutorReady = executor && typeof executor.getPlaygroundStatistics === 'function';

    /**
     * Periodically refresh statistics
     */
    useEffect(() => {
        if (!isExecutorReady) {
            setRawStatistics(null);
            return;
        }

        // Update once immediately
        const updateStats = () => {
            try {
                const stats = executor.getPlaygroundStatistics();
                setRawStatistics(stats);
            } catch (error) {
                WebLogger.error('usePlaygroundStatistics: Failed to get statistics', { error: error instanceof Error ? error.message : String(error) });
                setRawStatistics(null);
            }
        };

        updateStats();

        // Refresh every second for real-time updates
        const interval = setInterval(updateStats, 1000);

        return () => clearInterval(interval);
    }, [
        isExecutorReady,
        executor,
        state.lastExecutionResult,
        state.mode,
        state.isExecuting
    ]);

    /**
     * UI action methods (memoized with useCallback)
     */
    const recordAction = useCallback(async (actionName: TPlaygroundActionName, metadata?: Record<string, TUniversalValue>) => {
        if (!isExecutorReady) return;

        try {
            await executor.recordPlaygroundAction(actionName, metadata);
        } catch (error) {
            WebLogger.warn('Failed to record playground action', { error: error instanceof Error ? error.message : String(error) });
        }
    }, [isExecutorReady, executor]);

    const recordBlockCreation = useCallback(async (blockType: string, metadata?: Record<string, TUniversalValue>) => {
        if (!isExecutorReady) return;

        try {
            await executor.recordBlockCreation(blockType, metadata);
        } catch (error) {
            WebLogger.warn('Failed to record block creation', { error: error instanceof Error ? error.message : String(error) });
        }
    }, [isExecutorReady, executor]);

    const resetStatistics = useCallback(() => {
        if (!isExecutorReady) return;

        try {
            // Reset is currently not exposed on the executor. Keep as a UI intent only.
            WebLogger.info('Statistics reset requested');
        } catch (error) {
            WebLogger.warn('Failed to reset statistics', { error: error instanceof Error ? error.message : String(error) });
        }
    }, [isExecutorReady, executor]);

    /**
     * Derived statistics (memoized with useMemo)
     */
    const processedStatistics = useMemo((): IPlaygroundStatisticsHookResult => {
        if (!rawStatistics) {
            return {
                ...defaultStatistics,
                isLoading: !isExecutorReady,
                recordAction,
                recordBlockCreation,
                resetStatistics
            };
        }

        // Format response time
        const formattedResponseTime = formatResponseTime(rawStatistics.averageResponseTime);

        // Consider "active" if updated within the last 5 seconds
        const isRecentlyActive = (Date.now() - rawStatistics.lastUpdated.getTime()) < 5000;

        return {
            // Core execution metrics
            chatExecutions: rawStatistics.totalChatExecutions,
            agentExecutions: rawStatistics.agentModeExecutions,
            teamExecutions: rawStatistics.teamModeExecutions,
            streamingExecutions: rawStatistics.streamingExecutions,

            // UI interaction metrics
            blockCreations: rawStatistics.blockCreations,
            uiInteractions: rawStatistics.uiInteractions,

            // Performance metrics
            averageResponseTime: rawStatistics.averageResponseTime,
            lastExecutionTime: rawStatistics.lastExecutionTime,
            formattedResponseTime,

            // Quality indicators
            errorCount: rawStatistics.errorCount,
            successRate: rawStatistics.successRate,

            // State
            isActive: rawStatistics.isActive || isRecentlyActive,
            isLoading: false,
            lastUpdated: rawStatistics.lastUpdated,

            // Actions
            recordAction,
            recordBlockCreation,
            resetStatistics
        };
    }, [rawStatistics, isExecutorReady, recordAction, recordBlockCreation, resetStatistics]);

    return processedStatistics;
}

/**
 * Format response time for display
 */
function formatResponseTime(milliseconds: number): string {
    if (milliseconds === 0) return '0ms';

    if (milliseconds < 1000) {
        return `${Math.round(milliseconds)}ms`;
    } else if (milliseconds < 60000) {
        return `${(milliseconds / 1000).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.round((milliseconds % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }
} 