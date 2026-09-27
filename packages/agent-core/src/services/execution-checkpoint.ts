import type { IExecutionRoundCheckpoint } from '../interfaces/execution-journal';
import type { IAgentConfig } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IExecutionContext, IExecutionRoundState } from './execution-types';
import { getModelContextWindow } from '../context/models';

/** Capture canonical history and data-only execution position before a journaled invocation. */
export function captureExecutionCheckpoint(
  messages: TUniversalMessage[],
  state: IExecutionRoundState,
  context: IExecutionContext,
  config: IAgentConfig,
  maxRounds: number,
  loadedDeferredTools?: string[],
  kind: 'round' | 'summary' = 'round',
): IExecutionRoundCheckpoint {
  return structuredClone({
    version: 1,
    effectAdmission: 'required',
    messages,
    round: state.currentRound,
    contextLimit: getModelContextWindow(config.defaultModel.model),
    cumulativeInputTokens: state.cumulativeInputTokens,
    sameToolInputCounts: [...state.sameToolInputCounts],
    maxSameToolInputs: context.maxSameToolInputs ?? config.maxSameToolInputs,
    continuation: {
      version: 1,
      kind,
      startedAt: context.startTime.toISOString(),
      turnMessageId:
        messages.find(
          (message) =>
            message.role === 'user' && message.metadata?.executionId === context.executionId,
        )?.id ?? '',
      model: config.defaultModel,
      timeout: config.timeout,
      toolSearch: config.toolSearch,
      structuredOutput:
        config.responseFormat !== undefined && config.responseFormat.type !== 'text',
      options: {
        maxExecutionRounds: maxRounds,
        maxSameToolInputs: context.maxSameToolInputs ?? config.maxSameToolInputs,
        allowToolOnlyCompletion: context.allowToolOnlyCompletion ?? false,
        maxTokens: context.maxTokens,
        temperature: context.temperature,
        toolChoice: context.toolChoice ?? config.defaultModel.toolChoice,
        withholdHostedTools: context.withholdHostedTools ?? false,
        ephemeralSystemContext: context.ephemeralSystemContext,
        sessionId: context.sessionId,
        userId: context.userId,
        metadata: context.metadata,
      },
      toolsExecuted: state.toolsExecuted,
      consecutiveUnknownToolFailureRounds: state.consecutiveUnknownToolFailureRounds,
      forcedSummaryInstruction: state.forcedSummaryInstruction,
      loadedDeferredTools,
    },
  });
}
