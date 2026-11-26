import { resolveCliRuntimeContext } from './product-bootstrap.js';
import { createStartupProviderInteraction, promptInput } from '../cli-input.js';
import { createWorkspaceProjectMutation, ProviderConfigError } from '@robota-sdk/agent-framework';
import { supportsWorkspaceProjectMutation } from '@robota-sdk/agent-framework/node';

import { runInitCommand, type IInitCommandOptions } from '../init/init-command.js';
import { productProviderDefinitions } from '../product/provider-definitions.js';
import {
  ensureConfig,
  handleProviderConfigurationArgs,
  providerConfigurationFinishesStartup,
  runInteractiveProviderSetup,
  type IProviderStartupSettingsAccess,
} from './provider-startup.js';
import { createProviderSetupHost, exitOnUnreadableOrgPolicy } from './command-setup.js';
import { createCliWorkspaceSources } from './workspace-project-composition.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { IStartCliOptions } from './command-setup.js';
import type { ICliWorkspaceSources } from './workspace-project-composition.js';
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
  /** Only what setup reads: it holds no conversation, so it needs none of a session's stores. */
  workspace: ICliWorkspaceSources;
  providerConnectionHost?: IProviderConnectionHost;
  orgPolicy?: IOrgPolicy;
  /** The platform the host runs on; the process's own by default. A seam for the project-write limit. */
  platform?: NodeJS.Platform;
}

/**
 * The result of routing: `handled` means the caller returns immediately (init/`--configure` ran, or a
 * hard provider-configuration failure already reported itself and exited). `setupRequired`
 * means startup continues, but with no usable provider — set only for `--serve` (which a
 * daemon-launched child also is), never for the TUI or print mode, which keep exiting as before.
 */
export interface IProjectSetupRoutingResult {
  readonly handled: boolean;
  readonly setupRequired?: string;
}

/**
 * Whether the whole invocation is project or provider setup: `init`, `--configure`, or saving a
 * provider profile that no print run or prompt follows (those go on to run a session). Such an
 * invocation reads no conversation, so it needs no conversation store.
 */
export function isProjectSetupInvocation(args: IParsedCliArgs): boolean {
  if (subcommandWord(args) === 'init' || args.configure) return true;
  return Boolean(args.configureProvider) && providerConfigurationFinishesStartup(args);
}

function providerSettingsAccess(
  options: IProjectSetupRoutingOptions,
): IProviderStartupSettingsAccess {
  const runtime = resolveCliRuntimeContext(options.startOptions);
  return {
    cliName: runtime.config.identity.cliName,
    env: runtime.environment,
    settingsSources: options.workspace.settingsSources,
    settingsStores: options.workspace.settingsStores,
    connectionHost: options.providerConnectionHost,
    interaction: createStartupProviderInteraction(),
    orgPolicy: options.orgPolicy,
  };
}

/**
 * Run `init`, `--configure` or the provider flags. `true` when one of them was the invocation, and
 * so nothing follows; `false` when startup goes on (a saved profile with a print run or a prompt).
 */
