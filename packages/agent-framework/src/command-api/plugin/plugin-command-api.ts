import type { TCommandUiIntent } from '../effects.js';
import type { ICommandHostAdapterAccess } from '../host-roles.js';
import type { ICommand } from '../types.js';
// Plugin command adapter contracts SSOT relocated to @robota-sdk/agent-interface-command (DATA-001).
import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';

export type {
  TPluginInstallScope,
  ICommandInstalledPlugin,
  ICommandAvailablePlugin,
  ICommandMarketplaceSource,
  ICommandPluginReloadResult,
  ICommandPluginAdapter,
} from '@robota-sdk/agent-interface-command';

export const PLUGIN_COMMAND_DESCRIPTION = 'Manage plugins';
export const PLUGIN_COMMAND_ARGUMENT_HINT =
  'manage | list | install <name@marketplace> | uninstall <name@marketplace> | enable <name@marketplace> | disable <name@marketplace> | marketplace <action>';
export const RELOAD_PLUGINS_COMMAND_DESCRIPTION =
  'After installing, enabling or disabling plugins, refresh the command list, skill routing and model skill catalogue. Returns the loaded resource count; hook changes need a new session. User-only because this activates installed code.';

/** CMD-004: `/plugin manage` asks the REQUESTING surface to open its plugin manager (UI intent). */
export function createShowPluginManagerIntent(): TCommandUiIntent {
  return { type: 'show-plugin-manager' };
}

export function resolvePluginCommandAdapter(
  context: ICommandHostAdapterAccess,
): ICommandPluginAdapter | undefined {
  return context.getCommandHostAdapters?.().plugin;
}

export function buildPluginCommandSubcommands(): ICommand[] {
  return [
    { name: 'manage', description: 'Open plugin manager', source: 'plugin-manager' },
    { name: 'list', description: 'List installed plugins', source: 'plugin-manager' },
    { name: 'install', description: 'Install a plugin', source: 'plugin-manager' },
    { name: 'uninstall', description: 'Uninstall a plugin', source: 'plugin-manager' },
    { name: 'enable', description: 'Enable a plugin', source: 'plugin-manager' },
    { name: 'disable', description: 'Disable a plugin', source: 'plugin-manager' },
    {
      name: 'marketplace',
      description: 'Manage plugin marketplaces',
      source: 'plugin-manager',
      subcommands: [
        { name: 'add', description: 'Add marketplace source', source: 'plugin-manager' },
        { name: 'remove', description: 'Remove marketplace source', source: 'plugin-manager' },
        { name: 'update', description: 'Update marketplace source', source: 'plugin-manager' },
        { name: 'list', description: 'List marketplace sources', source: 'plugin-manager' },
      ],
    },
  ];
}
