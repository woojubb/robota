import type { ITerminalOutput } from '@robota-sdk/agent-core';
import { promptInput } from '@robota-sdk/agent-transport/headless';
import type { IConfigPhaseOptions } from './args-to-options.js';
import type { ICommandSetup } from './command-setup.js';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
} from './provider-startup.js';

export type TConfigPhaseResult = { handled: true } | { handled: false };

export async function handleConfigPhase(
  cwd: string,
  opts: IConfigPhaseOptions,
  commandSetup: ICommandSetup,
  terminal: ITerminalOutput,
  isInteractive: boolean,
): Promise<TConfigPhaseResult> {
  if (opts.configure) {
    await runInteractiveProviderSetup(
      cwd,
      opts,
      promptInput,
      terminal,
      commandSetup.providerDefinitions,
    );
    return { handled: true };
  }

  if (handleProviderConfigurationArgs(cwd, opts, terminal, commandSetup.providerDefinitions)) {
    return { handled: true };
  }

  await ensureConfig(
    cwd,
    opts,
    promptInput,
    terminal,
    commandSetup.providerDefinitions,
    isInteractive,
  );

  return { handled: false };
}
