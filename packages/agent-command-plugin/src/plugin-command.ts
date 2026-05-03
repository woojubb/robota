import type {
  ICommandHostContext,
  ICommandPluginAdapter,
  ICommandResult,
} from '@robota-sdk/agent-sdk';
import { createPluginTuiRequestedEffect, resolvePluginCommandAdapter } from '@robota-sdk/agent-sdk';

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

function getPluginAdapter(context: ICommandHostContext): ICommandPluginAdapter | undefined {
  return resolvePluginCommandAdapter(context);
}

async function executePluginOperation(
  context: ICommandHostContext,
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
  context: ICommandHostContext,
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
  context: ICommandHostContext,
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
    effects: [createPluginTuiRequestedEffect()],
  };
}

function executeInstallCommand(
  context: ICommandHostContext,
  pluginId: string,
): Promise<ICommandResult> {
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
  context: ICommandHostContext,
  pluginId: string,
): Promise<ICommandResult> {
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

function executeEnableCommand(
  context: ICommandHostContext,
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
  context: ICommandHostContext,
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
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  const { subcommand, subArgs } = getSubcommandParts(args);
  switch (subcommand) {
    case '':
    case 'manage':
      return executePluginManager();
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
