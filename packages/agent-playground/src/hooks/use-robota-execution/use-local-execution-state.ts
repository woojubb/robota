import { useState } from 'react';
import type { IPlaygroundState } from '../../contexts/playground-context';
import { useExecutionCleanup } from './use-execution-cleanup';
import { useExecutionDebugLog, useExecutionStateSync } from './use-execution-state-sync';
import { useExecutionHistory } from './use-execution-history';
import { useExecutionRefs } from './use-execution-refs';
import type { IExecutionLocalState, TExecutionState } from './types';

export function useLocalExecutionState(state: IPlaygroundState): IExecutionLocalState {
  const [executionState, setExecutionState] = useState<TExecutionState>('idle');
  const [streamingResponse, setStreamingResponse] = useState('');
  const refs = useExecutionRefs();
  const history = useExecutionHistory(state.lastExecutionResult);
  const isExecuting =
    state.isExecuting || executionState === 'running' || executionState === 'streaming';
  const isStreaming = executionState === 'streaming';
  const canExecute = state.isInitialized && !isExecuting && Boolean(state.currentAgentConfig);

  useExecutionDebugLog({
    isInitialized: state.isInitialized,
    isExecuting,
    hasAgentConfig: Boolean(state.currentAgentConfig),
    canExecute,
    executionState,
  });
  useExecutionStateSync({
    isContextExecuting: state.isExecuting,
    executionState,
    setExecutionState,
  });
  useExecutionCleanup(refs);

  return {
    ...history,
    executionState,
    setExecutionState,
    isExecuting,
    isStreaming,
    canExecute,
    streamingResponse,
    setStreamingResponse,
    refs,
  };
}
