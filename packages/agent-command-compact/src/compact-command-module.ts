import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import { executeCompactCommand } from './compact-command.js';

export function createCompactCommandEntry(): ICommand {
  return {
    name: 'compact',
    description: 'Compress context window',
    source: 'compact',
    modelInvocable: false,
    argumentHint: '[instructions]',
  };
}

function createCompactSystemCommand(): ISystemCommand {
  const entry = createCompactCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
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
