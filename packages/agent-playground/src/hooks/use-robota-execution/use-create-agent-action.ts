import { useCallback } from 'react';
import type { IPlaygroundAgentConfig } from '../../lib/playground/robota-executor';
import { WebLogger } from '../../lib/web-logger';
import type { IExecutionLocalState, IRobotaExecutionContextActions } from './types';

export function useCreateAgentAction(
  contextActions: IRobotaExecutionContextActions,
  localState: IExecutionLocalState,
): (config: IPlaygroundAgentConfig) => Promise<void> {
  return useCallback(
    async (config: IPlaygroundAgentConfig) => {
      try {
        localState.setExecutionState('initializing');
        localState.clearLastError();
        await contextActions.createAgent(config);
        localState.setExecutionState('idle');
      } catch (error) {
        const executionError = error instanceof Error ? error : new Error(String(error));
        WebLogger.error('createAgent error', { error: executionError.message });
        localState.setExecutionState('error');
        localState.recordError(executionError);
        throw error;
      }
    },
    [contextActions, localState],
  );
}
