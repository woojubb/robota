/**
 * FLOW-005: the `/schedule` + `/monitor` command module — surfaces agent-wake scheduling
 * and process monitoring to users (and the model as tools).
 */

import { executeMonitorCommand, executeScheduleCommand } from './schedule-command.js';

import type {
  IAgentJobHostContext,
  ICommandHostContext,
  ICommandModule,
  ISystemCommand,
} from '@robota-sdk/agent-framework';
import type {
  ICommand,
  ICommandResult,
  ICommandSource,
} from '@robota-sdk/agent-interface-transport';

function getAgentHostContext(context: ICommandHostContext): IAgentJobHostContext {
  const cap = context.getAgentJobCapability?.();
  if (!cap) throw new Error('Scheduling requires an active agent runtime.');
  return cap;
}

const SCHEDULE_DESCRIPTION =
  'Schedule the agent to wake on a timer, and manage schedules (list / pause / resume / edit).';
const SCHEDULE_ARGUMENT_HINT =
  'in <N><s|m|h|d> <instruction> | cron "<expr>" <instruction> | list | pause <id> | resume <id> | edit <id> <spec>';
const MONITOR_DESCRIPTION =
  'Watch a process’s output and wake the agent when a line matches a pattern.';
const MONITOR_ARGUMENT_HINT = '"<command>" "<pattern>" <instruction>';

export function createScheduleCommandEntry(): ICommand {
  return {
    name: 'schedule',
    displayName: 'Schedule Wake',
    description: SCHEDULE_DESCRIPTION,
    source: 'schedule',
    argumentHint: SCHEDULE_ARGUMENT_HINT,
    modelInvocable: true,
  };
}

export function createMonitorCommandEntry(): ICommand {
  return {
    name: 'monitor',
    displayName: 'Monitor Process',
    description: MONITOR_DESCRIPTION,
    source: 'schedule',
    argumentHint: MONITOR_ARGUMENT_HINT,
    modelInvocable: true,
  };
}

function createScheduleSystemCommand(): ISystemCommand {
  const entry = createScheduleCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: true,
    argumentHint: entry.argumentHint,
    lifecycle: 'inline',
    execute: (context, args): Promise<ICommandResult> =>
      executeScheduleCommand(getAgentHostContext(context), args),
  };
}

function createMonitorSystemCommand(): ISystemCommand {
  const entry = createMonitorCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: true,
    argumentHint: entry.argumentHint,
    lifecycle: 'inline',
    execute: (context, args): Promise<ICommandResult> =>
      executeMonitorCommand(getAgentHostContext(context), args),
  };
}

export class ScheduleCommandSource implements ICommandSource {
  readonly name = 'schedule';

  getCommands(): ICommand[] {
    return [createScheduleCommandEntry(), createMonitorCommandEntry()];
  }
}

export function createScheduleCommandModule(): ICommandModule {
  return {
    name: 'agent-command-schedule',
    commandSources: [new ScheduleCommandSource()],
    systemCommands: [createScheduleSystemCommand(), createMonitorSystemCommand()],
    sessionRequirements: ['agent-runtime'],
  };
}
