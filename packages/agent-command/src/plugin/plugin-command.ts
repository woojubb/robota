import {
  createShowPluginManagerIntent,
  resolvePluginCommandAdapter,
} from '@robota-sdk/agent-framework';

import type { ICommandHostAdapterAccess, ICommandHostWorkspace } from '@robota-sdk/agent-framework';
import type { ICommandPluginAdapter, ICommandResult } from '@robota-sdk/agent-interface-command';

/** What `/plugin` reaches: its adapter port, and — for install/uninstall — this connection's locality. */
export type TPluginCommandContext = ICommandHostAdapterAccess &
  Partial<Pick<ICommandHostWorkspace, 'getCommandSurfaceLocality'>>;

function getSubcommandParts(args: string): { subcommand: string; subArgs: string } {
  const parts = args
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  return {
    subcommand: parts[0] ?? '',
    subArgs: parts.slice(1).join(' ').trim(),
  };
}

function usage(message: string): ICommandResult {
  return {
    success: false,
    message,
  };
}

function getPluginAdapter(context: ICommandHostAdapterAccess): ICommandPluginAdapter | undefined {
  return resolvePluginCommandAdapter(context);
}

const REMOTE_INSTALL_REFUSAL =
  'Installing and uninstalling plugins runs code on this computer, so it only works from the ' +
  'desktop app or the page opened here — not from a remote device.';

/**
 * #3282 §4 part b-2: the same rule the GUI's Settings screen applies before it ever sends the
 * write — installing/uninstalling stays local-surface-only because it runs third-party code.
 * `getCommandSurfaceLocality` absent (an older host, a test double, the in-process TUI) reads as
 * `'local'`, matching the allow-by-default posture the rest of the command layer already uses.
 */
function isRemoteSurface(context: TPluginCommandContext): boolean {
  return (context.getCommandSurfaceLocality?.() ?? 'local') === 'remote';
}

async function executePluginOperation(
  context: ICommandHostAdapterAccess,
  operation: (adapter: ICommandPluginAdapter) => Promise<string>,
): Promise<ICommandResult> {
  const adapter = getPluginAdapter(context);
  if (adapter === undefined) {
    return {
      success: false,
      message: 'Plugin management is not available.',
    };
  }

  try {
    return {
      success: true,
      message: await operation(adapter),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Plugin error: ${message}`,
    };
  }
}

async function executeMarketplaceCommand(
  context: ICommandHostAdapterAccess,
  subArgs: string,
): Promise<ICommandResult> {
  const { subcommand, subArgs: marketplaceArgs } = getSubcommandParts(subArgs);

  if (subcommand === 'add' && marketplaceArgs.length > 0) {
    return executePluginOperation(context, async (adapter) => {
      const registeredName = await adapter.marketplaceAdd(marketplaceArgs);
      return `Added marketplace: "${registeredName}" (from ${marketplaceArgs})\nInstall plugins with: /plugin install <name>@${registeredName}`;
    });
  }

  if (subcommand === 'remove' && marketplaceArgs.length > 0) {
    return executePluginOperation(context, async (adapter) => {
      await adapter.marketplaceRemove(marketplaceArgs);
      return `Removed marketplace "${marketplaceArgs}" and uninstalled its plugins.`;
    });
  }

  if (subcommand === 'update' && marketplaceArgs.length > 0) {
    return executePluginOperation(context, async (adapter) => {
      await adapter.marketplaceUpdate(marketplaceArgs);
      return `Updated marketplace "${marketplaceArgs}".`;
    });
  }

  if (subcommand === 'list') {
    return executePluginOperation(context, async (adapter) => {
      const sources = await adapter.marketplaceList();
      if (sources.length === 0) {
        return 'No marketplace sources configured.';
      }
      const lines = sources.map((source) => `  ${source.name} (${source.type})`);
      return `Marketplace sources:\n${lines.join('\n')}`;
    });
  }

  return usage('Usage: /plugin marketplace add <source> | remove <name> | update <name> | list');
}

type TPluginIdOperation = (
  adapter: ICommandPluginAdapter,
  pluginId: string,
) => Promise<string> | string;

function executePluginIdOperation(
  context: ICommandHostAdapterAccess,
  pluginId: string,
  usageMessage: string,
  operation: TPluginIdOperation,
): Promise<ICommandResult> {
  if (pluginId.length === 0) {
    return Promise.resolve(usage(usageMessage));
  }
  return executePluginOperation(context, (adapter) =>
    Promise.resolve(operation(adapter, pluginId)),
  );
}

function executePluginManager(): ICommandResult {
  return {
    success: true,
    message: 'Opening plugin manager...',
    uiIntents: [createShowPluginManagerIntent()],
  };
}

function executeInstallCommand(
  context: TPluginCommandContext,
  pluginId: string,
): Promise<ICommandResult> {
  if (isRemoteSurface(context)) return Promise.resolve(usage(REMOTE_INSTALL_REFUSAL));
  return executePluginIdOperation(
    context,
    pluginId,
    'Usage: /plugin install <name>@<marketplace>',
    async (adapter, targetPluginId) => {
      await adapter.install(targetPluginId);
      return `Installed plugin: ${targetPluginId}`;
    },
  );
}

function executeUninstallCommand(
  context: TPluginCommandContext,
  pluginId: string,
): Promise<ICommandResult> {
  if (isRemoteSurface(context)) return Promise.resolve(usage(REMOTE_INSTALL_REFUSAL));
  return executePluginIdOperation(
    context,
    pluginId,
    'Usage: /plugin uninstall <name>@<marketplace>',
    async (adapter, targetPluginId) => {
      await adapter.uninstall(targetPluginId);
      return `Uninstalled plugin: ${targetPluginId}`;
    },
  );
}

/** #3282 §4 part b-2: the Settings screen's Plugins section reads through this, like `/mcp status`. */
async function executeListInstalledCommand(
  context: ICommandHostAdapterAccess,
): Promise<ICommandResult> {
  const adapter = getPluginAdapter(context);
  if (adapter === undefined) {
    return { success: true, message: 'Plugin management is not available.', data: { plugins: [] } };
  }
  try {
    const plugins = await adapter.listInstalled();
    const message =
      plugins.length === 0
        ? 'No plugins are installed.'
        : `Installed plugins:\n${plugins.map((plugin) => `  ${plugin.name}${plugin.enabled ? '' : ' (disabled)'} — ${plugin.description}`).join('\n')}`;
    return { success: true, message, data: { plugins } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Plugin error: ${message}` };
  }
}

