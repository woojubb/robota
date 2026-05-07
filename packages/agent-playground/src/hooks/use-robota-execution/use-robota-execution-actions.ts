import type { IExecutionLocalState, IRobotaExecutionActions } from './types';
import type { IRobotaExecutionContextActions } from './types';
import { useCreateAgentAction } from './use-create-agent-action';
import { useExecutePromptAction } from './use-execute-prompt-action';
import { useExecuteStreamPromptAction } from './use-execute-stream-prompt-action';
import { useExecutionControlActions } from './use-execution-control-actions';

export function useRobotaExecutionActions(
  contextActions: IRobotaExecutionContextActions,
  localState: IExecutionLocalState,
): IRobotaExecutionActions {
  const createAgent = useCreateAgentAction(contextActions, localState);
  const executePrompt = useExecutePromptAction(contextActions, localState);
  const executeStreamPrompt = useExecuteStreamPromptAction(contextActions, localState);
  const controls = useExecutionControlActions(localState, executePrompt);

  return {
    createAgent,
    executePrompt,
    executeStreamPrompt,
    retryLastExecution: controls.retryLastExecution,
    cancelExecution: controls.cancelExecution,
    clearStreamingResponse: controls.clearStreamingResponse,
  };
}
