import { useCallback, useEffect, useState } from 'react';
import type { IPlaygroundExecutorResult } from '../../lib/playground/robota-executor';
import { calculateAverageExecutionTime, calculateSuccessRate } from './execution-metrics';
import type { IExecutionHistoryState } from './types';

export function useExecutionHistory(
  lastExecutionResult: IPlaygroundExecutorResult | null,
): IExecutionHistoryState {
  const [executionHistory, setExecutionHistory] = useState<IPlaygroundExecutorResult[]>([]);
  const [lastError, setLastError] = useState<Error | null>(null);
  const [errorCount, setErrorCount] = useState(0);

  useEffect(() => {
    if (lastExecutionResult && !executionHistory.find((result) => result === lastExecutionResult)) {
      setExecutionHistory((previous) => [...previous, lastExecutionResult]);

      if (lastExecutionResult.error) {
        setLastError(lastExecutionResult.error);
        setErrorCount((previous) => previous + 1);
      } else {
        setLastError(null);
      }
    }
  }, [lastExecutionResult, executionHistory]);

  const recordError = useCallback((error: Error) => {
    setLastError(error);
    setErrorCount((previous) => previous + 1);
  }, []);

  const clearLastError = useCallback(() => {
    setLastError(null);
  }, []);

  const clearExecutionHistory = useCallback(() => {
    setExecutionHistory([]);
    setErrorCount(0);
    setLastError(null);
  }, []);

  return {
    executionHistory,
    lastError,
    errorCount,
    averageExecutionTime: calculateAverageExecutionTime(executionHistory),
    totalExecutions: executionHistory.length,
    successRate: calculateSuccessRate(executionHistory),
    recordError,
    clearLastError,
    clearExecutionHistory,
  };
}
