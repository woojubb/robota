import { executeUserLocalDirectCommand } from '@robota-sdk/agent-command';
import type { ITerminalOutput } from '@robota-sdk/agent-core';
import type { IUserLocalCommandOptions } from './startup/args-to-options.js';

export async function runUserLocalDirectCommandIfRequested(
  opts: IUserLocalCommandOptions,
  cwd: string,
  terminal: ITerminalOutput,
): Promise<boolean> {
  if (opts.positional[0] !== 'user-local') {
    return false;
  }

  const result = await executeUserLocalDirectCommand({
    cwd,
    argv: opts.positional.slice(1),
    format: opts.format,
    summary: opts.summary,
    source: opts.source,
  });
  const output = result.message.trimEnd();
  if (!result.success) {
    throw new Error(output);
  }
  terminal.writeLine(output);
  return true;
}
