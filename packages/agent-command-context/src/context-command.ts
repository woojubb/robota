import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import { readAutoCompactThreshold, readCommandContextState } from '@robota-sdk/agent-sdk';

const PERCENT = 100;

function formatAutoCompactLine(threshold: number | false): string {
  if (threshold === false) {
    return 'Auto compact: disabled';
  }
  return `Auto compact: ${Math.round(threshold * PERCENT)}%`;
}

export function executeContextCommand(context: ICommandHostContext, _args: string): ICommandResult {
  const state = readCommandContextState(context);
  const autoCompactThreshold = readAutoCompactThreshold(context);
  return {
    message: [
      `Context: ${state.usedTokens.toLocaleString()} / ${state.maxTokens.toLocaleString()} tokens (${Math.round(state.usedPercentage)}%)`,
      formatAutoCompactLine(autoCompactThreshold),
    ].join('\n'),
    success: true,
    data: {
      usedTokens: state.usedTokens,
      maxTokens: state.maxTokens,
      percentage: state.usedPercentage,
      autoCompactThreshold,
    },
  };
}
