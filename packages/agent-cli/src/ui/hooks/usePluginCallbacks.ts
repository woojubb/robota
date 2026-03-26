/**
 * Hook: create IPluginCallbacks wired to real SDK instances.
 * All plugin components share a single PluginSettingsStore.
 */

import { useMemo } from 'react';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  PluginSettingsStore,
  BundlePluginLoader,
  BundlePluginInstaller,
  MarketplaceClient,
} from '@robota-sdk/agent-sdk';
import type { IPluginCallbacks } from '../../commands/slash-executor.js';

export function usePluginCallbacks(cwd: string): IPluginCallbacks {
  return useMemo(() => {
    const home = homedir();
    const pluginsDir = join(home, '.robota', 'plugins');
    const userSettingsPath = join(home, '.robota', 'settings.json');

    // Single shared settings store — prevents concurrent write conflicts
    const settingsStore = new PluginSettingsStore(userSettingsPath);

    const marketplace = new MarketplaceClient({ pluginsDir });
    const installer = new BundlePluginInstaller({
      pluginsDir,
      settingsStore,
      marketplaceClient: marketplace,
    });
    const loader = new BundlePluginLoader(pluginsDir);

    return {
      listInstalled: async () => {
        const plugins = await loader.loadAll();
        const enabledMap = settingsStore.getEnabledPlugins();
        return plugins.map((p) => {
          // Extract marketplace from pluginDir: .../cache/<marketplace>/<plugin>/<version>/
          const parts = p.pluginDir.split('/');
          const cacheIdx = parts.indexOf('cache');
          const marketplaceName = cacheIdx >= 0 ? parts[cacheIdx + 1] : '';
          const fullId = marketplaceName
            ? `${p.manifest.name}@${marketplaceName}`
            : p.manifest.name;
          return {
            name: fullId,
            description: p.manifest.description,
            enabled: enabledMap[fullId] !== false && enabledMap[p.manifest.name] !== false,
          };
        });
      },
      listAvailablePlugins: async (marketplaceName: string) => {
        let manifest;
        try {
          manifest = marketplace.fetchManifest(marketplaceName);
        } catch {
          return [];
        }
        const installed = installer.getInstalledPlugins();
        const installedNames = new Set(Object.values(installed).map((r) => r.pluginName));
        return manifest.plugins.map((p) => ({
          name: p.name,
          description: p.description,
          installed: installedNames.has(p.name),
        }));
      },
      install: async (pluginId: string, scope?: 'user' | 'project') => {
        const [name, marketplaceName] = pluginId.split('@');
        if (!name || !marketplaceName) {
          throw new Error('Plugin ID must be in format: name@marketplace');
        }
        if (scope === 'project') {
          const projectPluginsDir = join(cwd, '.robota', 'plugins');
          const projectInstaller = new BundlePluginInstaller({
            pluginsDir: projectPluginsDir,
            settingsStore,
            marketplaceClient: marketplace,
          });
          await projectInstaller.install(name, marketplaceName);
        } else {
          await installer.install(name, marketplaceName);
        }
      },
      uninstall: async (pluginId: string) => {
        await installer.uninstall(pluginId);
      },
      enable: async (pluginId: string) => {
        await installer.enable(pluginId);
      },
      disable: async (pluginId: string) => {
        await installer.disable(pluginId);
      },
      marketplaceAdd: async (source: string) => {
        if (source.includes('/') && !source.includes(':')) {
          // owner/repo format -> GitHub source
          return marketplace.addMarketplace({ type: 'github', repo: source });
        } else {
          // git URL
          return marketplace.addMarketplace({ type: 'git', url: source });
        }
      },
      marketplaceRemove: async (name: string) => {
        // Uninstall all plugins from this marketplace first
        const installedFromMarketplace = installer.getPluginsByMarketplace(name);
        for (const record of installedFromMarketplace) {
          await installer.uninstall(`${record.pluginName}@${record.marketplace}`);
        }
        marketplace.removeMarketplace(name);
      },
      marketplaceUpdate: async (name: string) => {
        marketplace.updateMarketplace(name);
      },
      marketplaceList: async () => {
        return marketplace.listMarketplaces().map((m) => ({
          name: m.name,
          type: m.source.type,
        }));
      },
      reloadPlugins: async () => {
        // Reload is handled by the caller re-scanning plugins
      },
    };
  }, [cwd]);
}
