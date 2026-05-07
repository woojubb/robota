import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import { SkillCommandSource } from '@robota-sdk/agent-sdk';
import { executeSkillsCommand, SKILLS_COMMAND_DESCRIPTION } from './skills-command.js';

export interface ISkillsCommandModuleOptions {
  readonly cwd?: string;
}

export function createSkillsCommandEntry(): ICommand {
  return {
    name: 'skills',
    description: SKILLS_COMMAND_DESCRIPTION,
    source: 'skills',
    modelInvocable: true,
    userInvocable: true,
    argumentHint: '[list | <skill-name> [args]]',
    safety: 'read-only',
  };
}

function createSkillsSystemCommand(): ISystemCommand {
  const entry = createSkillsCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: true,
    argumentHint: entry.argumentHint,
    safety: entry.safety,
    lifecycle: 'inline',
    execute: executeSkillsCommand,
  };
}

export class SkillsCommandSource implements ICommandSource {
  readonly name = 'skills';

  getCommands(): ICommand[] {
    return [createSkillsCommandEntry()];
  }
}

export function createSkillsCommandModule(
  options: ISkillsCommandModuleOptions = {},
): ICommandModule {
  const commandSources: ICommandSource[] = [new SkillsCommandSource()];
  commandSources.push(new SkillCommandSource(options.cwd ?? process.cwd()));

  return {
    name: 'agent-command-skills',
    commandSources,
    systemCommands: [createSkillsSystemCommand()],
  };
}
