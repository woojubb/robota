import { executeMCPActivationCommand } from './mcp-activation-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createMCPActivationCommandEntry(): ICommand {
  return {
    name: 'mcp',
    displayName: 'MCP activation',
    description: 'Inspect and manage trust approval for MCP server activation',
    argumentHint: '[status|approve|reject|revoke] [serverId]',
    source: 'mcp-activation',
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
