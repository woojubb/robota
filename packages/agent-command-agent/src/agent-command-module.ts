import type {
  IAgentJobHostContext,
  ICommand,
  ICommandHostContext,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import { executeAgentCommand } from './agent-command.js';

function asAgentHostContext(context: ICommandHostContext): IAgentJobHostContext {
  return context as unknown as IAgentJobHostContext;
}

function createAgentSubcommands(): ICommand[] {
  return [
    { name: 'list', description: 'List available agents and active jobs', source: 'agent' },
    { name: 'run', description: 'Start one background agent job', source: 'agent' },
    { name: 'parallel', description: 'Run multiple agents in parallel', source: 'agent' },
    { name: 'wait', description: 'Wait for a background agent group summary', source: 'agent' },
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
    description: [
      'Subagent jobs command.',
      'Natural-language arguments start one background agent job.',
      'When the user explicitly asks to create, run, spawn, delegate to, or use agents/subagents, start the requested agent command immediately and do not ask a follow-up question unless execution is impossible or unsafe.',
      'If the target item is unspecified, include target selection inside the agent prompt instead of delaying execution.',
      'The parallel form starts multiple background agent jobs as a wait_all group and returns a consolidated group summary unless --detach is present.',
      'list, wait, read, send, stop, close, and open manage existing agent jobs.',
    ].join(' '),
    source: 'agent',
    modelInvocable: true,
    argumentHint:
      'PROMPT | AGENT_NAME PROMPT | list | parallel [--wait|--detach] LABEL:"PROMPT" [LABEL=AGENT_NAME:"PROMPT"] | wait GROUP_ID | read AGENT_ID [OFFSET] | send AGENT_ID PROMPT | stop AGENT_ID | close AGENT_ID',
    safety: 'background-agent',
    subcommands: createAgentSubcommands(),
  };
}

export function createAgentSystemCommand(): ISystemCommand {
  const entry = createAgentCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    execute: (context, args) => executeAgentCommand(asAgentHostContext(context), args),
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
