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
    // Model-invocable for `status` only: when an MCP server's tools are missing or failing, the
    // model can see why and name the command the user should run. Approving, rejecting and revoking
    // a server are trust decisions and signing in or out is a credential action, so those stay
    // user-only — the model's `status` view also omits everything but names and states.
    modelDescription:
      'Show which MCP servers are configured and why any of them is unavailable. Use it when an MCP ' +
      'server or its tools are missing, a tool call reports that a server needs sign-in or approval, ' +
      'or the user asks about MCP servers. Returns one line per server: its name, activation state, ' +
      'sign-in state, and the command to suggest to the user when the server needs their approval, ' +
      'sign-in or workspace trust. You cannot approve, sign in or sign out yourself.',
    argumentHint:
      '[status] | <approve|reject|revoke|logout> <server> | login <server> [--no-browser]',
    source: 'mcp-activation',
    modelInvocable: true,
    // The bare `/mcp` shows the status view, so choosing it from a menu runs it.
    runsBare: true,
    subcommands: [
      {
        name: 'status',
        description: 'Show every MCP server’s name, activation state and sign-in state',
        source: 'mcp-activation',
        modelInvocable: true,
      },
      ...(['approve', 'reject', 'revoke', 'login', 'logout'] as const).map((verb) => ({
        name: verb,
        description: USER_ONLY_VERB_DESCRIPTION[verb],
        argumentHint: verb === 'login' ? '<server> [--no-browser]' : '<server>',
        source: 'mcp-activation',
        modelInvocable: false,
      })),
    ],
  };
}

const USER_ONLY_VERB_DESCRIPTION = {
  approve: 'Trust and activate an MCP server',
  reject: 'Refuse an MCP server',
  revoke: 'Withdraw an earlier approval',
  login: 'Sign in to an OAuth MCP server and connect it in this session',
  logout: 'Sign out of an OAuth MCP server and revoke its tokens',
} as const;

function createMCPActivationSystemCommand(): ISystemCommand {
  const entry = createMCPActivationCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    ...(entry.modelDescription !== undefined ? { modelDescription: entry.modelDescription } : {}),
    argumentHint: entry.argumentHint,
    ...(entry.subcommands !== undefined ? { subcommands: entry.subcommands } : {}),
    // Approve/reject/revoke/login/logout change trust or credentials, so the command is never read-only
    // for the user or a remote policy. The model can reach only `status` (its subcommand
    // allowlist), a read-only view, so its call needs no prompt.
    requiresPermission: true,
    modelRequiresPermission: false,
    userInvocable: true,
    modelInvocable: true,
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
