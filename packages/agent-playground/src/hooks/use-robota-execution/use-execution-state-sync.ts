import { useEffect } from 'react';
import { WebLogger } from '../../lib/web-logger';
import { IDLE_RESET_DELAY_MS } from './constants';
import type { TExecutionState } from './types';

interface IUseExecutionDebugLogOptions {
  isInitialized: boolean;
  isExecuting: boolean;
  hasAgentConfig: boolean;
  canExecute: boolean;
  executionState: TExecutionState;
}

export function useExecutionDebugLog({
  isInitialized,
  isExecuting,
  hasAgentConfig,
  canExecute,
  executionState,
}: IUseExecutionDebugLogOptions): void {
  useEffect(() => {
    WebLogger.debug('canExecute state check', {
      isInitialized,
      isExecuting,
      hasAgentConfig,
      canExecute,
      executionState,
    });
  }, [isInitialized, isExecuting, hasAgentConfig, canExecute, executionState]);
}

interface IUseExecutionStateSyncOptions {
  isContextExecuting: boolean;
  executionState: TExecutionState;
  setExecutionState: (state: TExecutionState) => void;
}

export function useExecutionStateSync({
  isContextExecuting,
  executionState,
  setExecutionState,
}: IUseExecutionStateSyncOptions): void {
  useEffect(() => {
    if (isContextExecuting && executionState === 'idle') {
      setExecutionState('running');
    } else if (
      !isContextExecuting &&
      (executionState === 'running' || executionState === 'streaming')
    ) {
      setExecutionState('completed');
      setTimeout(() => setExecutionState('idle'), IDLE_RESET_DELAY_MS);
    }
  }, [isContextExecuting, executionState, setExecutionState]);
}
