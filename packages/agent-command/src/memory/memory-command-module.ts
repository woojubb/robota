import {
  MEMORY_COMMAND_ARGUMENT_HINT,
  MEMORY_COMMAND_DESCRIPTION,
  buildMemoryCommandSubcommands,
} from '@robota-sdk/agent-framework';

import { executeMemoryCommand } from './memory-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

/**
 * Model-invocable: remembering and recalling project conventions is the model's own work. The
 * subcommand flags (in `buildMemoryCommandSubcommands`) keep `approve`/`reject` user-only, because
 * pending candidates exist so the user reviews what the model proposed to remember.
 */
const MEMORY_COMMAND_MODEL_DESCRIPTION =
  'Read and write this project’s durable memory. Use `list` or `show [topic]` to look up stored ' +
  'conventions, preferences or references before asking the user again; `add <type> <topic> <text>` ' +
  'to save a durable preference, project convention, feedback item or reference worth reusing ' +
  'across sessions (never secrets, credentials or transient facts); `pending` to see candidates ' +
  'awaiting the user’s review; `used` to report which memory items informed this turn. Bare lists ' +
  'topics. Returns the requested topics or entries, or a confirmation of what was saved. Approving ' +
  'or rejecting a pending candidate is the user’s review: suggest `/memory approve <id>` or ' +
  '`/memory reject <id>`.';

export function createMemoryCommandEntry(): ICommand {
  return {
    name: 'memory',
    displayName: 'Memory',
    description: MEMORY_COMMAND_DESCRIPTION,
    modelDescription: MEMORY_COMMAND_MODEL_DESCRIPTION,
    source: 'memory',
    argumentHint: MEMORY_COMMAND_ARGUMENT_HINT,
    modelInvocable: true,
    safety: 'write',
    subcommands: buildMemoryCommandSubcommands(),
  };
}

function createMemorySystemCommand(): ISystemCommand {
  const entry = createMemoryCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    ...(entry.modelDescription !== undefined ? { modelDescription: entry.modelDescription } : {}),
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: true,
    argumentHint: entry.argumentHint,
    safety: entry.safety,
    subcommands: entry.subcommands,
    execute: executeMemoryCommand,
  };
}

export class MemoryCommandSource implements ICommandSource {
  readonly name = 'memory';

  getCommands(): ICommand[] {
    return [createMemoryCommandEntry()];
  }
}

export function createMemoryCommandModule(): ICommandModule {
  return {
    name: 'agent-command-memory',
    commandSources: [new MemoryCommandSource()],
    systemCommands: [createMemorySystemCommand()],
  };
}
