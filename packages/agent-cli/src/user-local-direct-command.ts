import type { ICliRuntimeContext } from './product/runtime-context.js';
import { executeUserLocalDirectCommand } from '@robota-sdk/agent-product/command';
import type { ITerminalOutput } from '@robota-sdk/agent-core';
import { NodeFileSystemAsync } from '@robota-sdk/agent-framework/node';
import { subcommandWord, type IParsedCliArgs } from './utils/cli-args.js';
import { userLocalStorageRoot } from './product/user-paths.js';

export async function runUserLocalDirectCommandIfRequested(
  args: IParsedCliArgs,
  cwd: string,
  terminal: ITerminalOutput,
  runtime: ICliRuntimeContext,
): Promise<boolean> {
  if (subcommandWord(args) !== 'user-local') {
    return false;
  }

  const result = await executeUserLocalDirectCommand({
    cwd,
    storageRoot: userLocalStorageRoot(runtime),
    fsAsync: new NodeFileSystemAsync(),
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
