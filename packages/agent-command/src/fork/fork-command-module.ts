import { executeForkCommand } from './fork-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createForkCommandEntry(): ICommand {
  return {
    name: 'fork',
    displayName: 'Fork Session',
    description:
      'Copy this conversation into a new background session and keep working here. ' +
      'The fork inherits the whole conversation and the assembled system prompt; it is a copy, ' +
      'so nothing it does reaches this session and it never merges back.',
    source: 'fork',
    // The model does not decide to duplicate the operator's conversation. Forking spends a second
    // session's budget and creates a second worktree, both of which are the operator's call.
    modelInvocable: false,
    argumentHint: '[name] [--same-dir]',
  };
}

function createForkSystemCommand(): ISystemCommand {
  const entry = createForkCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    ...(entry.argumentHint !== undefined ? { argumentHint: entry.argumentHint } : {}),
    // `ICommandHostContext` aggregates both role ports `/fork` declares, so the narrowing is the
    // parameter's own type — no assertion, and a role the command stops satisfying is a build error.
    execute: (context, args) => executeForkCommand(context, args),
  };
}

export class ForkCommandSource implements ICommandSource {
  readonly name = 'fork';

  getCommands(): ICommand[] {
    return [createForkCommandEntry()];
  }
}

export function createForkCommandModule(): ICommandModule {
  return {
    name: 'agent-command-fork',
    commandSources: [new ForkCommandSource()],
    systemCommands: [createForkSystemCommand()],
    // A fork is a background agent job resuming a session record; a host with no agent runtime has
    // neither half, so the command is not offered rather than offered and refused.
    sessionRequirements: ['agent-runtime'],
  };
}
