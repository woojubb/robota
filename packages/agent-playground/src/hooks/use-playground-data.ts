'use client';

const PERCENTAGE_MULTIPLIER = 100;

/**
 * usePlaygroundData - Plugin Data Access Hook
 *
 * Specialized hook for accessing Playground plugin data, visualization information,
 * and real-time updates from PlaygroundHistoryPlugin.
 *
 * This hook provides easy access to:
 * - Conversation events and history
 * - Agent/Team visualization data
 * - Plugin statistics and performance metrics
 * - Real-time data synchronization
 */

import { useMemo, useCallback } from 'react';
import { usePlaygroundState, usePlaygroundActions } from '../contexts/playground-context';
import type { IConversationEvent, IVisualizationData } from '../lib/playground/robota-executor';

export interface IPlaygroundDataHookReturn {
  // Visualization Data
  visualizationData: IVisualizationData | null;
  conversationEvents: IConversationEvent[];

  // Computed Data
  totalEvents: number;
  totalToolCalls: number;
  averageResponseTime: number;
  currentMode: 'agent';

  // Agent/Team Structure
  agentBlocks: IVisualizationData['agents'] | [];

  // Real-time Status
  isRealTimeEnabled: boolean;
  lastEventTimestamp: Date | null;

  // Data Filtering and Search
  filterEventsByType: (type: IConversationEvent['type']) => IConversationEvent[];
  getEventsInTimeRange: (startTime: Date, endTime: Date) => IConversationEvent[];
  searchEventsByContent: (searchTerm: string) => IConversationEvent[];

  // Statistics
  getExecutionStatistics: () => {
    totalExecutions: number;
    successRate: number;
    averageDuration: number;
    toolUsageCount: Record<string, number>;
  };

  // Data Export
  exportConversationData: () => {
    timestamp: string;
    mode: 'agent';
    events: IConversationEvent[];
    statistics: ReturnType<IPlaygroundDataHookReturn['getExecutionStatistics']>;
  };
}

export function usePlaygroundData(): IPlaygroundDataHookReturn {
  const state = usePlaygroundState();
  const { getVisualizationData } = usePlaygroundActions();

  // Get current visualization data
  const visualizationData = useMemo(() => {
    return getVisualizationData();
  }, [getVisualizationData]);

  // Extract conversation events
  const conversationEvents = useMemo(() => {
    return visualizationData?.events || [];
  }, [visualizationData]);

  // Computed statistics
  const totalEvents = useMemo(() => {
    return conversationEvents.length;
  }, [conversationEvents]);

  const totalToolCalls = useMemo(() => {
    return conversationEvents.filter(
      (event) =>
        event.type === 'tool_call_start' ||
        event.type === 'tool_call_complete' ||
        event.type === 'tool_call_error',
    ).length;
  }, [conversationEvents]);

  const averageResponseTime = useMemo(() => {
    return state.executionStats.averageExecutionTime;
  }, [state.executionStats.averageExecutionTime]);

  const currentMode = useMemo<'agent'>(() => 'agent', []);

  const agentBlocks = useMemo(() => {
    return visualizationData?.agents || [];
  }, [visualizationData]);

  const lastEventTimestamp = useMemo(() => {
    if (conversationEvents.length === 0) return null;
    const lastEvent = conversationEvents[conversationEvents.length - 1];
    return lastEvent.timestamp;
  }, [conversationEvents]);

  // Data filtering functions
  const filterEventsByType = useCallback(
    (type: IConversationEvent['type']) => {
      return conversationEvents.filter((event) => event.type === type);
    },
    [conversationEvents],
  );

  const getEventsInTimeRange = useCallback(
    (startTime: Date, endTime: Date) => {
      return conversationEvents.filter(
        (event) => event.timestamp >= startTime && event.timestamp <= endTime,
      );
    },
    [conversationEvents],
  );

  const searchEventsByContent = useCallback(
    (searchTerm: string) => {
      const lowercaseSearch = searchTerm.toLowerCase();
      return conversationEvents.filter(
        (event) =>
          event.content?.toLowerCase().includes(lowercaseSearch) ||
          event.toolName?.toLowerCase().includes(lowercaseSearch) ||
          event.agentId?.toLowerCase().includes(lowercaseSearch),
      );
    },
    [conversationEvents],
  );

  // Statistics calculation
  const getExecutionStatistics = useCallback(() => {
    const userMessages = filterEventsByType('user_message');
    const assistantMessages = filterEventsByType('assistant_response');
    const errors = conversationEvents.filter(
      (event) => event.type === 'execution_error' || event.type === 'tool_call_error',
    );
    const toolCalls = conversationEvents.filter(
      (event) =>
        event.type === 'tool_call_start' ||
        event.type === 'tool_call_complete' ||
        event.type === 'tool_call_error',
    );

    const totalExecutions = userMessages.length;
    const successfulExecutions = assistantMessages.length;
    const successRate =
      totalExecutions > 0 ? (successfulExecutions / totalExecutions) * PERCENTAGE_MULTIPLIER : 0;

    // Calculate average duration between user message and assistant response
    let totalDuration = 0;
    let durationCount = 0;

    for (let i = 0; i < conversationEvents.length - 1; i++) {
      const current = conversationEvents[i];
      const next = conversationEvents[i + 1];

      if (current.type === 'user_message' && next.type === 'assistant_response') {
        totalDuration += next.timestamp.getTime() - current.timestamp.getTime();
        durationCount++;
      }
    }

    const averageDuration = durationCount > 0 ? totalDuration / durationCount : 0;

    // Tool usage count
    const toolUsageCount: Record<string, number> = {};
    toolCalls.forEach((event) => {
      if (event.toolName) {
        toolUsageCount[event.toolName] = (toolUsageCount[event.toolName] || 0) + 1;
      }
    });

    return {
      totalExecutions,
      successRate,
      averageDuration,
      toolUsageCount,
    };
  }, [conversationEvents, filterEventsByType]);

  // Data export function
  const exportConversationData = useCallback(() => {
    return {
      timestamp: new Date().toISOString(),
      mode: currentMode,
      events: conversationEvents,
      statistics: getExecutionStatistics(),
    };
  }, [currentMode, conversationEvents, getExecutionStatistics]);

  return {
    // Visualization Data
    visualizationData,
    conversationEvents,

    // Computed Data
    totalEvents,
    totalToolCalls,
    averageResponseTime,
    currentMode,

    // Agent/Team Structure
    agentBlocks,

    // Real-time Status
    isRealTimeEnabled: state.isWebSocketConnected,
    lastEventTimestamp,

    // Data Filtering and Search
    filterEventsByType,
    getEventsInTimeRange,
    searchEventsByContent,

    // Statistics
    getExecutionStatistics,

    // Data Export
    exportConversationData,
  };
}
