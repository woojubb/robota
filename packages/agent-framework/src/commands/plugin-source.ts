import type { ICommandSource, ICommand } from '../command-api/types.js';
import type { ILoadedBundlePlugin } from '../plugins/index.js';
import type { IBundleSkill } from '../plugins/index.js';

function skillCommandMetadata(
  skill: IBundleSkill,
): Pick<
  ICommand,
  | 'argumentHint'
  | 'disableModelInvocation'
  | 'userInvocable'
  | 'allowedTools'
  | 'model'
  | 'effort'
  | 'context'
  | 'agent'
> {
  return {
    ...(skill.argumentHint !== undefined ? { argumentHint: skill.argumentHint } : {}),
    ...(skill.disableModelInvocation !== undefined
      ? { disableModelInvocation: skill.disableModelInvocation }
      : {}),
    ...(skill.userInvocable !== undefined ? { userInvocable: skill.userInvocable } : {}),
    ...(skill.allowedTools !== undefined ? { allowedTools: skill.allowedTools } : {}),
    ...(skill.model !== undefined ? { model: skill.model } : {}),
    ...(skill.effort !== undefined ? { effort: skill.effort } : {}),
    ...(skill.context !== undefined ? { context: skill.context } : {}),
    ...(skill.agent !== undefined ? { agent: skill.agent } : {}),
  };
}

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

  getCommands(): ICommand[] {
    const commands: ICommand[] = [];

    for (const plugin of this.plugins) {
      // Skills: /name with (plugin-name) hint in description
      for (const skill of plugin.skills) {
        const baseName = skill.name.includes('@') ? skill.name.split('@')[0] : skill.name;
        commands.push({
          name: baseName,
          description: `(${plugin.manifest.name}) ${skill.description}`,
          source: 'plugin',
          skillContent: skill.skillContent,
          pluginDir: plugin.pluginDir,
          ...skillCommandMetadata(skill),
        });
      }

      // Commands: /plugin:name (already namespaced by loader)
      for (const cmd of plugin.commands) {
        commands.push({
          name: cmd.name,
          description: cmd.description,
          source: 'plugin',
          skillContent: cmd.skillContent,
          pluginDir: plugin.pluginDir,
          ...skillCommandMetadata(cmd),
        });
      }
    }

    return commands;
  }
}
