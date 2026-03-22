/**
 * Hook: create a CommandRegistry with builtin, skill, and plugin commands.
 * Also returns loaded plugin hooks for merging into session config.
 */

import { useRef } from 'react';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ILoadedBundlePlugin, THooksConfig } from '@robota-sdk/agent-sdk';
import { BundlePluginLoader } from '@robota-sdk/agent-sdk';
import { CommandRegistry } from '../../commands/command-registry.js';
import { BuiltinCommandSource } from '../../commands/builtin-source.js';
import { SkillCommandSource } from '../../commands/skill-source.js';
import { PluginCommandSource } from '../../commands/plugin-source.js';

export interface ICommandRegistryResult {
  registry: CommandRegistry;
  pluginHooks: THooksConfig;
}

/** Merge plugin hooks into a single THooksConfig. */
function mergePluginHooks(plugins: ILoadedBundlePlugin[]): THooksConfig {
  const merged: Record<string, unknown[]> = {};
  for (const plugin of plugins) {
    const hooksObj = plugin.hooks as Record<string, unknown> | undefined;
    if (!hooksObj) continue;

    // hooks.json has { hooks: { EventName: [...] } } structure
    const innerHooks = (hooksObj.hooks ?? hooksObj) as Record<string, unknown[]>;
    for (const [event, groups] of Object.entries(innerHooks)) {
      if (!Array.isArray(groups)) continue;
      if (!merged[event]) merged[event] = [];

      // Resolve ${CLAUDE_PLUGIN_ROOT} in hook commands
      const resolved = groups.map((group) => resolvePluginRoot(group, plugin.pluginDir));
      merged[event].push(...resolved);
    }
  }
  return merged as THooksConfig;
}

/** Replace ${CLAUDE_PLUGIN_ROOT} in hook command strings. */
function resolvePluginRoot(group: unknown, pluginDir: string): unknown {
  if (typeof group !== 'object' || group === null) return group;
  const obj = group as Record<string, unknown>;
  if (Array.isArray(obj.hooks)) {
    return {
      ...obj,
      hooks: obj.hooks.map((h: unknown) => {
        if (typeof h !== 'object' || h === null) return h;
        const hook = h as Record<string, unknown>;
        if (typeof hook.command === 'string') {
          return {
            ...hook,
            command: hook.command.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginDir),
          };
        }
        return hook;
      }),
    };
  }
  return group;
}

export function useCommandRegistry(cwd: string): ICommandRegistryResult {
  const resultRef = useRef<ICommandRegistryResult | null>(null);
  if (resultRef.current === null) {
    const registry = new CommandRegistry();
    registry.addSource(new BuiltinCommandSource());
    registry.addSource(new SkillCommandSource(cwd));

    let pluginHooks: THooksConfig = {};

    // Load installed plugins and register their skills + hooks
    const pluginsDir = join(homedir(), '.robota', 'plugins');
    const loader = new BundlePluginLoader(pluginsDir);
    try {
      const plugins = loader.loadPluginsSync();
      if (plugins.length > 0) {
        registry.addSource(new PluginCommandSource(plugins));
        pluginHooks = mergePluginHooks(plugins);
      }
    } catch {
      // No plugins dir or load failed — continue without plugins
    }

    resultRef.current = { registry, pluginHooks };
  }
  return resultRef.current;
}
