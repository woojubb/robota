import { executeMCPActivationCommand } from './mcp-activation-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createMCPActivationCommandEntry(): ICommand {
  return {
    name: 'mcp',
    displayName: 'MCP activation',
    description:
      "Show each MCP server's trust approval and OAuth sign-in state, or change one server: " +
      'approve, reject or revoke its trust; sign in to it (login, which connects it in this ' +
      'session) or out of it (logout). Use when an MCP server is not approved, needs a sign-in, or ' +
      'should stop being used. Returns the status list, or what the one action did.',
    argumentHint:
      '[status] | <approve|reject|revoke|logout> <server> | login <server> [--no-browser]',
    source: 'mcp-activation',
    // User-only: approve, revoke, login and logout change trust or credentials.
    modelInvocable: false,
  };
}

function createMCPActivationSystemCommand(): ISystemCommand {
  const entry = createMCPActivationCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    argumentHint: entry.argumentHint,
    requiresPermission: true,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeMCPActivationCommand,
  };
}

export class MCPActivationCommandSource implements ICommandSource {
  readonly name = 'mcp-activation';

  getCommands(): ICommand[] {
    return [createMCPActivationCommandEntry()];
  }
}

export function createMCPActivationCommandModule(): ICommandModule {
  return {
    name: 'agent-command-mcp-activation',
    commandSources: [new MCPActivationCommandSource()],
    systemCommands: [createMCPActivationSystemCommand()],
  };
}
