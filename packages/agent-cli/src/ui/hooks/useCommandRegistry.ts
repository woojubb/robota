/**
 * Hook: create a CommandRegistry with builtin, skill, and plugin commands.
 */

import { useRef } from 'react';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BundlePluginLoader } from '@robota-sdk/agent-sdk';
import { CommandRegistry } from '../../commands/command-registry.js';
import { BuiltinCommandSource } from '../../commands/builtin-source.js';
import { SkillCommandSource } from '../../commands/skill-source.js';
import { PluginCommandSource } from '../../commands/plugin-source.js';

export function useCommandRegistry(cwd: string): CommandRegistry {
  const registryRef = useRef<CommandRegistry | null>(null);
  if (registryRef.current === null) {
    const registry = new CommandRegistry();
    registry.addSource(new BuiltinCommandSource());
    registry.addSource(new SkillCommandSource(cwd));

    // Load installed plugins and register their skills
    const pluginsDir = join(homedir(), '.robota', 'plugins');
    const loader = new BundlePluginLoader(pluginsDir);
    try {
      // loadAll is async but we need sync init — use the sync loadPlugins if available
      // For now, load synchronously since BundlePluginLoader's fs operations are sync
      const plugins = loader.loadPluginsSync();
      if (plugins.length > 0) {
        registry.addSource(new PluginCommandSource(plugins));
      }
    } catch {
      // No plugins dir or load failed — continue without plugins
    }

    registryRef.current = registry;
  }
  return registryRef.current;
}
