/**
 * Plugin hooks merger — merges plugin hooks into session config.
 */

import { join, dirname } from 'node:path';
import type { ILoadedBundlePlugin } from './bundle-plugin-types.js';
import type { THooksConfig } from '@robota-sdk/agent-core';

/** Build plugin env vars for a plugin. */
function buildPluginEnv(plugin: ILoadedBundlePlugin): Record<string, string> {
  const dataDir = join(dirname(dirname(plugin.pluginDir)), 'data', plugin.manifest.name);
  return {
    CLAUDE_PLUGIN_ROOT: plugin.pluginDir,
    CLAUDE_PLUGIN_PATH: plugin.pluginDir,
    CLAUDE_PLUGIN_DATA: dataDir,
  };
}

interface IHookGroup {
  hooks?: Array<{ command?: string; [key: string]: string | undefined }>;
  env?: Record<string, string>;
  [key: string]: unknown;
}

/** Replace ${CLAUDE_PLUGIN_ROOT} in hook command strings. */
function resolvePluginRoot(group: IHookGroup, pluginDir: string): IHookGroup {
  if (Array.isArray(group.hooks)) {
    return {
      ...group,
      hooks: group.hooks.map((h) => {
        if (typeof h.command === 'string') {
          return {
            ...h,
            command: h.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginDir),
          };
        }
        return h;
      }),
    };
  }
  return group;
}

/** Merge plugin hooks into a single THooksConfig. */
export function mergePluginHooks(plugins: ILoadedBundlePlugin[]): THooksConfig {
  const merged: Record<string, IHookGroup[]> = {};
  for (const plugin of plugins) {
    const hooksObj = plugin.hooks as Record<string, IHookGroup | IHookGroup[]> | undefined;
    if (!hooksObj) continue;
    const pluginEnv = buildPluginEnv(plugin);
    const innerHooks = (hooksObj.hooks ?? hooksObj) as Record<string, IHookGroup[]>;
    for (const [event, groups] of Object.entries(innerHooks)) {
      if (!Array.isArray(groups)) continue;
      if (!merged[event]) merged[event] = [];
      const resolved = groups.map((group) => {
        const r = resolvePluginRoot(group, plugin.pluginDir);
        r.env = pluginEnv;
        return r;
      });
      merged[event]!.push(...resolved);
    }
  }
  return merged as THooksConfig;
}

/** Merge plugin hooks into config hooks (plugin hooks have lowest priority). */
export function mergeHooksIntoConfig(
  configHooks: Record<string, IHookGroup[]> | undefined,
  pluginHooks: Record<string, IHookGroup[]>,
): Record<string, IHookGroup[]> | undefined {
  const pluginKeys = Object.keys(pluginHooks);
  if (pluginKeys.length === 0) return configHooks;
  const merged: Record<string, IHookGroup[]> = {};
  for (const [event, groups] of Object.entries(pluginHooks)) {
    merged[event] = [...groups];
  }
  if (configHooks) {
    for (const [event, groups] of Object.entries(configHooks)) {
      if (!Array.isArray(groups)) continue;
      if (!merged[event]) merged[event] = [];
      merged[event]!.push(...groups);
    }
  }
  return merged;
}
