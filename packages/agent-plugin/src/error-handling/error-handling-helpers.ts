/**
 * Error Handling Plugin - Validation and strategy handler helpers.
 *
 * Extracted from error-handling-plugin.ts to keep each file under 300 lines.
 * @internal
 */

import { ConfigurationError } from '@robota-sdk/agent-core';
import type { IErrorHandlingPluginOptions } from './types';

/** Validate ErrorHandlingPlugin constructor options. @internal */
export function validateErrorHandlingOptions(options: IErrorHandlingPluginOptions): void {
  if (!options.strategy) {
    throw new ConfigurationError('Error handling strategy is required');
  }

  if (!['simple', 'circuit-breaker', 'exponential-backoff', 'silent'].includes(options.strategy)) {
    throw new ConfigurationError('Invalid error handling strategy', {
      validStrategies: ['simple', 'circuit-breaker', 'exponential-backoff', 'silent'],
      provided: options.strategy,
    });
  }

  if (options.maxRetries !== undefined && options.maxRetries < 0) {
    throw new ConfigurationError('Max retries must be non-negative');
  }

  if (options.retryDelay !== undefined && options.retryDelay <= 0) {
    throw new ConfigurationError('Retry delay must be positive');
  }
}

/** Resolve retry delay based on strategy and attempt number. @internal */
export function resolveRetryDelay(strategy: string, baseDelay: number, attempt: number): number {
  return strategy === 'exponential-backoff' ? baseDelay * Math.pow(2, attempt - 1) : baseDelay;
}

/** Resolve true if the circuit breaker timeout has not yet elapsed. @internal */
export function isCircuitBreakerStillOpen(
  circuitBreakerOpen: boolean,
  lastFailureTime: number,
  circuitBreakerTimeout: number,
): { open: boolean; shouldReset: boolean } {
  if (!circuitBreakerOpen) return { open: false, shouldReset: false };
  const timeoutPassed = Date.now() - lastFailureTime > circuitBreakerTimeout;
  if (timeoutPassed) return { open: false, shouldReset: true };
  return { open: true, shouldReset: false };
}

/** Sleep for a given number of milliseconds. @internal */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
