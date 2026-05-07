import type { TCommandEffect } from '../effects.js';
import type { ICommandHostContext } from '../host-context.js';
import type { ICommand } from '../types.js';

export const PLUGIN_COMMAND_DESCRIPTION = 'Manage plugins';
export const PLUGIN_COMMAND_ARGUMENT_HINT =
  'manage | install <name@marketplace> | uninstall <name@marketplace> | enable <name@marketplace> | disable <name@marketplace> | marketplace <action>';
export const RELOAD_PLUGINS_COMMAND_DESCRIPTION = 'Reload all plugin resources';

export type TPluginInstallScope = 'user' | 'project';

export interface ICommandInstalledPlugin {
  name: string;
  description: string;
  enabled: boolean;
}

export interface ICommandAvailablePlugin {
  name: string;
  description: string;
  installed: boolean;
}

export interface ICommandMarketplaceSource {
  name: string;
  type: string;
}

export interface ICommandPluginReloadResult {
  loadedPluginCount: number;
}

export interface ICommandPluginAdapter {
  listInstalled(): Promise<readonly ICommandInstalledPlugin[]>;
  listAvailablePlugins(marketplace: string): Promise<readonly ICommandAvailablePlugin[]>;
  install(pluginId: string, scope?: TPluginInstallScope): Promise<void>;
  uninstall(pluginId: string): Promise<void>;
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;
  marketplaceAdd(source: string): Promise<string>;
  marketplaceRemove(name: string): Promise<void>;
  marketplaceUpdate(name: string): Promise<void>;
  marketplaceList(): Promise<readonly ICommandMarketplaceSource[]>;
  reloadPlugins(): Promise<ICommandPluginReloadResult>;
}

export function createPluginTuiRequestedEffect(): TCommandEffect {
  return { type: 'plugin-tui-requested' };
}

export function createPluginRegistryReloadRequestedEffect(): TCommandEffect {
  return { type: 'plugin-registry-reload-requested' };
}

export function resolvePluginCommandAdapter(
  context: ICommandHostContext,
): ICommandPluginAdapter | undefined {
  return context.getCommandHostAdapters?.().plugin;
}

export function buildPluginCommandSubcommands(): ICommand[] {
  return [
    { name: 'manage', description: 'Open plugin manager', source: 'plugin-manager' },
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
