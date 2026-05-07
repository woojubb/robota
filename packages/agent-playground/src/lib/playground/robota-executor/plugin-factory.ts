import type { ILogger } from '@robota-sdk/agent-core';

import {
  ERROR_RATE_THRESHOLD,
  HISTORY_MAX_EVENTS,
  SLOW_EXECUTION_THRESHOLD_MS,
  STATISTICS_MAX_ENTRIES,
} from './constants';
import { PlaygroundHistoryPlugin } from '../plugins/playground-history-plugin';
import { PlaygroundStatisticsPlugin } from '../plugins/playground-statistics-plugin';

export function createHistoryPlugin(logger: ILogger): PlaygroundHistoryPlugin {
  return new PlaygroundHistoryPlugin({
    maxEvents: HISTORY_MAX_EVENTS,
    enableVisualization: true,
    logger,
  });
}

export function createStatisticsPlugin(): PlaygroundStatisticsPlugin {
  return new PlaygroundStatisticsPlugin({
    enabled: true,
    collectUIMetrics: true,
    collectBlockMetrics: true,
    trackResponseTime: true,
    trackExecutionDetails: true,
    maxEntries: STATISTICS_MAX_ENTRIES,
    slowExecutionThreshold: SLOW_EXECUTION_THRESHOLD_MS,
    errorRateThreshold: ERROR_RATE_THRESHOLD,
  });
}
