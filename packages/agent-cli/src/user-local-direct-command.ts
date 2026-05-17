import { executeUserLocalDirectCommand } from '@robota-sdk/agent-command';
import type { ITerminalOutput } from '@robota-sdk/agent-core';
import type { IParsedCliArgs } from './utils/cli-args.js';

export async function runUserLocalDirectCommandIfRequested(
  args: IParsedCliArgs,
  cwd: string,
  terminal: ITerminalOutput,
): Promise<boolean> {
  if (args.positional[0] !== 'user-local') {
    return false;
  }

  const result = await executeUserLocalDirectCommand({
    cwd,
    argv: args.positional.slice(1),
    format: args.format,
    summary: args.summary,
    source: args.source,
  });
  const output = result.message.trimEnd();
  if (!result.success) {
    throw new Error(output);
  }
  terminal.writeLine(output);
  return true;
}
