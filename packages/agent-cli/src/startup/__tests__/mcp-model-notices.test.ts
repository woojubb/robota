/**
 * When an MCP server cannot serve the model for a reason the USER can fix — approval, workspace
 * trust or sign-in — the model is told which server and which command to suggest, in fixed words.
 * Nothing the server or its definition sent reaches that text.
 */

import {
  InMemoryMCPActivationApprovalStore,
  MCPDefinitionRegistry,
  MCPSupervisorError,
} from '@robota-sdk/agent-mcp';
import { mcpUserActionNotice } from '@robota-sdk/agent-command';
import { describe, expect, it } from 'vitest';

import { createMcpClientComposition } from '../mcp-client-composition.js';
import { mcpStartupModelNotice, mcpUserActionSurfaceFor } from '../mcp-startup.js';
import { withAppendedSystemPrompt } from '../preset-surface-options.js';

import type {
  IMCPDiscovery,
  IMCPResolvedEntry,
  IMCPServerDefinitionResolved,
} from '@robota-sdk/agent-mcp';
import type { IMcpServerConnection } from '../mcp-client-composition.js';
import type { IPresetSurfaceOptions } from '../preset-surface-options.js';

function definition(
  name: string,
  overrides: Partial<IMCPServerDefinitionResolved> = {},
): IMCPServerDefinitionResolved {
  return {
    name,
    source: 'user',
    origin: '~/.robota/settings.json',
    transport: 'http',
    url: `https://mcp.example.com/${name}`,
    unsetVariables: [],
    ...overrides,
  };
}

function entry(
  name: string,
  overrides: Partial<IMCPServerDefinitionResolved> = {},
): IMCPResolvedEntry {
  return {
    name,
    source: 'user',
    origin: '~/.robota/settings.json',
    status: 'resolved',
    definition: definition(name, overrides),
    shadowed: [],
  };
}

function approve(entries: readonly IMCPResolvedEntry[], names: readonly string[]) {
  const store = new InMemoryMCPActivationApprovalStore();
  for (const request of new MCPDefinitionRegistry(entries).list()) {
    if (!names.includes(request.serverId)) continue;
    store.put({
      serverId: request.serverId,
      source: request.source,
      provenance: request.provenance,
      definitionFingerprint: request.definitionFingerprint,
      securityIdentity: request.securityIdentity,
      approvalAuthority: 'user',
      decision: 'approved',
      decidedAt: new Date(0).toISOString(),
    });
  }
  return store;
}

function discovery(serverId: string): IMCPDiscovery {
  return {
    identity: { serverId, serverName: serverId, serverVersion: '1', protocolVersion: '2025-06-18' },
    tools: {
      state: { kind: 'supported', count: 1, listChanged: false },
      items: [
        { name: 'read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
      ],
      pages: 1,
    },
    prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
  };
}

const oauthHost = {
  authenticatorFor: () => ({
    authorize: async () => ({}),
    onRejected: async () => 'fail' as const,
    close: () => undefined,
  }),
};

describe('MCP servers the user must act on, as the model learns of them', () => {
  it('names a pending server and an OAuth server that refused discovery, with the command to run', async () => {
    const entries = [entry('linear'), entry('github', { oauth: {} })];
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approve(entries, ['github']),
      oauth: oauthHost,
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: (): IMcpServerConnection => ({
        discover: async () => {
          throw new MCPSupervisorError('auth', 'www-authenticate: realm="server-secret"');
        },
        callTool: async () => {
          throw new Error('unreachable');
        },
        shutdown: async () => {},
      }),
      reportDiagnostic: () => undefined,
    });

    await composition.connect();

    expect([...composition.unavailableServers]).toEqual([
      ['linear', 'approve'],
      ['github', 'sign-in'],
    ]);
    await composition.shutdown();
  });

  function refusingComposition(userActionSurface?: 'session' | 'terminal') {
    const entries = [entry('github', { oauth: {} })];
    return createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approve(entries, ['github']),
      oauth: oauthHost,
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: (): IMcpServerConnection => ({
        discover: async () => discovery('github'),
        callTool: async () => {
          throw new MCPSupervisorError('auth', 'token=server-secret');
        },
        shutdown: async () => {},
      }),
      reportDiagnostic: () => undefined,
      ...(userActionSurface === undefined ? {} : { userActionSurface }),
    });
  }

  it('tells the model to suggest signing in when a connected OAuth server refuses a call', async () => {
    const composition = refusingComposition();

    const [tool] = await composition.connect();
    const result = await tool!.execute({}, { toolName: tool!.getName(), parameters: {} });

    expect(result).toEqual({ success: false, error: mcpUserActionNotice('github', 'sign-in') });
    expect(JSON.stringify(result)).toContain('`/mcp login github`');
    expect(JSON.stringify(result)).not.toContain('server-secret');
    await composition.shutdown();
  });

  it('names the terminal sign-in command where no /mcp command can be typed', async () => {
    const composition = refusingComposition(mcpUserActionSurfaceFor('print'));
    // The model's `/mcp status` reads the same surface from the command port.
    expect(composition.activationAdapter.userActionSurface).toBe('terminal');

    const [tool] = await composition.connect();
    const result = await tool!.execute({}, { toolName: tool!.getName(), parameters: {} });

    expect(JSON.stringify(result)).toContain('`robota mcp login github` in a terminal');
    expect(JSON.stringify(result)).not.toContain('/mcp login');
    await composition.shutdown();
  });

  it('picks the sign-in surface by mode', () => {
    expect(mcpUserActionSurfaceFor('interactive')).toBe('session');
    expect(mcpUserActionSurfaceFor('print')).toBe('terminal');
    expect(mcpUserActionSurfaceFor('serve')).toBe('terminal');
  });

  it('gives the startup notice only where the user can type the command it suggests', () => {
    const unavailable = new Map([['linear', 'approve' as const]]);
    expect(mcpStartupModelNotice('interactive', unavailable)).toContain('`/mcp approve linear`');
    expect(mcpStartupModelNotice('print', unavailable)).toBeUndefined();
    expect(mcpStartupModelNotice('serve', unavailable)).toBeUndefined();
  });

  it('adds the notice to the prompt text every shell receives, after the CLI text', () => {
    const surface: IPresetSurfaceOptions = {
      agentName: 'robota',
      activePresetId: 'default',
      persona: undefined,
      effortResolution: undefined,
    };
    expect(withAppendedSystemPrompt(surface, undefined)).toBe(surface);
    expect(withAppendedSystemPrompt(surface, 'notice').cliAppendSystemPrompt).toBe('notice');
    expect(
      withAppendedSystemPrompt({ ...surface, cliAppendSystemPrompt: 'cli' }, 'notice')
        .cliAppendSystemPrompt,
    ).toBe('cli\n\nnotice');
  });
});
