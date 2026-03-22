import type { ILoadedBundlePlugin } from '@robota-sdk/agent-sdk';
import type { ICommandSource, ISlashCommand } from './types.js';

/**
 * Command source that discovers skills from loaded BundlePlugins.
 * Skills are namespaced as `skill-name@plugin-name`.
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
      for (const skill of plugin.skills) {
        commands.push({
          name: skill.name,
          description: skill.description,
          source: 'plugin',
          skillContent: skill.skillContent,
        });
      }
    }

    return commands;
  }
}
