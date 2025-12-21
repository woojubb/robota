/**
 * Playground Statistics Type Definitions
 * 
 * Type definitions for the Playground statistics system.
 * - Not intended for cross-project reuse
 * - Focused on UI/UX-oriented metrics
 */

import type { UniversalValue } from '@robota-sdk/agents';

// =============================================================================
// Core Statistics Interfaces
// =============================================================================

/**
 * Playground-specific execution result
 */
export interface PlaygroundExecutionResult {
    success: boolean;
    duration: number;
    provider: string;
    model: string;
    mode: 'agent' | 'team';
    streaming: boolean;
    timestamp: Date;
    error?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * Playground UI interaction action
 */
export interface PlaygroundAction {
    type: 'chat_send' | 'agent_create' | 'team_create' | 'agent_start' | 'team_start' |
    'agent_stop' | 'team_stop' | 'block_expand' | 'block_collapse' | 'config_change';
    timestamp: Date;
    metadata?: Record<string, UniversalValue>;
}

/**
 * Playground metric set
 */
export interface PlaygroundMetrics {
    // Chat execution statistics
    totalChatExecutions: number;
    agentModeExecutions: number;
    teamModeExecutions: number;
    streamingExecutions: number;

    // UI interaction statistics
    blockCreations: number;
    uiInteractions: number;
    configChanges: number;

    // Performance metrics
    averageResponseTime: number;
    lastExecutionTime: number | null;

    // Error metrics
    errorCount: number;
    successRate: number;

    // Real-time state
    isActive: boolean;
    lastUpdated: Date;
}

// =============================================================================
// Plugin Configuration Types
// =============================================================================

/**
 * PlaygroundStatisticsPlugin configuration options
 */
export interface PlaygroundStatisticsOptions {
    enabled?: boolean;

    // UI 메트릭 수집 옵션
    collectUIMetrics?: boolean;
    collectBlockMetrics?: boolean;
    collectConfigMetrics?: boolean;

    // 성능 모니터링 옵션
    trackResponseTime?: boolean;
    trackExecutionDetails?: boolean;

    // 저장 및 집계 옵션
    maxEntries?: number;
    aggregateStats?: boolean;
    resetOnSessionStart?: boolean;

    // 알림 임계치
    slowExecutionThreshold?: number; // ms
    errorRateThreshold?: number; // percentage
}

/**
 * PlaygroundStatisticsPlugin stats data
 */
export interface PlaygroundStatisticsStats {
    // 기본 메트릭
    metrics: PlaygroundMetrics;

    // 상세 실행 이력
    executionHistory: PlaygroundExecutionResult[];

    // UI 인터랙션 이력
    actionHistory: PlaygroundAction[];

    // 집계된 통계
    aggregatedStats: {
        sessionsCount: number;
        totalExecutionTime: number;
        averageSessionDuration: number;
        topErrors: Array<{ error: string; count: number }>;
        providerUsage: Record<string, number>;
        modelUsage: Record<string, number>;
    };

    // 시간대별 통계
    timeBasedStats: {
        hourlyExecutions: number[];
        dailyExecutions: number[];
        peakUsageHour: number;
    };
}

// =============================================================================
// Default Values and Constants
// =============================================================================

/**
 * 기본 Playground 메트릭
 */
export const defaultPlaygroundStats: PlaygroundMetrics = {
    totalChatExecutions: 0,
    agentModeExecutions: 0,
    teamModeExecutions: 0,
    streamingExecutions: 0,
    blockCreations: 0,
    uiInteractions: 0,
    configChanges: 0,
    averageResponseTime: 0,
    lastExecutionTime: null,
    errorCount: 0,
    successRate: 100,
    isActive: false,
    lastUpdated: new Date()
};

/**
 * 기본 플러그인 설정
 */
export const defaultPlaygroundStatisticsOptions: Required<PlaygroundStatisticsOptions> = {
    enabled: true,
    collectUIMetrics: true,
    collectBlockMetrics: true,
    collectConfigMetrics: true,
    trackResponseTime: true,
    trackExecutionDetails: true,
    maxEntries: 1000,
    aggregateStats: true,
    resetOnSessionStart: false,
    slowExecutionThreshold: 3000, // 3초
    errorRateThreshold: 10 // 10%
};

// =============================================================================
// Event Types for Statistics Collection
// =============================================================================

/**
 * Playground 통계 수집을 위한 이벤트 타입
 */
export type PlaygroundStatisticsEventType =
    | 'execution.start'
    | 'execution.complete'
    | 'execution.error'
    | 'ui.interaction'
    | 'block.create'
    | 'block.expand'
    | 'block.collapse'
    | 'config.change'
    | 'session.start'
    | 'session.end';

/**
 * 통계 이벤트 데이터
 */
export interface PlaygroundStatisticsEventData {
    type: PlaygroundStatisticsEventType;
    timestamp: Date;
    executionId?: string;
    sessionId?: string;
    data: Record<string, any>;
} 