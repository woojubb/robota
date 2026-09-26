import { describe, expect, it, vi } from 'vitest';

import { SystemCommandExecutor } from '@robota-sdk/agent-framework';

import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { createMCPActivationCommandModule } from '../mcp-activation-command-module.js';
import { executeMCPActivationCommand } from '../mcp-activation-command.js';
import {
  mcpUnavailableServersNotice,
  mcpUserActionCommand,
  mcpUserActionNotice,
} from '../mcp-model-notice.js';

import type {
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
} from '@robota-sdk/agent-framework';
import type { TCommandInvocationSource } from '@robota-sdk/agent-interface-command';

function summary(overrides: Partial<ICommandMCPActivationSummary>): ICommandMCPActivationSummary {
  return {
    serverId: 'server-1',
    displayName: 'Example server',
    source: 'project',
    status: 'pending',
    allowed: false,
    reason: 'SECRET-REASON-TEXT from a definition',
    provenanceId: 'project-settings:/home/me/repo/.robota/settings.json',
    definitionFingerprint: 'fingerprint-abc',
    securityIdentity: 'https://user:hunter2@mcp.example.com/?token=abc',
    ...overrides,
  };
}

const adapter: ICommandMCPActivationAdapter = {
  list: () => [
    summary({ serverId: 'github', status: 'approved', allowed: true }),
    summary({ serverId: 'linear', status: 'pending' }),
    summary({ serverId: 'jira', status: 'untrusted' }),
    summary({ serverId: 'evil; rm -rf ~', status: 'stale' }),
    summary({ serverId: 'gone', status: 'rejected' }),
  ],
  sourceProblems: () => [
    { source: 'project', origin: '/home/me/repo/.robota/settings.json', reason: 'not json' },
  ],
  approve: () => {
    throw new Error('not used');
  },
  reject: () => {
    throw new Error('not used');
  },
  revoke: () => {
    throw new Error('not used');
  },
  oauthStatus: async () => [{ serverId: 'github', state: 'sign-in-required' }],
};

function host(source: TCommandInvocationSource) {
  return createTestCommandHost({
    overrides: {
      getCommandHostAdapters: () => ({ mcpActivation: adapter }),
      getCommandInvocationSource: () => source,
    },
  });
}

describe('/mcp status as the model sees it', () => {
  it('names each server, its states, and the command to suggest', async () => {
    const result = await executeMCPActivationCommand(host('model'), 'status');

    expect(result.success).toBe(true);
    expect(result.message).toBe(
      [
        'MCP servers:',
        '  github — approved — sign-in: sign-in-required — ask the user to run `/mcp login github`',
        '  linear — pending — ask the user to run `/mcp approve linear`',
        '  jira — untrusted — ask the user to run `robota trust`',
        '  (name not shown) — stale — ask the user to run `/mcp approve <server>`',
        '  gone — rejected',
        '1 MCP configuration source(s) could not be read; the user can see which with `/mcp status`.',
      ].join('\n'),
    );
  });

  it('names the terminal sign-in command in a run with no session prompt', async () => {
    const terminal = { ...adapter, userActionSurface: 'terminal' as const };
    const result = await executeMCPActivationCommand(
      createTestCommandHost({
        overrides: {
          getCommandHostAdapters: () => ({ mcpActivation: terminal }),
          getCommandInvocationSource: () => 'model',
        },
      }),
      'status',
    );
    expect(result.message).toContain(
      'github — approved — sign-in: sign-in-required — ask the user to run `robota mcp login github`',
    );
    expect(result.message).not.toContain('/mcp login');
    // Approval has no terminal command; it stays the session command.
    expect(result.message).toContain('`/mcp approve linear`');
  });

  it('carries no reason text, source path, fingerprint, identity or unsafe name', async () => {
    const result = await executeMCPActivationCommand(host('model'), '');
    const everything = JSON.stringify(result);

    for (const leaked of [
      'SECRET-REASON-TEXT',
      '/home/me/repo',
      'fingerprint-abc',
      'hunter2',
      'token=abc',
      'mcp.example.com',
      'rm -rf',
      'Example server',
    ]) {
      expect(everything).not.toContain(leaked);
    }
  });

  it('keeps the full view for the user', async () => {
    const result = await executeMCPActivationCommand(host('user'), 'status');
    expect(result.message).toContain('SECRET-REASON-TEXT');
  });

  it('gives a caller that does not say who it is the restricted view', async () => {
    const { getCommandInvocationSource: _unsaid, ...anonymous } = host('user');
    const result = await executeMCPActivationCommand(anonymous, 'status');
    expect(result.message).toContain('`/mcp approve linear`');
    expect(result.message).not.toContain('SECRET-REASON-TEXT');
  });
});

