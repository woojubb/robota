import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { PluginCommandSource } from '../commands/plugin-source.js';
import { loadHostBundlePluginsFromScopes } from '../plugins/index.js';
import { getWorkspaceProjectIdentity } from '../workspace-trust/workspace-authority.js';

import type { ICommand } from '../command-api/types.js';
import type { INodeHostSettingsSource } from '../config/node-host-settings-source.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';
import type { IFileSystem } from '@robota-sdk/agent-core';

/** What decides which bundle plugins a session loads. */
export interface ISessionPluginScope {
  readonly bare?: boolean;
  readonly projectAccess?: TWorkspaceProjectAccess;
  readonly pluginDirectories?: { readonly user?: string; readonly project?: string };
  readonly userSettingsSources?: readonly INodeHostSettingsSource[];
  /** The files plugin directories are read through (`host.files.sync`); absent, there are none to read. */
  readonly fs?: IFileSystem;
}

/**
 * The files plugin directories are read through. A session that names plugin directories needs a
 * host that lends files, and says so when it is built rather than loading no plugin at all.
 */
export function requireSessionPluginFiles(fs: IFileSystem | undefined): IFileSystem {
  if (fs === undefined) {
    throw new Error(
      '`pluginDirectories` need file access, and the session host supplies none (`host.files`). ' +
        'Pass a host that lends files, such as `createNodeFrameworkHost`, or omit `pluginDirectories`.',
    );
  }
  return fs;
}

/**
 * Whether `directory` lies inside the worktree the trust decision covers. Trust is granted to one
 * repository, so a project plugin folder elsewhere was never part of that decision.
 */
function insideTrustedWorktree(
  directory: string,
  access: Extract<TWorkspaceProjectAccess, { status: 'trusted' }>,
): boolean {
  try {
    const root = realpathSync(getWorkspaceProjectIdentity(access.authority).worktreeRoot);
    const target = existsSync(directory) ? realpathSync(directory) : resolve(directory);
    const remainder = relative(root, target);
    return remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
  } catch {
    // An authority that no longer resolves cannot admit executable project plugin content.
    return false;
  }
}

/**
 * The plugin directories a session may load, most specific first. Project plugins may contain
 * executable hooks, so that scope is included only after the host has granted workspace trust, and
 * only when it lies inside the trusted worktree.
 */
export function sessionPluginDirectories(scope: ISessionPluginScope): string[] {
  const access = scope.projectAccess;
  const project = scope.pluginDirectories?.project;
  return [
    ...(access?.status === 'trusted' &&
    project !== undefined &&
    insideTrustedWorktree(project, access)
      ? [project]
      : []),
    ...(scope.pluginDirectories?.user !== undefined ? [scope.pluginDirectories.user] : []),
  ];
}

/** The user settings file that records which plugins are enabled; absent means no plugins load. */
export function sessionPluginSettingsPath(scope: ISessionPluginScope): string | undefined {
  if (scope.bare === true) return undefined;
  return scope.userSettingsSources?.find((source) => source.scope === 'user')?.path;
}

/** Skills and commands admitted for the session's next snapshot; discovery errors admit none. */
export function loadSessionPluginSkills(scope: ISessionPluginScope): readonly ICommand[] {
  const settingsPath = sessionPluginSettingsPath(scope);
  if (settingsPath === undefined) return [];
  const directories = sessionPluginDirectories(scope);
  if (directories.length === 0) return [];
  const fs = requireSessionPluginFiles(scope.fs);
  try {
    return new PluginCommandSource(
      loadHostBundlePluginsFromScopes(directories, { settingsPath, fs }),
    ).getCommands();
  } catch {
    // allow-fallback: plugin discovery failing leaves the session's own skills working.
    return [];
  }
}
