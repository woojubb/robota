import { homedir } from 'node:os';
import { join } from 'node:path';

import { createHostBundlePluginLoader, PluginCommandSource } from '@robota-sdk/agent-framework';

import type { CommandRegistry } from '@robota-sdk/agent-framework';

const PLUGIN_SOURCE_NAME = 'plugin';

function getHomeDir(): string {
  return process.env.HOME ?? homedir();
}

export function reloadPluginCommandSource(registry: CommandRegistry): number {
  const home = getHomeDir();
  // PLG-021 / issue #2025: the reload path reported plugins as reloaded while a disabled plugin's
  // commands came back with them, because the bare loader defaults its enablement map to `{}`.
  const loader = createHostBundlePluginLoader({ pluginsDir: join(home, '.robota', 'plugins') });
  try {
    // allow-fallback: plugin load failure is non-fatal — clear source and return empty
    const plugins = loader.loadPluginsSync();
    if (plugins.length === 0) {
      registry.replaceSource(PLUGIN_SOURCE_NAME);
      return 0;
    }
    registry.replaceSource(PLUGIN_SOURCE_NAME, new PluginCommandSource(plugins));
    return plugins.length;
  } catch {
    // allow-fallback: plugin load failure is non-fatal — clear source and return empty
    registry.replaceSource(PLUGIN_SOURCE_NAME);
    return 0;
  }
}
