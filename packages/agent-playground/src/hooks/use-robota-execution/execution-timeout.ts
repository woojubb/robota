import type { MutableRefObject } from 'react';
import type { TExecutionState } from './types';
import { EXECUTION_TIMEOUT_MS } from './constants';

export function scheduleExecutionTimeout(
  executionTimeoutRef: MutableRefObject<NodeJS.Timeout | null>,
  setExecutionState: (state: TExecutionState) => void,
  setLastError: (error: Error) => void,
): void {
  executionTimeoutRef.current = setTimeout(() => {
    setExecutionState('error');
    setLastError(new Error('Execution timeout'));
  }, EXECUTION_TIMEOUT_MS);
}

export function clearExecutionTimeout(
  executionTimeoutRef: MutableRefObject<NodeJS.Timeout | null>,
): void {
  if (executionTimeoutRef.current) {
    clearTimeout(executionTimeoutRef.current);
    executionTimeoutRef.current = null;
  }
}
