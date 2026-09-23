import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  getWorkspaceProjectIdentity,
  loadHostBundlePluginsFromScopes,
  PluginCommandSource,
  PROJECT_PLUGIN_RELATIVE_DIRECTORY,
} from '@robota-sdk/agent-framework';

import type { CommandRegistry, TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { robotaUserSettingsPath } from '../product/robota-user-settings.js';

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
  return join(base, PROJECT_PLUGIN_RELATIVE_DIRECTORY);
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
  if (cwd === undefined || projectAccess?.status !== 'trusted') return [user];
  try {
    // The status field alone is insufficient: a decision can be revoked or belong to another root.
    const root = getWorkspaceProjectIdentity(projectAccess.authority).worktreeRoot;
    const resolvedCwd = realpathSync(cwd);
    const remainder = relative(root, resolvedCwd);
    if (remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) {
      return [user];
    }
    return [pluginsDirUnder(resolvedCwd), user];
  } catch {
    // An invalid or expired authority cannot admit executable project plugin content.
    return [user];
  }
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
    const plugins = loadHostBundlePluginsFromScopes(
      pluginScopeDirs(cwd, getHomeDir(), projectAccess),
      { settingsPath: robotaUserSettingsPath(getHomeDir()) },
    );
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
