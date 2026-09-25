/**
 * FLOW-005: the `/schedule` + `/monitor` command module — surfaces agent-wake scheduling
 * and process monitoring to users (and the model as tools).
 */

import { executeLoopCommand } from './loop-command.js';
import { executeMonitorCommand, executeScheduleCommand } from './schedule-command.js';

import type { ILoopCommandOptions } from './loop-command.js';
import type {
  IAgentJobHostContext,
  ICommandHostAgentJobs,
  ICommandModule,
  ISystemCommand,
} from '@robota-sdk/agent-framework';
import type { ICommand, ICommandResult, ICommandSource } from '@robota-sdk/agent-interface-command';

function getAgentHostContext(context: ICommandHostAgentJobs): IAgentJobHostContext {
  const cap = context.getAgentJobCapability();
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

// Model-invocable, all three: waking itself later, watching a process and repeating a prompt are the
// model's own pacing. `/monitor` starts a process, so the model's command is decided by the shell
// tool's own gate (see the system command below) — never a way around a Bash/Shell rule.
const SCHEDULE_MODEL_DESCRIPTION =
  'Wake yourself later with an instruction. Use it when work must wait (a deploy, a long build, a ' +
  'reply) instead of polling: `in <N><s|m|h|d> <instruction>` or `cron "<expr>" <instruction>`; ' +
  '`list`, `pause`, `resume` and `edit` manage existing schedules. Returns the schedule id, or the ' +
  'schedule list.';
const MONITOR_MODEL_DESCRIPTION =
  'Run a command in the background and wake yourself when a line of its output matches a pattern. ' +
  'Use it to wait for a server to start, a test to fail or a log line to appear instead of polling. ' +
  'The command is allowed, refused or asked about by the same permission rules as a shell tool ' +
  'call. Returns the monitor task id, or a refusal naming what the user must allow.';
const LOOP_MODEL_DESCRIPTION =
  'Repeat a prompt on a fixed cadence (`<N><s|m|h|d> [prompt]`) or self-paced (bare or prompt ' +
  'only: each iteration chooses its next delay or stops). Use it when the user asks for recurring ' +
  'work in this session. `list` shows active loops; `stop <id>` ends one. Returns the loop id and ' +
  'its next fire time, or the loop list.';

export function createScheduleCommandEntry(): ICommand {
  return {
    name: 'schedule',
    displayName: 'Schedule Wake',
    description: SCHEDULE_DESCRIPTION,
    modelDescription: SCHEDULE_MODEL_DESCRIPTION,
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
    modelDescription: MONITOR_MODEL_DESCRIPTION,
    source: 'schedule',
    argumentHint: MONITOR_ARGUMENT_HINT,
    modelInvocable: true,
  };
}

export function createLoopCommandEntry(): ICommand {
  return {
    name: 'loop',
    displayName: 'Repeat Prompt',
    description:
      'Repeat a prompt on a fixed cadence or let each iteration choose its next delay; list or stop active loops.',
    modelDescription: LOOP_MODEL_DESCRIPTION,
    source: 'schedule',
    argumentHint: '[prompt] | <N><s|m|h|d> [prompt] | <prompt> every <N> <unit> | list | stop <id>',
    modelInvocable: true,
    subcommands: [
      { name: 'list', description: 'List active loops', source: 'schedule' },
      {
        name: 'stop',
        description: 'Stop an active loop',
        source: 'schedule',
        argumentHint: '<id>',
      },
    ],
  };
}

function createScheduleSystemCommand(): ISystemCommand {
  const entry = createScheduleCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    ...(entry.modelDescription !== undefined ? { modelDescription: entry.modelDescription } : {}),
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
    ...(entry.modelDescription !== undefined ? { modelDescription: entry.modelDescription } : {}),
    // It starts a process, so it is never treated as read-only (a remote read-only policy refuses
    // it). The MODEL's call is not asked about by the command's name: the host decides the
    // monitored command as a shell tool call (hooks, Bash/Shell rules, the mode and the prompt, never
    // the sandbox's auto-approval), so one "always allow" of `/monitor` never approves another command.
    requiresPermission: true,
    modelRequiresPermission: false,
    userInvocable: true,
    modelInvocable: true,
    argumentHint: entry.argumentHint,
    lifecycle: 'inline',
    execute: (context, args): Promise<ICommandResult> =>
      executeMonitorCommand(getAgentHostContext(context), args),
  };
}

function createLoopSystemCommand(options: ILoopCommandOptions): ISystemCommand {
  const entry = createLoopCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    ...(entry.modelDescription !== undefined ? { modelDescription: entry.modelDescription } : {}),
    // A static conservative classification keeps remote read-only policies from admitting
    // create/stop through this mixed read/write command; list is gated too.
    requiresPermission: true,
    userInvocable: true,
    modelInvocable: true,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    lifecycle: 'inline',
    execute: (context, args): Promise<ICommandResult> =>
      executeLoopCommand(
        getAgentHostContext(context),
        (taskId, reason) => context.cancelBackgroundTask(taskId, reason),
        args,
        options,
      ),
  };
}

export class ScheduleCommandSource implements ICommandSource {
  readonly name = 'schedule';

  getCommands(): ICommand[] {
    return [createScheduleCommandEntry(), createMonitorCommandEntry(), createLoopCommandEntry()];
  }
}

export function createScheduleCommandModule(options: ILoopCommandOptions = {}): ICommandModule {
  return {
    name: 'agent-command-schedule',
    commandSources: [new ScheduleCommandSource()],
    systemCommands: [
      createScheduleSystemCommand(),
      createMonitorSystemCommand(),
      createLoopSystemCommand(options),
    ],
    sessionRequirements: ['agent-runtime'],
  };
}
