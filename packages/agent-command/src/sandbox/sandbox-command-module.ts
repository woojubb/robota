import { executeSandboxCommand, SANDBOX_MODES } from './sandbox-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

const DESCRIPTION = 'Show or change how shell commands are confined';
const ARGUMENT_HINT = SANDBOX_MODES.map((entry) => entry.mode).join(' | ');

export function createSandboxCommandEntry(): ICommand {
  return {
    name: 'sandbox',
    displayName: 'Sandbox',
    description: DESCRIPTION,
    source: 'sandbox',
    argumentHint: ARGUMENT_HINT,
    subcommands: SANDBOX_MODES.map(({ mode, description }) => ({
      name: mode,
      description,
      source: 'sandbox',
    })),
    modelInvocable: false,
  };
}

function createSandboxSystemCommand(): ISystemCommand {
  const entry = createSandboxCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    lifecycle: 'inline',
    execute: executeSandboxCommand,
  };
}

export class SandboxCommandSource implements ICommandSource {
  readonly name = 'sandbox';

  getCommands(): ICommand[] {
    return [createSandboxCommandEntry()];
  }
}

export function createSandboxCommandModule(): ICommandModule {
  return {
    name: 'agent-command-sandbox',
    commandSources: [new SandboxCommandSource()],
    systemCommands: [createSandboxSystemCommand()],
  };
}
