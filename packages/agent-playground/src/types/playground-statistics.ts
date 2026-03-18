/**
 * Playground Statistics Type Definitions
 *
 * Type definitions for the Playground statistics system.
 * - Not intended for cross-project reuse
 * - Focused on UI/UX-oriented metrics
 */

import type { TUniversalValue, TExecutionEventName } from '@robota-sdk/agent-core';

// =============================================================================
// Core Statistics Interfaces
// =============================================================================

/**
 * Playground-specific execution result
 */
export interface IPlaygroundExecutionResult {
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
export interface IPlaygroundAction {
  type:
    | 'chat_send'
    | 'agent_create'
    | 'team_create'
    | 'agent_start'
    | 'team_start'
    | 'agent_stop'
    | 'team_stop'
    | 'block_expand'
    | 'block_collapse'
    | 'config_change';
  timestamp: Date;
  metadata?: Record<string, TUniversalValue>;
}

/**
 * Playground metric set
 */
export interface IPlaygroundMetrics {
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
export interface IPlaygroundStatisticsOptions {
  enabled?: boolean;

  // UI metrics collection options
  collectUIMetrics?: boolean;
  collectBlockMetrics?: boolean;
  collectConfigMetrics?: boolean;

  // Performance monitoring options
  trackResponseTime?: boolean;
  trackExecutionDetails?: boolean;

  // Storage and aggregation options
  maxEntries?: number;
  aggregateStats?: boolean;
  resetOnSessionStart?: boolean;

  // Alert thresholds
  slowExecutionThreshold?: number; // ms
  errorRateThreshold?: number; // percentage
}

/**
 * PlaygroundStatisticsPlugin stats data
 */
export interface IPlaygroundStatisticsStats {
  // Core metrics
  metrics: IPlaygroundMetrics;

  // Execution history
  executionHistory: IPlaygroundExecutionResult[];

  // UI interaction history
  actionHistory: IPlaygroundAction[];

  // Aggregated stats
  aggregatedStats: {
    sessionsCount: number;
    totalExecutionTime: number;
    averageSessionDuration: number;
    topErrors: Array<{ error: string; count: number }>;
    providerUsage: Record<string, number>;
    modelUsage: Record<string, number>;
  };

  // Time-based stats
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
 * Default Playground metrics
 */
export const defaultPlaygroundStats: IPlaygroundMetrics = {
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
  lastUpdated: new Date(),
};

/**
 * Default plugin options
 */
export const defaultPlaygroundStatisticsOptions: Required<IPlaygroundStatisticsOptions> = {
  enabled: true,
  collectUIMetrics: true,
  collectBlockMetrics: true,
  collectConfigMetrics: true,
  trackResponseTime: true,
  trackExecutionDetails: true,
  maxEntries: 1000,
  aggregateStats: true,
  resetOnSessionStart: false,
  slowExecutionThreshold: 3000, // 3 seconds
  errorRateThreshold: 10, // 10%
};

// =============================================================================
// Event Types for Statistics Collection
// =============================================================================

/**
 * Event types for statistics collection
 */
export const PLAYGROUND_STATISTICS_EVENTS = {
  UI_INTERACTION: 'ui_interaction',
  BLOCK_CREATE: 'block_create',
  BLOCK_EXPAND: 'block_expand',
  BLOCK_COLLAPSE: 'block_collapse',
  CONFIG_CHANGE: 'config_change',
  SESSION_START: 'session_start',
  SESSION_END: 'session_end',
} as const;

export const PLAYGROUND_STATISTICS_EVENT_PREFIX = 'playground' as const;

// SSOT: TExecutionEventName is owned by @robota-sdk/agent-core (event-emitter/types.ts)
export type { TExecutionEventName } from '@robota-sdk/agent-core';

export type TPlaygroundStatisticsEventFullName =
  `${typeof PLAYGROUND_STATISTICS_EVENT_PREFIX}.${(typeof PLAYGROUND_STATISTICS_EVENTS)[keyof typeof PLAYGROUND_STATISTICS_EVENTS]}`;

export type TPlaygroundStatisticsEventName =
  | TExecutionEventName
  | TPlaygroundStatisticsEventFullName;

/**
 * Statistics event data
 */
export interface IPlaygroundStatisticsEventData {
  type: TPlaygroundStatisticsEventName;
  timestamp: Date;
  executionId?: string;
  sessionId?: string;
  data: Record<string, TUniversalValue>;
}
