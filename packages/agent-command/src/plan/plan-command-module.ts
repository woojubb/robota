/**
 * SELFHOST-002: `/plan` command module registration.
 */

import { executePlanCommand, PLAN_COMMAND_DESCRIPTION } from './plan-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

export function createPlanCommandEntry(): ICommand {
  return {
    name: 'plan',
    displayName: 'Plan Mode',
    description: PLAN_COMMAND_DESCRIPTION,
    source: 'plan',
    modelInvocable: false,
  };
}

function createPlanSystemCommand(): ISystemCommand {
  const entry = createPlanCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executePlanCommand,
  };
}

export class PlanCommandSource implements ICommandSource {
  readonly name = 'plan';

  getCommands(): ICommand[] {
    return [createPlanCommandEntry()];
  }
}

export function createPlanCommandModule(): ICommandModule {
  return {
    name: 'agent-command-plan',
    commandSources: [new PlanCommandSource()],
    systemCommands: [createPlanSystemCommand()],
  };
}
