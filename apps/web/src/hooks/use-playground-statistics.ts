/**
 * usePlaygroundStatistics Hook
 * 
 * Playground 전용 통계 데이터를 React 컴포넌트에서 사용하기 위한 Hook
 * - PlaygroundExecutor에서 통계 데이터 가져오기
 * - 실시간 업데이트 지원
 * - 메모이제이션으로 성능 최적화
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

import { useMemo, useCallback } from 'react';
import { usePlayground } from '../contexts/playground-context';
import type { PlaygroundMetrics } from '../types/playground-statistics';
import type { PlaygroundExecutor } from '../lib/playground/robota-executor';

/**
 * Hook 반환 타입 - UI에서 사용하기 편한 형태로 가공된 통계 데이터
 */
export interface PlaygroundStatisticsHookResult {
    // 기본 실행 통계
    chatExecutions: number;
    agentExecutions: number;
    teamExecutions: number;
    streamingExecutions: number;

    // UI 인터랙션 통계  
    blockCreations: number;
    uiInteractions: number;

    // 성능 메트릭
    averageResponseTime: number;
    lastExecutionTime: number | null;
    formattedResponseTime: string;

    // 품질 지표
    errorCount: number;
    successRate: number;

    // 상태 정보
    isActive: boolean;
    isLoading: boolean;
    lastUpdated: Date;

    // 액션 메서드
    recordAction: (actionType: string, metadata?: Record<string, any>) => Promise<void>;
    recordBlockCreation: (blockType: string, metadata?: Record<string, any>) => Promise<void>;
    resetStatistics: () => void;
}

/**
 * 기본 통계 데이터 (로딩 중이거나 에러 시 사용)
 */
