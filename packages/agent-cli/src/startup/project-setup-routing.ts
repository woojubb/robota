import { resolveCliRuntimeContext } from './product-bootstrap.js';
import { createStartupProviderInteraction, promptInput } from '../cli-input.js';
import { ProviderConfigError } from '@robota-sdk/agent-framework';

import { runInitCommand } from '../init/init-command.js';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
  type IProviderStartupSettingsAccess,
} from './provider-startup.js';

import type { IStartCliOptions } from './command-setup.js';
import type { ICliWorkspaceComposition } from './workspace-project-composition.js';
import { subcommandWord, type IParsedCliArgs } from '../utils/cli-args.js';
import type { IProviderDefinition, ITerminalOutput } from '@robota-sdk/agent-core';
import type { IOrgPolicy, IProviderConnectionHost } from '@robota-sdk/agent-framework';

const PRINT_MODE_PROVIDER_CONFIG_EXIT_CODE = 3;

export interface IProjectSetupRoutingOptions {
  cwd: string;
  args: IParsedCliArgs;
  startOptions: IStartCliOptions;
  terminal: ITerminalOutput;
  providerDefinitions: readonly IProviderDefinition[];
  workspace: ICliWorkspaceComposition;
  providerConnectionHost?: IProviderConnectionHost;
  orgPolicy?: IOrgPolicy;
}

/**
 * The result of routing: `handled` means the caller returns immediately (init/`--configure` ran, or a
 * hard provider-configuration failure already reported itself and exited). `setupRequired` (issue
 * #3282 §3) means startup continues, but with no usable provider — set only for `--serve` (which a
 * daemon-launched child also is), never for the TUI or print mode, which keep exiting as before.
 */
export interface IProjectSetupRoutingResult {
  readonly handled: boolean;
  readonly setupRequired?: string;
}

/** Handle init/configuration routes and establish usable provider settings for normal startup. */
export async function routeProjectSetup(
  options: IProjectSetupRoutingOptions,
): Promise<IProjectSetupRoutingResult> {
  const { cwd, args, terminal, providerDefinitions, workspace } = options;
  const runtime = resolveCliRuntimeContext(options.startOptions);
  const settingsAccess = {
    cliName: runtime.config.identity.cliName,
    env: runtime.environment,
    settingsSources: workspace.settingsSources,
    settingsStores: workspace.settingsStores,
    connectionHost: options.providerConnectionHost,
    interaction: createStartupProviderInteraction(),
    orgPolicy: options.orgPolicy,
  };
  if (subcommandWord(args) === 'init') {
    await runProjectInit(options, settingsAccess);
    return { handled: true };
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
    return { handled: true };
  }
  if (
    await handleProviderConfigurationArgs(cwd, args, terminal, providerDefinitions, settingsAccess)
  ) {
    return { handled: true };
  }
  try {
    await ensureConfig(
      cwd,
      args,
      promptInput,
      terminal,
      providerDefinitions,
      subcommandWord(args) === 'mcp' && args.positional[1] === 'serve' ? false : undefined,
      settingsAccess,
    );
  } catch (error) {
    // #3282 §3: a served runtime (including a daemon's child, which is also `--serve`) starts in
    // setup mode instead of exiting — the GUI walks a first-run person through configuring a
    // provider. The TUI and print mode are unchanged: a person with no GUI still needs the terminal
    // message to know what happened.
    if (error instanceof ProviderConfigError && args.serve) {
      return { handled: false, setupRequired: error.message };
    }
    // allow-fallback: provider configuration failure is terminal and reported to the host
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(
      error instanceof ProviderConfigError && args.printMode
        ? PRINT_MODE_PROVIDER_CONFIG_EXIT_CODE
        : 1,
    );
  }
  return { handled: false };
}

async function runProjectInit(
  options: IProjectSetupRoutingOptions,
  settingsAccess: IProviderStartupSettingsAccess,
): Promise<void> {
  const { cwd, args, startOptions, terminal, providerDefinitions, workspace } = options;
  try {
    await runInitCommand(terminal, {
      productRuntime: resolveCliRuntimeContext(startOptions),
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
