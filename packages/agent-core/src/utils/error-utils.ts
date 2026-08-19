/**
 * Helpers over the error taxonomy — CORE-035.
 *
 * Split out of `errors.ts`, which owns the CLASSES. Two responsibilities lived in one file: what the
 * errors ARE, and what a caller does with an arbitrary one. Keeping them together pushed the
 * taxonomy file past the size ceiling the moment a class was added to it, which is the wrong thing
 * for a ceiling to be blocking.
 */

import { ConfigurationError, ProviderError, RobotaError } from './errors';

import type { TErrorExternalInput } from './errors';

/**
 * Error utility functions
 */
export class ErrorUtils {
  /**
   * Check if error is recoverable
   */
  static isRecoverable(error: Error): boolean {
    if (error instanceof RobotaError) {
      return error.recoverable;
    }
    return false;
  }

  /**
   * Extract error code from any error
   */
  static getErrorCode(error: Error): string {
    if (error instanceof RobotaError) {
      return error.code;
    }
    return 'UNKNOWN_ERROR';
  }

  /**
   * Create error from unknown value
   */
  static fromUnknown(
    error: TErrorExternalInput,
    defaultMessage = 'An unknown error occurred',
  ): RobotaError {
    if (error instanceof RobotaError) {
      return error;
    }

    if (error instanceof Error) {
      return new ConfigurationError(error.message || defaultMessage);
    }

    const message = typeof error === 'string' ? error : defaultMessage;
    return new ConfigurationError(message);
  }

  /**
   * Wrap external errors
   */
  static wrapProviderError(
    error: TErrorExternalInput,
    provider: string,
    operation: string,
  ): ProviderError {
    const originalError = error instanceof Error ? error : new Error(String(error));
    return new ProviderError(`Failed to ${operation}`, provider, originalError, { operation });
  }
}