const defaultStatistics: PlaygroundStatisticsHookResult = {
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
 * PlaygroundExecutor에서 실시간 통계 데이터를 가져와서
 * React 컴포넌트에서 사용하기 편한 형태로 가공하여 반환
 */
export function usePlaygroundStatistics(): PlaygroundStatisticsHookResult {
    const { state, dispatch } = usePlayground();

    // PlaygroundExecutor 타입 안전성 검사
    const executor = state.executor as PlaygroundExecutor | null;
    const isExecutorReady = executor && typeof executor.getPlaygroundStatistics === 'function';

    /**
     * 원시 통계 데이터 가져오기 및 메모이제이션
     */
    const rawStatistics = useMemo((): PlaygroundMetrics | null => {
        if (!isExecutorReady) {
            return null;
        }

        try {
            return executor.getPlaygroundStatistics();
        } catch (error) {
            console.warn('Failed to get playground statistics:', error);
            return null;
        }
    }, [
        isExecutorReady,
        executor,
        state.lastExecutionResult,  // 실행 결과 변경 시 업데이트
        state.mode,                 // 모드 변경 시 업데이트
        state.isExecuting          // 실행 상태 변경 시 업데이트
    ]);

    /**
     * UI용 액션 메서드들 - useCallback으로 메모이제이션
     */
    const recordAction = useCallback(async (actionType: string, metadata?: Record<string, any>) => {
        if (!isExecutorReady) return;

        try {
            await executor.recordPlaygroundAction(actionType, metadata);
        } catch (error) {
            console.warn('Failed to record playground action:', error);
        }
    }, [isExecutorReady, executor]);

    const recordBlockCreation = useCallback(async (blockType: string, metadata?: Record<string, any>) => {
        if (!isExecutorReady) return;

        try {
            await executor.recordBlockCreation(blockType, metadata);
        } catch (error) {
            console.warn('Failed to record block creation:', error);
        }
    }, [isExecutorReady, executor]);

    const resetStatistics = useCallback(() => {
        if (!isExecutorReady) return;

        try {
            // PlaygroundStatisticsPlugin의 resetStatistics 메서드 호출
            // 현재는 직접 액세스가 제한되므로 향후 executor에 메서드 추가 필요
            console.log('Statistics reset requested');
        } catch (error) {
            console.warn('Failed to reset statistics:', error);
        }
    }, [isExecutorReady, executor]);

    /**
     * 가공된 통계 데이터 생성 - 복잡한 계산은 useMemo로 최적화
     */
    const processedStatistics = useMemo((): PlaygroundStatisticsHookResult => {
        if (!rawStatistics) {
            return {
                ...defaultStatistics,
                isLoading: !isExecutorReady,
                recordAction,
                recordBlockCreation,
                resetStatistics
            };
        }

        // 응답 시간 포맷팅
        const formattedResponseTime = formatResponseTime(rawStatistics.averageResponseTime);

        // 실행 상태 판단 (최근 업데이트가 5초 이내인 경우 활성으로 간주)
        const isRecentlyActive = (Date.now() - rawStatistics.lastUpdated.getTime()) < 5000;

        return {
            // 기본 실행 통계
            chatExecutions: rawStatistics.totalChatExecutions,
            agentExecutions: rawStatistics.agentModeExecutions,
            teamExecutions: rawStatistics.teamModeExecutions,
            streamingExecutions: rawStatistics.streamingExecutions,

            // UI 인터랙션 통계
            blockCreations: rawStatistics.blockCreations,
            uiInteractions: rawStatistics.uiInteractions,

            // 성능 메트릭
            averageResponseTime: rawStatistics.averageResponseTime,
            lastExecutionTime: rawStatistics.lastExecutionTime,
            formattedResponseTime,

            // 품질 지표
            errorCount: rawStatistics.errorCount,
            successRate: rawStatistics.successRate,

            // 상태 정보
            isActive: rawStatistics.isActive || isRecentlyActive,
            isLoading: false,
            lastUpdated: rawStatistics.lastUpdated,

            // 액션 메서드
            recordAction,
            recordBlockCreation,
            resetStatistics
        };
    }, [rawStatistics, isExecutorReady, recordAction, recordBlockCreation, resetStatistics]);

    return processedStatistics;
}

/**
 * 응답 시간을 사용자 친화적인 형태로 포맷팅
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

/**
 * 통계 데이터의 변화 감지를 위한 유틸리티 Hook
 * 특정 메트릭의 변화를 추적하고 싶을 때 사용
 */
export function useStatisticChanges(
    statistic: keyof Pick<PlaygroundStatisticsHookResult, 'chatExecutions' | 'errorCount' | 'averageResponseTime'>
) {
    const stats = usePlaygroundStatistics();

    const previousValue = useMemo(() => {
        // 이전 값 추적 로직 (필요시 구현)
        return stats[statistic];
    }, [stats[statistic]]);

    return {
        current: stats[statistic],
        previous: previousValue,
        hasChanged: stats[statistic] !== previousValue
    };
}

/**
 * 성능 임계값 체크를 위한 유틸리티 Hook
 */
export function usePerformanceAlerts() {
    const { averageResponseTime, errorCount, successRate } = usePlaygroundStatistics();

    return useMemo(() => {
        const alerts = [];

        // 느린 응답 시간 경고 (3초 이상)
        if (averageResponseTime > 3000) {
            alerts.push({
                type: 'warning' as const,
                message: 'Average response time is above 3 seconds',
                metric: 'responseTime',
                value: averageResponseTime
            });
        }

        // 높은 에러율 경고 (10% 이상)
        if (successRate < 90) {
            alerts.push({
                type: 'error' as const,
                message: 'Error rate is above 10%',
                metric: 'errorRate',
                value: 100 - successRate
            });
        }

        // 에러 발생 알림
        if (errorCount > 0) {
            alerts.push({
                type: 'info' as const,
                message: `${errorCount} error(s) detected`,
                metric: 'errorCount',
                value: errorCount
            });
        }

        return alerts;
    }, [averageResponseTime, errorCount, successRate]);
} 