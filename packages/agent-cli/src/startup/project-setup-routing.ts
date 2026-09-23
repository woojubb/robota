import { promptInput } from '../cli-input.js';
import { ProviderConfigError } from '@robota-sdk/agent-framework';

import { runInitCommand } from '../init/init-command.js';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
} from './provider-startup.js';

import type { IStartCliOptions } from './command-setup.js';
import type { ICliWorkspaceComposition } from './workspace-project-composition.js';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { IProviderDefinition, ITerminalOutput } from '@robota-sdk/agent-core';

const PRINT_MODE_PROVIDER_CONFIG_EXIT_CODE = 3;

export interface IProjectSetupRoutingOptions {
  cwd: string;
  args: IParsedCliArgs;
  startOptions: IStartCliOptions;
  terminal: ITerminalOutput;
  providerDefinitions: readonly IProviderDefinition[];
  workspace: ICliWorkspaceComposition;
}

/** Handle init/configuration routes and establish usable provider settings for normal startup. */
export async function routeProjectSetup(options: IProjectSetupRoutingOptions): Promise<boolean> {
  const { cwd, args, terminal, providerDefinitions, workspace } = options;
  const settingsAccess = {
    settingsSources: workspace.settingsSources,
    settingsStores: workspace.settingsStores,
  };
  if (args.positional[0] === 'init') {
    await runProjectInit(options, settingsAccess);
    return true;
  }
  if (args.configure) {
    await runInteractiveProviderSetup(
      cwd,
      args,
      promptInput,
      terminal,
      providerDefinitions,
      settingsAccess,
    );
    return true;
  }
  if (handleProviderConfigurationArgs(cwd, args, terminal, providerDefinitions, settingsAccess)) {
    return true;
  }
  try {
    await ensureConfig(
      cwd,
      args,
      promptInput,
      terminal,
      providerDefinitions,
      undefined,
      settingsAccess,
    );
  } catch (error) {
    // allow-fallback: provider configuration failure is terminal and reported to the host
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(
      error instanceof ProviderConfigError && args.printMode
        ? PRINT_MODE_PROVIDER_CONFIG_EXIT_CODE
        : 1,
    );
  }
  return false;
}

async function runProjectInit(
  options: IProjectSetupRoutingOptions,
  settingsAccess: Pick<ICliWorkspaceComposition, 'settingsSources' | 'settingsStores'>,
): Promise<void> {
  const { cwd, args, startOptions, terminal, providerDefinitions, workspace } = options;
  try {
    await runInitCommand(terminal, {
      projectAccess: workspace.projectAccess,
      ...(startOptions.projectMutation === undefined
        ? {}
        : { projectMutation: startOptions.projectMutation }),
      yes: args.yes,
      onProviderSetup: () =>
        runInteractiveProviderSetup(
          cwd,
          args,
          promptInput,
          terminal,
          providerDefinitions,
          settingsAccess,
        ),
    });
  } catch (error) {
    // allow-fallback: init prompt failure is terminal — exit is the correct response
    terminal.writeError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
