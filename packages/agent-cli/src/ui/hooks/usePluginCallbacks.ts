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

    const marketplace = new MarketplaceClient({ settingsStore });
    const installer = new BundlePluginInstaller({ pluginsDir, settingsStore });
    const loader = new BundlePluginLoader(pluginsDir);

    return {
      listInstalled: async () => {
        const plugins = await loader.loadAll();
        return plugins.map((p) => ({
          name: p.manifest.name,
          description: p.manifest.description,
          enabled: true,
        }));
      },
      install: async (pluginId: string) => {
        const [name, marketplaceName] = pluginId.split('@');
        if (!name || !marketplaceName) {
          throw new Error('Plugin ID must be in format: name@marketplace');
        }
        const manifest = await marketplace.fetchManifest(marketplaceName);
        const entry = manifest.plugins.find((p) => p.name === name);
        if (!entry) {
          throw new Error(`Plugin "${name}" not found in marketplace "${marketplaceName}"`);
        }
        await installer.install(name, marketplaceName, entry.source);
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
          marketplace.addSource(source, { type: 'github', repo: source });
        } else {
          marketplace.addSource(source, { type: 'url', url: source });
        }
      },
      marketplaceList: async () => {
        return marketplace.listSources().map((s) => ({
          name: s.name,
          type: s.source.type,
        }));
      },
      reloadPlugins: async () => {
        // Reload is handled by the caller re-scanning plugins
      },
    };
  }, [cwd]);
}
