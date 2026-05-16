import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-framework';
import { executeCompactCommand } from './compact-command.js';

export function createCompactCommandEntry(): ICommand {
  return {
    name: 'compact',
    displayName: 'Compact Context',
    description: 'Compress context window',
    source: 'compact',
    modelInvocable: true,
    argumentHint: '[instructions]',
    safety: 'write',
  };
}

function createCompactSystemCommand(): ISystemCommand {
  const entry = createCompactCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
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
