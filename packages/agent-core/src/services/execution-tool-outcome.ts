import type { IToolResultsOutcome } from './execution-round-tool-results';
import {
  MAX_CONSECUTIVE_UNKNOWN_TOOL_FAILURE_ROUNDS,
  type IExecutionRoundState,
} from './execution-types';
import type { ILogger } from '../utils/logger';

/** Apply the same loop stop state to newly executed and restored tool batches. */
export function applyToolOutcome(
  outcome: IToolResultsOutcome,
  roundState: IExecutionRoundState,
  logger: ILogger,
): boolean {
  if (outcome.contextOverflowed) {
    logger.warn(
      '[ROUND] Tool results partially skipped due to context overflow — continuing to let AI respond',
      { added: outcome.addedCount, skipped: outcome.skippedCount, round: roundState.currentRound },
    );
  }

  if (outcome.unknownToolFailureCount > 0) {
    roundState.consecutiveUnknownToolFailureRounds += 1;
  } else {
    roundState.consecutiveUnknownToolFailureRounds = 0;
  }

  if (
    roundState.consecutiveUnknownToolFailureRounds >= MAX_CONSECUTIVE_UNKNOWN_TOOL_FAILURE_ROUNDS
  ) {
    const unavailableTools = [...new Set(outcome.unknownToolNames)].sort();
    roundState.forcedSummaryInstruction = [
      `The model repeatedly requested unavailable tool(s): ${unavailableTools.join(', ')}.`,
      'Those tool calls were not executed because they are not registered tools.',
      'Respond to the user now with that reason and use the available tool results already in the conversation history.',
    ].join(' ');
    logger.warn('[ROUND] Stopping repeated unavailable tool-call loop', {
      unavailableTools,
      consecutiveRounds: roundState.consecutiveUnknownToolFailureRounds,
      round: roundState.currentRound,
    });
    return true;
  }

  return false;
}