describe('the `/mcp login` the notices suggest', () => {
  it('is a real verb for the user and is refused for the model before it runs', async () => {
    // A user-typed `/mcp login` reaches the sign-in path (here: no host adapter), never "Unknown".
    const userResult = await executeMCPActivationCommand(
      createTestCommandHost({ overrides: { getCommandInvocationSource: () => 'user' } }),
      'login github',
    );
    expect(userResult.message).not.toContain('Unknown argument');
    expect(userResult.message).toContain('not available in this environment');

    const [command] = createMCPActivationCommandModule().systemCommands ?? [];
    expect(command?.subcommands).toContainEqual(
      expect.objectContaining({ name: 'login', modelInvocable: false }),
    );
    const execute = vi.fn();
    const executor = new SystemCommandExecutor([{ ...command!, execute }]);
    const modelResult = await executor.executeModelInvocable(
      'mcp',
      createTestCommandHost(),
      'login github',
    );
    expect(modelResult?.success).toBe(false);
    expect(modelResult?.message).toContain('only the user can');
    expect(execute).not.toHaveBeenCalled();
    expect(mcpUserActionCommand('github', 'sign-in')).toBe('/mcp login github');
  });
});

describe('MCP notices for the model', () => {
  it('names a shell-safe server and the user command', () => {
    expect(mcpUserActionNotice('linear', 'approve')).toBe(
      'MCP server "linear" is waiting for the user’s approval, so its tools are unavailable. You ' +
        'cannot do this yourself; ask the user to run `/mcp approve linear`.',
    );
    expect(mcpUserActionNotice('github', 'sign-in')).toContain('`/mcp login github`');
    expect(mcpUserActionNotice('jira', 'trust-workspace')).toContain(
      '`robota trust` in a terminal, then restart the session',
    );
  });

  it('names the terminal sign-in command where no /mcp command can be typed', () => {
    expect(mcpUserActionNotice('github', 'sign-in', 'terminal')).toBe(
      'MCP server "github" needs the user to sign in, so its tools are unavailable. You cannot do ' +
        'this yourself; ask the user to run `robota mcp login github` in a terminal, then restart ' +
        'the session.',
    );
    expect(mcpUserActionCommand('$(curl evil)', 'sign-in', 'terminal')).toBe(
      'robota mcp login <server>',
    );
    // Only sign-in moves: approval has no terminal command.
    expect(mcpUserActionCommand('linear', 'approve', 'terminal')).toBe('/mcp approve linear');
  });

  it('stays generic for a name that is not safe to show', () => {
    const notice = mcpUserActionNotice('$(curl evil)', 'sign-in');
    expect(notice).not.toContain('curl');
    expect(notice).toContain('`/mcp status` lists it');
    expect(mcpUserActionCommand('$(curl evil)', 'approve')).toBe('/mcp approve <server>');
  });

  it('lists every unavailable server, or says nothing', () => {
    expect(mcpUnavailableServersNotice(new Map())).toBeUndefined();
    const notice = mcpUnavailableServersNotice(
      new Map([
        ['linear', 'approve'],
        ['github', 'sign-in'],
      ]),
    );
    expect(notice?.split('\n')).toEqual([
      'MCP servers that did not start this session. Mention this only when the user needs one of ' +
        'these servers or its tools:',
      `- ${mcpUserActionNotice('linear', 'approve')}`,
      `- ${mcpUserActionNotice('github', 'sign-in')}`,
    ]);
  });
});
