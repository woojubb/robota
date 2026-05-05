import { useEffect } from 'react';
import { clearExecutionTimeout } from './execution-timeout';
import type { IExecutionRefs } from './types';

export function useExecutionCleanup(refs: IExecutionRefs): void {
  useEffect(() => {
    return () => {
      clearExecutionTimeout(refs.executionTimeoutRef);
      if (refs.abortControllerRef.current) {
        refs.abortControllerRef.current.abort();
      }
    };
  }, [refs]);
}
