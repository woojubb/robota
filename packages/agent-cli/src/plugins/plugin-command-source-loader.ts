import { homedir } from 'node:os';
import { join } from 'node:path';
import { BundlePluginLoader, CommandRegistry, PluginCommandSource } from '@robota-sdk/agent-sdk';

const PLUGIN_SOURCE_NAME = 'plugin';

function getHomeDir(): string {
  return process.env.HOME ?? homedir();
}

export function reloadPluginCommandSource(registry: CommandRegistry): number {
  const pluginsDir = join(getHomeDir(), '.robota', 'plugins');
  const loader = new BundlePluginLoader(pluginsDir);
  try {
    const plugins = loader.loadPluginsSync();
    if (plugins.length === 0) {
      registry.replaceSource(PLUGIN_SOURCE_NAME);
      return 0;
    }
    registry.replaceSource(PLUGIN_SOURCE_NAME, new PluginCommandSource(plugins));
    return plugins.length;
  } catch {
    registry.replaceSource(PLUGIN_SOURCE_NAME);
    return 0;
  }
}
