import type { ILoadedBundlePlugin } from '@robota-sdk/agent-sdk';
import type { ICommandSource, ISlashCommand } from './types.js';

/**
 * Command source that discovers skills and commands from loaded BundlePlugins.
 *
 * - Skills: exposed as `/name` with `(plugin-name)` hint in description.
 * - Commands: exposed as `/plugin:command` (already namespaced by the loader).
 */
export class PluginCommandSource implements ICommandSource {
  readonly name = 'plugin';
  private readonly plugins: ILoadedBundlePlugin[];

  constructor(plugins: ILoadedBundlePlugin[]) {
    this.plugins = plugins;
  }

  getCommands(): ISlashCommand[] {
    const commands: ISlashCommand[] = [];

    for (const plugin of this.plugins) {
      // Skills: /name with (plugin-name) hint in description
      for (const skill of plugin.skills) {
        const baseName = skill.name.includes('@') ? skill.name.split('@')[0] : skill.name;
        commands.push({
          name: baseName,
          description: `${skill.description} (${plugin.manifest.name})`,
          source: 'plugin',
          skillContent: skill.skillContent,
        });
      }

      // Commands: /plugin:name (already namespaced by loader)
      for (const cmd of plugin.commands) {
        commands.push({
          name: cmd.name,
          description: cmd.description,
          source: 'plugin',
          skillContent: cmd.skillContent,
        });
      }
    }

    return commands;
  }
}
