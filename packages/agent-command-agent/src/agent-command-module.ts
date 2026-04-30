import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import { executeAgentCommand } from './agent-command.js';

function createAgentSubcommands(): ICommand[] {
  return [
    { name: 'list', description: 'List available agents and active jobs', source: 'agent' },
    { name: 'run', description: 'Run one agent foreground or background', source: 'agent' },
    { name: 'parallel', description: 'Run multiple agents in parallel', source: 'agent' },
    { name: 'read', description: 'Read an agent job log page', source: 'agent' },
    { name: 'send', description: 'Send follow-up input to an agent job', source: 'agent' },
    { name: 'stop', description: 'Cancel a running agent job', source: 'agent' },
    { name: 'close', description: 'Dismiss a terminal agent job', source: 'agent' },
    { name: 'open', description: 'Focus an agent job detail view when supported', source: 'agent' },
  ];
}

export function createAgentCommandEntry(): ICommand {
  return {
    name: 'agent',
    description:
      'Start, inspect, steer, stop, and close subagent jobs. Use this when the user explicitly asks to create, spawn, delegate to, run, or manage agents, especially for parallel or background work.',
    source: 'agent',
    modelInvocable: true,
    argumentHint:
      'list | run <agent> [--background] <prompt> | parallel <label>=<agent>:"<prompt>" --background',
    safety: 'background-agent',
    subcommands: createAgentSubcommands(),
  };
}

export function createAgentSystemCommand(): ISystemCommand {
  const entry = createAgentCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    execute: executeAgentCommand,
    ...(entry.modelInvocable !== undefined ? { modelInvocable: entry.modelInvocable } : {}),
    ...(entry.userInvocable !== undefined ? { userInvocable: entry.userInvocable } : {}),
    ...(entry.argumentHint !== undefined ? { argumentHint: entry.argumentHint } : {}),
    ...(entry.safety !== undefined ? { safety: entry.safety } : {}),
  };
}

export class AgentCommandSource implements ICommandSource {
  readonly name = 'agent';

  getCommands(): ICommand[] {
    return [createAgentCommandEntry()];
  }
}

export function createAgentCommandModule(): ICommandModule {
  return {
    name: 'agent-command-agent',
    commandSources: [new AgentCommandSource()],
    systemCommands: [createAgentSystemCommand()],
    sessionRequirements: ['agent-runtime'],
  };
}
