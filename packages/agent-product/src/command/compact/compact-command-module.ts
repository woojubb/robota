import { executeCompactCommand } from './compact-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createCompactCommandEntry(): ICommand {
  return {
    name: 'compact',
    displayName: 'Compact Context',
    description: 'Compress context window',
    // Model-invocable: compaction only summarizes the model's own context, and the model is the one
    // that notices when it is running out of room.
    modelDescription:
      'Summarize older conversation turns to free context-window space. Use it when the context is ' +
      'nearly full (check with the context command) or before starting a large new task; optional ' +
      'instructions say what the summary must keep. Returns how many messages were removed and the ' +
      'context usage before and after.',
    source: 'compact',
    modelInvocable: true,
    argumentHint: '[instructions]',
    safety: 'write',
    example: '/compact Summarize the current context',
  };
}

function createCompactSystemCommand(): ISystemCommand {
  const entry = createCompactCommandEntry();
  return {
    name: entry.name,
    semanticRole: 'contextReduction',
    displayName: entry.displayName,
    description: entry.description,
    ...(entry.modelDescription !== undefined ? { modelDescription: entry.modelDescription } : {}),
    example: entry.example,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: entry.modelInvocable,
    argumentHint: entry.argumentHint,
    safety: entry.safety,
    lifecycle: 'blocking',
    execute: executeCompactCommand,
  };
}

export class CompactCommandSource implements ICommandSource {
  readonly name = 'compact';

  getCommands(): ICommand[] {
    return [createCompactCommandEntry()];
  }
}

export function createCompactCommandModule(): ICommandModule {
  return {
    name: 'agent-command-compact',
    commandSources: [new CompactCommandSource()],
    systemCommands: [createCompactSystemCommand()],
  };
}
