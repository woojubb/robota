import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadHostBundlePluginsFromScopes, PluginCommandSource } from '@robota-sdk/agent-framework';

import type { CommandRegistry } from '@robota-sdk/agent-framework';

const PLUGIN_SOURCE_NAME = 'plugin';

function getHomeDir(): string {
  return process.env.HOME ?? homedir();
}

/**
 * Issue #2487 (PLG-021 residual): `install --scope project` writes under `<cwd>/.robota/plugins`,
 * but this loader read only `~/.robota/plugins`, so a project-scope install was invisible to the
 * session that made it. Project scope is listed first — the more specific one wins when a plugin is
 * present in both.
 */
function pluginScopeDirs(cwd: string | undefined): string[] {
  const user = join(getHomeDir(), '.robota', 'plugins');
  return cwd === undefined ? [user] : [join(cwd, '.robota', 'plugins'), user];
}

export function reloadPluginCommandSource(registry: CommandRegistry, cwd?: string): number {
  try {
    // PLG-021 / issue #2025: the reload path reported plugins as reloaded while a disabled plugin's
    // commands came back with them, because the bare loader defaults its enablement map to `{}`.
    // allow-fallback: plugin load failure is non-fatal — clear source and return empty
    const plugins = loadHostBundlePluginsFromScopes(pluginScopeDirs(cwd));
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