function executeEnableCommand(
  context: ICommandHostAdapterAccess,
  pluginId: string,
): Promise<ICommandResult> {
  return executePluginIdOperation(
    context,
    pluginId,
    'Usage: /plugin enable <name>@<marketplace>',
    async (adapter, targetPluginId) => {
      await adapter.enable(targetPluginId);
      return `Enabled plugin: ${targetPluginId}`;
    },
  );
}

function executeDisableCommand(
  context: ICommandHostAdapterAccess,
  pluginId: string,
): Promise<ICommandResult> {
  return executePluginIdOperation(
    context,
    pluginId,
    'Usage: /plugin disable <name>@<marketplace>',
    async (adapter, targetPluginId) => {
      await adapter.disable(targetPluginId);
      return `Disabled plugin: ${targetPluginId}`;
    },
  );
}

export async function executePluginCommand(
  context: TPluginCommandContext,
  args: string,
): Promise<ICommandResult> {
  const { subcommand, subArgs } = getSubcommandParts(args);
  switch (subcommand) {
    case '':
    case 'manage':
      return executePluginManager();
    case 'list':
      return executeListInstalledCommand(context);
    case 'install':
      return executeInstallCommand(context, subArgs);
    case 'uninstall':
      return executeUninstallCommand(context, subArgs);
    case 'enable':
      return executeEnableCommand(context, subArgs);
    case 'disable':
      return executeDisableCommand(context, subArgs);
    case 'marketplace':
      return executeMarketplaceCommand(context, subArgs);
    default:
      return usage(`Unknown plugin subcommand: ${subcommand}`);
  }
}

export async function executeReloadPluginsCommand(
  context: ICommandHostAdapterAccess,
  _args: string,
): Promise<ICommandResult> {
  return executePluginOperation(context, async (adapter) => {
    const result = await adapter.reloadPlugins();
    const suffix =
      result.loadedPluginCount === 1
        ? '1 plugin resource'
        : `${result.loadedPluginCount} plugin resources`;
    return `Reloaded ${suffix}.`;
  }).then((result) => {
    if (!result.success) return result;
    // CMD-004 Stage E: the semantic reload already ran HOST-side above (`adapter.reloadPlugins()`);
    // the requester-local registry/autocomplete refresh rides the result as a data hint.
    return {
      ...result,
      data: { ...result.data, pluginRegistryReloaded: true },
    };
  });
}
