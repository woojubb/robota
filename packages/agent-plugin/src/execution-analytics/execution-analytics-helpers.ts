/**
 * Execution Analytics Plugin - Validation and utility helpers.
 *
 * Extracted from execution-analytics-plugin.ts to keep each file under 300 lines.
 * @internal
 */

import type { IExecutionAnalyticsOptions, IExecutionStats } from './types';

/**
 * Validate and sanitize ExecutionAnalyticsPlugin options in-place.
 * Invalid numeric values are reset to safe defaults. @internal
 */
export function validateExecutionAnalyticsOptions(
  options: IExecutionAnalyticsOptions,
  pluginOptions: { maxEntries: number; performanceThreshold: number },
): void {
  if (options.maxEntries !== undefined && options.maxEntries < 1) {
    pluginOptions.maxEntries = 1000;
  }
  if (options.performanceThreshold !== undefined && options.performanceThreshold < 0) {
    pluginOptions.performanceThreshold = 5000;
  }
}

/** Generate a unique execution ID with an optional prefix. @internal */
export function generateExecutionId(prefix: string, counter: number): string {
  return `${prefix}-${Date.now()}-${counter}`;
}

/**
 * Build an IExecutionStats record for an error event. @internal
 */
export function buildErrorExecutionStats(
  executionId: string,
  executionData: { startTime: number; operation: string },
  error: Error,
  trackErrors: boolean,
  context?: { action?: string; tool?: string; attempt?: number },
): IExecutionStats {
  const duration = Date.now() - executionData.startTime;
  const errorInfo = trackErrors
    ? {
        message: error.message,
        ...(error.stack && { stack: error.stack }),
        type: error.constructor.name,
      }
    : undefined;
  return {
    executionId,
    operation: executionData.operation,
    startTime: new Date(executionData.startTime),
    endTime: new Date(),
    duration,
    success: false,
    ...(errorInfo && { error: errorInfo }),
    metadata: {
      errorSource: 'onError-hook',
      contextType: context ? typeof context : 'none',
      hasContext: !!context,
    },
  };
}

/** Find the first active execution matching the given operation (and optionally the input). @internal */
export function findActiveExecution(
  activeExecutions: Map<string, { startTime: number; operation: string; input?: string }>,
  operation: string,
  input?: string,
):
  | {
      executionId: string;
      executionData: { startTime: number; operation: string; input?: string };
    }
  | undefined {
  for (const [executionId, executionData] of activeExecutions.entries()) {
    if (executionData.operation === operation) {
      if (operation === 'run' && input && executionData.input !== input) continue;
      return { executionId, executionData };
    }
  }
  return undefined;
}
