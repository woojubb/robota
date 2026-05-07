import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import { compactCommandContext } from '@robota-sdk/agent-sdk';

function parseInstructions(args: string): string | undefined {
  const instructions = args.trim();
  return instructions.length > 0 ? instructions : undefined;
}

export async function executeCompactCommand(
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  const result = await compactCommandContext(context, parseInstructions(args));
  const before = result.before.usedPercentage;
  const after = result.after.usedPercentage;
  return {
    message: `Context compacted: ${Math.round(before)}% -> ${Math.round(after)}%`,
    success: true,
    data: { before, after },
  };
}
