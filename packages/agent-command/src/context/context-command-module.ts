import { executeContextCommand } from './context-command.js';
import { createSystemCommandFromEntry } from '../command-module-utils.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createContextCommandEntry(): ICommand {
  return {
    name: 'context',
    displayName: 'Context References',
    description: 'Context window info, reference inventory, and auto-compact controls',
    // Model-invocable for the read-only views only: knowing how full the context is lets the model
    // decide when to compact. Pinning, unpinning and clearing references and the auto-compact
    // policy are the user's curation and preference, so they stay user-only.
    modelDescription:
      'Inspect the context window. Use it before a large task or before deciding to compact, or to ' +
      'see which files the user pinned into context. Bare returns used/max tokens and percentage, ' +
      'the auto-compact threshold, the pinned-reference summary and the turn count; `list` returns ' +
      'the per-category token breakdown and every pinned reference.',
    source: 'context',
    modelInvocable: true,
    userInvocable: true,
    argumentHint: 'list | add <path> | remove <path> | clear | auto ...',
    subcommands: [
      {
        name: 'list',
        description: 'List loaded context references',
        source: 'context',
        modelInvocable: true,
      },
      {
        name: 'add',
        description: 'Add a file to active context references',
        source: 'context',
        modelInvocable: false,
      },
      {
        name: 'remove',
        description: 'Remove a context reference',
        source: 'context',
        modelInvocable: false,
      },
      {
        name: 'clear',
        description: 'Clear context references',
        source: 'context',
        modelInvocable: false,
      },
      {
        name: 'auto',
        description: 'Inspect or change auto-compact policy',
        source: 'context',
        modelInvocable: false,
      },
    ],
  };
}

function createContextSystemCommand(): ISystemCommand {
  const entry = createContextCommandEntry();
  return createSystemCommandFromEntry(entry, {
    requiresPermission: false,
    lifecycle: 'inline',
    execute: executeContextCommand,
  });
}

export class ContextCommandSource implements ICommandSource {
  readonly name = 'context';

  getCommands(): ICommand[] {
    return [createContextCommandEntry()];
  }
}

export function createContextCommandModule(): ICommandModule {
  return {
    name: 'agent-command-context',
    commandSources: [new ContextCommandSource()],
    systemCommands: [createContextSystemCommand()],
  };
}
