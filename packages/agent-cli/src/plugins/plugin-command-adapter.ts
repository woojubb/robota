import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BundlePluginInstaller,
  BundlePluginLoader,
  MarketplaceClient,
  PluginSettingsStore,
} from '@robota-sdk/agent-sdk';
import type {
  ICommandAvailablePlugin,
  ICommandInstalledPlugin,
  ICommandMarketplaceSource,
  ICommandPluginAdapter,
  IMarketplaceManifest,
  TPluginInstallScope,
} from '@robota-sdk/agent-sdk';

interface ICliPluginServices {
  cwd: string;
  marketplace: MarketplaceClient;
  installer: BundlePluginInstaller;
  loader: BundlePluginLoader;
  settingsStore: PluginSettingsStore;
}

function createCliPluginServices(cwd: string): ICliPluginServices {
  const home = homedir();
  const pluginsDir = join(home, '.robota', 'plugins');
  const userSettingsPath = join(home, '.robota', 'settings.json');

  const exec = (command: string, options: { timeout: number; stdio?: string }) =>
    execSync(command, {
      timeout: options.timeout,
      stdio: (options.stdio ?? 'pipe') as 'pipe' | 'inherit' | 'ignore',
    });

  const settingsStore = new PluginSettingsStore(userSettingsPath);
  const marketplace = new MarketplaceClient({ pluginsDir, exec });
  const installer = new BundlePluginInstaller({
    pluginsDir,
    settingsStore,
    marketplaceClient: marketplace,
    exec,
  });
  const loader = new BundlePluginLoader(pluginsDir);

  return {
    cwd,
    marketplace,
    installer,
    loader,
    settingsStore,
  };
}

async function listInstalledPlugins(
  services: ICliPluginServices,
): Promise<readonly ICommandInstalledPlugin[]> {
  const plugins = await services.loader.loadAll();
  const enabledMap = services.settingsStore.getEnabledPlugins();
  return plugins.map((plugin) => {
    const parts = plugin.pluginDir.split('/');
    const cacheIdx = parts.indexOf('cache');
    const marketplaceName = cacheIdx >= 0 ? (parts[cacheIdx + 1] ?? '') : '';
    const fullId = marketplaceName
      ? `${plugin.manifest.name}@${marketplaceName}`
      : plugin.manifest.name;
    return {
      name: fullId,
      description: plugin.manifest.description,
      enabled: enabledMap[fullId] !== false && enabledMap[plugin.manifest.name] !== false,
    };
  });
}

async function listAvailablePlugins(
  services: ICliPluginServices,
  marketplaceName: string,
): Promise<readonly ICommandAvailablePlugin[]> {
  let manifest: IMarketplaceManifest;
  try {
    manifest = services.marketplace.fetchManifest(marketplaceName);
  } catch {
    return [];
  }
  const installed = services.installer.getInstalledPlugins();
  const installedNames = new Set(Object.values(installed).map((record) => record.pluginName));
  return manifest.plugins.map((plugin) => ({
    name: plugin.name,
    description: plugin.description,
    installed: installedNames.has(plugin.name),
  }));
}

async function installPlugin(
  services: ICliPluginServices,
  pluginId: string,
  scope?: TPluginInstallScope,
): Promise<void> {
  const [name, marketplaceName] = pluginId.split('@');
  if (!name || !marketplaceName) {
    throw new Error('Plugin ID must be in format: name@marketplace');
  }
  if (scope === 'project') {
    const projectPluginsDir = join(services.cwd, '.robota', 'plugins');
    const projectExec = (command: string, options: { timeout: number; stdio?: string }) =>
      execSync(command, {
        timeout: options.timeout,
        stdio: (options.stdio ?? 'pipe') as 'pipe' | 'inherit' | 'ignore',
      });
    const projectInstaller = new BundlePluginInstaller({
      pluginsDir: projectPluginsDir,
      settingsStore: services.settingsStore,
      marketplaceClient: services.marketplace,
      exec: projectExec,
    });
    await projectInstaller.install(name, marketplaceName);
    return;
  }
  await services.installer.install(name, marketplaceName);
}

async function removeMarketplace(services: ICliPluginServices, name: string): Promise<void> {
  const installedFromMarketplace = services.installer.getPluginsByMarketplace(name);
  for (const record of installedFromMarketplace) {
    await services.installer.uninstall(`${record.pluginName}@${record.marketplace}`);
  }
  services.marketplace.removeMarketplace(name);
}

function listMarketplaces(services: ICliPluginServices): readonly ICommandMarketplaceSource[] {
  return services.marketplace.listMarketplaces().map((marketplaceEntry) => ({
    name: marketplaceEntry.name,
    type: marketplaceEntry.source.type,
  }));
}

export function createCliPluginCommandAdapter(cwd: string): ICommandPluginAdapter {
  const services = createCliPluginServices(cwd);
  return {
    listInstalled: () => listInstalledPlugins(services),
    listAvailablePlugins: (marketplaceName) => listAvailablePlugins(services, marketplaceName),
    install: (pluginId, scope) => installPlugin(services, pluginId, scope),
    uninstall: async (pluginId) => services.installer.uninstall(pluginId),
    enable: async (pluginId) => services.installer.enable(pluginId),
    disable: async (pluginId) => services.installer.disable(pluginId),
    marketplaceAdd: async (source) => {
      if (source.includes('/') && !source.includes(':')) {
        return services.marketplace.addMarketplace({ type: 'github', repo: source });
      }
      return services.marketplace.addMarketplace({ type: 'git', url: source });
    },
    marketplaceRemove: (name) => removeMarketplace(services, name),
    marketplaceUpdate: async (name) => services.marketplace.updateMarketplace(name),
    marketplaceList: async () => listMarketplaces(services),
    reloadPlugins: async () => ({
      loadedPluginCount: (await services.loader.loadAll()).length,
    }),
  };
}
