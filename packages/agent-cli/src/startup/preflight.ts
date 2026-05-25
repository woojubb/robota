import type { ITerminalOutput } from '@robota-sdk/agent-core';
import { checkForCliUpdate, formatCliUpdateCheckMessage } from '@robota-sdk/agent-framework';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import { printHelp } from '../utils/cli-args.js';
import { runInitCommand } from '../init/init-command.js';
import { runResetConfig } from './reset-config.js';
import { runDiagnoseCommand } from './diagnose-command.js';
export type TPreflightResult = { handled: true } | { handled: false };

export interface IPreflightContext {
  version: string;
  terminal: ITerminalOutput;
  cwd: string;
  /** Optional callback to run provider setup after `robota init` completes. */
  onProviderSetup?: () => Promise<void>;
}

export async function handlePreflightCommands(
  args: IParsedCliArgs,
  ctx: IPreflightContext,
): Promise<TPreflightResult> {
  if (args.positional[0] === 'init') {
    await runInitCommand(ctx.cwd, ctx.terminal, {
      yes: args.yes,
      onProviderSetup: ctx.onProviderSetup,
    });
    return { handled: true };
  }
  if (args.positional[0] === 'diagnose') {
    await runDiagnoseCommand(ctx);
    return { handled: true };
  }
  if (args.help) {
    ctx.terminal.write(printHelp());
    return { handled: true };
  }
  if (args.version) {
    ctx.terminal.writeLine(`robota ${ctx.version}`);
    return { handled: true };
  }
  if (args.checkUpdate) {
    const result = await checkForCliUpdate({ currentVersion: ctx.version, force: true });
    const message = formatCliUpdateCheckMessage(result);
    if (result.status === 'error') {
      throw new Error(message);
    }
    ctx.terminal.writeLine(message);
    return { handled: true };
  }
  if (args.reset) {
    runResetConfig(ctx.terminal);
    return { handled: true };
  }
  return { handled: false };
}