export async function routeProjectSetupCommand(
  options: IProjectSetupRoutingOptions,
): Promise<boolean> {
  const { cwd, args, terminal, providerDefinitions } = options;
  const settingsAccess = providerSettingsAccess(options);
  if (subcommandWord(args) === 'init') {
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
  return handleProviderConfigurationArgs(cwd, args, terminal, providerDefinitions, settingsAccess);
}

/** Handle init/configuration routes and establish usable provider settings for normal startup. */
export async function routeProjectSetup(
  options: IProjectSetupRoutingOptions,
): Promise<IProjectSetupRoutingResult> {
  const { cwd, args, terminal, providerDefinitions } = options;
  if (await routeProjectSetupCommand(options)) return { handled: true };
  try {
    await ensureConfig(
      cwd,
      args,
      promptInput,
      terminal,
      providerDefinitions,
      (subcommandWord(args) === 'mcp' && args.positional[1] === 'serve') ||
        subcommandWord(args) === 'acp'
        ? false
        : undefined,
      providerSettingsAccess(options),
    );
  } catch (error) {
    // A served runtime (including a daemon's child, which is also `--serve`) starts in
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

/**
 * Setting up a project or a provider on its own: the workspace's settings and contributions, the
 * organization's policy and the credential host, and nothing that holds a conversation. For a
 * process that may not build a conversation store — in secure conversations a command has no key
 * holder — and which therefore cannot take the startup that composes the stores before it gets here.
 * Everything the setup itself needs is composed from the same pieces that startup composes.
 */
export async function runProjectSetupWithoutStores(input: {
  readonly cwd: string;
  readonly args: IParsedCliArgs;
  readonly startOptions: IStartCliOptions;
  readonly terminal: ITerminalOutput;
}): Promise<void> {
  const { cwd, args, startOptions, terminal } = input;
  const runtime = resolveCliRuntimeContext(startOptions);
  const workspace = createCliWorkspaceSources({
    cwd,
    productRuntime: runtime,
    ...(startOptions.projectAccess !== undefined
      ? { projectAccess: startOptions.projectAccess }
      : {}),
    ...(startOptions.projectSettingsWriter !== undefined
      ? { projectSettingsWriter: startOptions.projectSettingsWriter }
      : {}),
    ...(startOptions.safeMode === true ? { safeMode: true } : {}),
  });
  let host: ReturnType<typeof createProviderSetupHost>;
  try {
    host = createProviderSetupHost(startOptions, runtime);
  } catch (error) {
    exitOnUnreadableOrgPolicy(error);
  }
  try {
    await routeProjectSetupCommand({
      cwd,
      args,
      startOptions,
      terminal,
      providerDefinitions: startOptions.providerDefinitions ?? productProviderDefinitions(),
      workspace,
      providerConnectionHost: host.providerConnectionHost,
      orgPolicy: host.orgPolicy ?? undefined,
    });
  } finally {
    host.providerConnectionHost.shutdown();
  }
}

/**
 * What a person on a platform that cannot write the project is told instead of the broker's generic
 * refusal, which hides that the limit is the platform's and that retrying cannot cure it.
 */
function projectInitUnavailableMessage(runtime: ICliRuntimeContext): string {
  const { cliName } = runtime.vocabulary;
  return (
    'Project initialization is not available on this platform, because it cannot prove that a ' +
    `project write stays inside the trusted folder; run \`${cliName} init\` on Linux, or create ` +
    `AGENTS.md and ${runtime.layout.projectDirectory}/settings.json yourself and set up a provider ` +
    `with \`${cliName} --configure\`.`
  );
}

/**
 * `init` is a command the person typed in a trusted folder, which is the approval its writes need.
 * A host that supplies its own bounded capability keeps it; the stock entry supplies none, so
 * without minting one here `init` would refuse in every trusted folder. The minted capability writes
 * through the host's anchored project writer, which not every platform has; the framework says in
 * advance which do, so `init` says so before it starts instead of having its first write refused.
 */
function projectInitMutation(
  startOptions: IStartCliOptions,
  workspace: ICliWorkspaceSources,
  platform: NodeJS.Platform | undefined,
): Pick<IInitCommandOptions, 'projectMutation'> {
  if (startOptions.projectMutation !== undefined) {
    return { projectMutation: startOptions.projectMutation };
  }
  if (workspace.projectAccess.status !== 'trusted') return {};
  if (!supportsWorkspaceProjectMutation(platform)) {
    throw new Error(projectInitUnavailableMessage(resolveCliRuntimeContext(startOptions)));
  }
  return {
    projectMutation: createWorkspaceProjectMutation(workspace.projectAccess.authority, {
      status: 'approved',
      purpose: 'initialize the project',
    }),
  };
}

async function runProjectInit(
  options: IProjectSetupRoutingOptions,
  settingsAccess: IProviderStartupSettingsAccess,
): Promise<void> {
  const { cwd, args, startOptions, terminal, providerDefinitions, workspace, platform } = options;
  try {
    await runInitCommand(terminal, {
      productRuntime: resolveCliRuntimeContext(startOptions),
      projectAccess: workspace.projectAccess,
      ...projectInitMutation(startOptions, workspace, platform),
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
