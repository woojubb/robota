import { PluginCommandSource } from '../commands/plugin-source.js';
import { loadHostBundlePluginsFromScopes } from '../plugins/index.js';

import type { ICommand } from '../command-api/types.js';
import type { INodeHostSettingsSource } from '../config/node-host-settings-source.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';

/** What decides which bundle plugins a session loads. */
export interface ISessionPluginScope {
  readonly bare?: boolean;
  readonly projectAccess?: TWorkspaceProjectAccess;
  readonly pluginDirectories?: { readonly user?: string; readonly project?: string };
  readonly userSettingsSources?: readonly INodeHostSettingsSource[];
}

/**
 * The plugin directories a session may load, most specific first. Project plugins may contain
 * executable hooks, so that scope is included only after the host has granted workspace trust.
 */
export function sessionPluginDirectories(scope: ISessionPluginScope): string[] {
  return [
    ...(scope.projectAccess?.status === 'trusted' && scope.pluginDirectories?.project !== undefined
      ? [scope.pluginDirectories.project]
      : []),
    ...(scope.pluginDirectories?.user !== undefined ? [scope.pluginDirectories.user] : []),
  ];
}

/** The user settings file that records which plugins are enabled; absent means no plugins load. */
export function sessionPluginSettingsPath(scope: ISessionPluginScope): string | undefined {
  if (scope.bare === true) return undefined;
  return scope.userSettingsSources?.find((source) => source.scope === 'user')?.path;
}

/**
 * The skills and commands of the bundle plugins this session may load, read once when the session is
 * built, like plugin hooks: a plugin installed, enabled or disabled later takes effect in the next
 * session, and a settings file that changes or stops parsing afterwards cannot re-enable a plugin the
 * user disabled.
 */
export function loadSessionPluginSkills(scope: ISessionPluginScope): readonly ICommand[] {
  const settingsPath = sessionPluginSettingsPath(scope);
  if (settingsPath === undefined) return [];
  try {
    return new PluginCommandSource(
      loadHostBundlePluginsFromScopes(sessionPluginDirectories(scope), { settingsPath }),
    ).getCommands();
  } catch {
    // allow-fallback: plugin discovery failing leaves the session's own skills working.
    return [];
  }
}
