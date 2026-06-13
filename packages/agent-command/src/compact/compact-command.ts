import { compactCommandContext } from '@robota-sdk/agent-framework';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

function parseInstructions(args: string): string | undefined {
  const instructions = args.trim();
  return instructions.length > 0 ? instructions : undefined;
}

export async function executeCompactCommand(
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  const result = await compactCommandContext(context, parseInstructions(args));
  const { before, after, beforeMessageCount, afterMessageCount } = result;
  const removedMessages = beforeMessageCount - afterMessageCount;
  const removedPercent =
    beforeMessageCount > 0 ? Math.round((removedMessages / beforeMessageCount) * 100) : 0;
  const message = [
    'Context compacted.',
    `  Removed messages: ${removedMessages} (${removedPercent}% of total)`,
    `  Context: ${Math.round(before.usedPercentage)}% → ${Math.round(after.usedPercentage)}%`,
  ].join('\n');
  return {
    message,
    success: true,
    data: { before, after, beforeMessageCount, afterMessageCount },
  };
}
