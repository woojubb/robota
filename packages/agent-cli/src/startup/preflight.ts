import type { ITerminalOutput } from '@robota-sdk/agent-core';
import { checkForCliUpdate, formatCliUpdateCheckMessage } from '@robota-sdk/agent-framework';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import { printHelp } from '../utils/cli-args.js';
import { runResetConfig } from './reset-config.js';

export type TPreflightResult = { handled: true } | { handled: false };

export interface IPreflightContext {
  version: string;
  terminal: ITerminalOutput;
}

export async function handlePreflightCommands(
  args: IParsedCliArgs,
  ctx: IPreflightContext,
): Promise<TPreflightResult> {
  if (args.help) {
    process.stdout.write(printHelp());
    return { handled: true };
  }
  if (args.version) {
    process.stdout.write(`robota ${ctx.version}\n`);
    return { handled: true };
  }
  if (args.checkUpdate) {
    const result = await checkForCliUpdate({ currentVersion: ctx.version, force: true });
    const message = formatCliUpdateCheckMessage(result);
    if (result.status === 'error') {
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }
    process.stdout.write(`${message}\n`);
    return { handled: true };
  }
  if (args.reset) {
    runResetConfig(ctx.terminal);
    return { handled: true };
  }
  return { handled: false };
}
