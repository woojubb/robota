import type { IPlaygroundActionsValue, IPlaygroundState } from '../../contexts/playground-context';
import { getDefaultAgentConfig, validateConfiguration } from './configuration-helpers';
import type {
  IExecutionLocalState,
  IRobotaExecutionActions,
  IRobotaExecutionHookReturn,
} from './types';

interface IBuildRobotaExecutionReturnOptions {
  state: IPlaygroundState;
  localState: IExecutionLocalState;
  actions: IRobotaExecutionActions;
  contextActions: IPlaygroundActionsValue;
}

export function buildRobotaExecutionReturn({
  state,
  localState,
  actions,
  contextActions,
}: IBuildRobotaExecutionReturnOptions): IRobotaExecutionHookReturn {
  return {
    executionState: localState.executionState,
    isExecuting: localState.isExecuting,
    isStreaming: localState.isStreaming,
    canExecute: localState.canExecute,
    currentAgentConfig: state.currentAgentConfig,
    currentMode: state.mode,
    lastResult: state.lastExecutionResult,
    executionHistory: localState.executionHistory,
    lastError: localState.lastError,
    errorCount: localState.errorCount,
    averageExecutionTime: localState.averageExecutionTime,
    totalExecutions: localState.totalExecutions,
    successRate: localState.successRate,
    createAgent: actions.createAgent,
    popRestoredMessages: contextActions.popRestoredMessages,
    executePrompt: actions.executePrompt,
    executeStreamPrompt: actions.executeStreamPrompt,
    retryLastExecution: actions.retryLastExecution,
    cancelExecution: actions.cancelExecution,
    clearExecutionHistory: localState.clearExecutionHistory,
    streamingResponse: localState.streamingResponse,
    clearStreamingResponse: actions.clearStreamingResponse,
    getDefaultAgentConfig,
    validateConfiguration,
  };
}
