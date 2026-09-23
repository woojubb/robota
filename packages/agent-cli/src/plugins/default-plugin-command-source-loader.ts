import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadHostBundlePluginsFromScopes, PluginCommandSource } from '@robota-sdk/agent-framework';

import type { CommandRegistry, TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

const PLUGIN_SOURCE_NAME = 'plugin';

function getHomeDir(): string {
  return process.env.HOME ?? homedir();
}

/**
 * Issue #2487 (PLG-021 residual): `install --scope project` writes under the project's own plugin
 * directory, but this loader read only the user-level one, so a project-scope install was invisible
 * to the session that made it. Project scope is listed first — the more specific one wins when a
 * plugin is present in both.
 */
function pluginsDirUnder(base: string): string {
  return join(base, '.robota', 'plugins');
}

/**
 * The admitted plugin scope directories, most specific first. Project plugins are executable input,
 * so only a trusted workspace may include that scope. Doctor and theme discovery share this layout.
 */
export function pluginScopeDirs(
  cwd: string | undefined,
  userHome: string = getHomeDir(),
  projectAccess?: TWorkspaceProjectAccess,
): string[] {
  const user = pluginsDirUnder(userHome);
  return cwd === undefined || projectAccess?.status !== 'trusted'
    ? [user]
    : [pluginsDirUnder(cwd), user];
}

export function reloadPluginCommandSource(
  registry: CommandRegistry,
  cwd?: string,
  projectAccess?: TWorkspaceProjectAccess,
): number {
  try {
    // PLG-021 / issue #2025: the reload path reported plugins as reloaded while a disabled plugin's
    // commands came back with them, because the bare loader defaults its enablement map to `{}`.
    // allow-fallback: plugin load failure is non-fatal — clear source and return empty
    const plugins = loadHostBundlePluginsFromScopes(pluginScopeDirs(cwd, getHomeDir(), projectAccess));
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
