/**
 * GOAL-001: `/goal` command module registration.
 */

import { executeGoalCommand, GOAL_COMMAND_DESCRIPTION } from './goal-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

export function createGoalCommandEntry(): ICommand {
  return {
    name: 'goal',
    displayName: 'Autonomous Goal',
    description: GOAL_COMMAND_DESCRIPTION,
    source: 'goal',
    modelInvocable: false,
  };
}

function createGoalSystemCommand(): ISystemCommand {
  const entry = createGoalCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeGoalCommand,
  };
}

export class GoalCommandSource implements ICommandSource {
  readonly name = 'goal';

  getCommands(): ICommand[] {
    return [createGoalCommandEntry()];
  }
}

export function createGoalCommandModule(): ICommandModule {
  return {
    name: 'agent-command-goal',
    commandSources: [new GoalCommandSource()],
    systemCommands: [createGoalSystemCommand()],
  };
}
