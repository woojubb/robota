import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  BundlePluginInstaller,
  BundlePluginLoader,
  MarketplaceClient,
  NodeHostPluginSettingsStore,
} from '@robota-sdk/agent-framework';

import type { IMarketplaceManifest } from '@robota-sdk/agent-framework';
import type {
  ICommandAvailablePlugin,
  ICommandInstalledPlugin,
  ICommandMarketplaceSource,
  ICommandPluginAdapter,
  TPluginInstallScope,
} from '@robota-sdk/agent-interface-command';

interface IPluginServices {
  cwd: string;
  marketplace: MarketplaceClient;
  installer: BundlePluginInstaller;
  loader: BundlePluginLoader;
  settingsStore: NodeHostPluginSettingsStore;
}

/**
 * Variables a git subprocess may inherit. Everything else is dropped.
 *
 * SEC-017 (issue #2019). Argv stops the SHELL from reading attacker-controlled text; it does not stop
 * GIT itself. `GIT_SSH_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_PROXY_COMMAND` and `GIT_ASKPASS` each name a
 * program git executes, so an inherited one turns `git clone` into "run whatever that variable says" —
 * the same outcome the string-shell port had, reached through a different door. An ALLOWLIST rather
 * than a denylist because the set of git-honoured variables is git's to grow, and a denylist written
 * today is wrong the next time it does.
 *
 * `PATH` and `HOME` are here because git cannot find its own subcommands or the user's config without
 * them. The proxy variables are here because dropping them breaks clone behind a corporate proxy, which
 * is a real configuration rather than an attack surface — they name a SERVER, not a program to run.
 */
const GIT_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const;

/** The inherited environment, reduced to the allowlist. */
export function scrubbedGitEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of GIT_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * The argv process adapter injected at the composition root.
 *
 * `execFileSync` does not spawn a shell, so no value in `args` is ever parsed as syntax. `shell` is
 * passed explicitly as `false` rather than left to the default: the default is what a later edit
 * changes without noticing, and this is the one line the whole fix rests on.
 */
export function runGit(
  file: string,
  args: readonly string[],
  options: { timeout: number; stdio?: string },
): Buffer {
  return execFileSync(file, [...args], {
    timeout: options.timeout,
    stdio: (options.stdio ?? 'pipe') as 'pipe' | 'inherit' | 'ignore',
    shell: false,
    env: scrubbedGitEnv(),
  });
}

function createPluginServices(cwd: string): IPluginServices {
  const home = homedir();
  const pluginsDir = join(home, '.robota', 'plugins');
  const userSettingsPath = join(home, '.robota', 'settings.json');

  const settingsStore = new NodeHostPluginSettingsStore(userSettingsPath);
  const marketplace = new MarketplaceClient({ pluginsDir, exec: runGit });
  const installer = new BundlePluginInstaller({
    pluginsDir,
    settingsStore,
    marketplaceClient: marketplace,
    exec: runGit,
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
  services: IPluginServices,
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
  services: IPluginServices,
  marketplaceName: string,
): Promise<readonly ICommandAvailablePlugin[]> {
  let manifest: IMarketplaceManifest;
  try {
    manifest = services.marketplace.fetchManifest(marketplaceName);
  } catch {
    // allow-fallback: marketplace manifest fetch failure is non-fatal — return empty list
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
  services: IPluginServices,
  pluginId: string,
  scope?: TPluginInstallScope,
): Promise<void> {
  const [name, marketplaceName] = pluginId.split('@');
  if (!name || !marketplaceName) {
    throw new Error('Plugin ID must be in format: name@marketplace');
  }
  if (scope === 'project') {
    const projectPluginsDir = join(services.cwd, '.robota', 'plugins');
    const projectInstaller = new BundlePluginInstaller({
      pluginsDir: projectPluginsDir,
      settingsStore: services.settingsStore,
      marketplaceClient: services.marketplace,
      exec: runGit,
    });
    await projectInstaller.install(name, marketplaceName);
    return;
  }
  await services.installer.install(name, marketplaceName);
}

async function removeMarketplace(services: IPluginServices, name: string): Promise<void> {
  const installedFromMarketplace = services.installer.getPluginsByMarketplace(name);
  for (const record of installedFromMarketplace) {
    await services.installer.uninstall(`${record.pluginName}@${record.marketplace}`);
  }
  services.marketplace.removeMarketplace(name);
}

function listMarketplaces(services: IPluginServices): readonly ICommandMarketplaceSource[] {
  return services.marketplace.listMarketplaces().map((marketplaceEntry) => ({
    name: marketplaceEntry.name,
    type: marketplaceEntry.source.type,
  }));
}

export function createDefaultPluginCommandAdapter(cwd: string): ICommandPluginAdapter {
  const services = createPluginServices(cwd);
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
