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
    description:
      'Start, inspect, steer, stop, and close subagent jobs. Use this when the user explicitly asks to create, spawn, delegate to, run, or manage agents. To run an agent, pass the natural-language task directly as args; Robota starts agent jobs in the background by default. If the user asks to choose one backlog, task, or item, include that target-selection instruction in the agent prompt instead of delaying execution. For parallel roles, use `parallel`, give each agent a self-contained prompt, and ask each agent to return a concise final summary; Robota creates a wait_all background job group for later orchestration. Use `parallel --wait` or `wait GROUP_ID` when the same conversation turn needs the consolidated SDK group summary. For model-routed command execution, call the ExecuteCommand tool in the same assistant turn with command "agent" and args such as `analyze the auth changes with a code-review agent` or `parallel --wait developer=general-purpose:"analyze implementation and return a concise summary" designer=Plan:"analyze architecture and return a concise summary"`; assistant text does not start agent jobs.',
    source: 'agent',
    modelInvocable: true,
    argumentHint:
      'PROMPT | AGENT_NAME PROMPT | list | parallel [--wait] LABEL:"PROMPT" [LABEL=AGENT_NAME:"PROMPT"] | wait GROUP_ID | read AGENT_ID [OFFSET] | send AGENT_ID PROMPT | stop AGENT_ID | close AGENT_ID',
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
