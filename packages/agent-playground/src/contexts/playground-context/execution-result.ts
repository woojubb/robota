import type { IPlaygroundExecutorResult } from '../../lib/playground/robota-executor';

export function buildErrorResult(error: Error): IPlaygroundExecutorResult {
  return {
    success: false,
    response: 'Execution failed',
    duration: 0,
    error,
    uiError: {
      kind: 'recoverable',
      message: error.message,
    },
  };
}
