import {
  InMemoryMCPActivationApprovalStore,
  MCPDefinitionRegistry,
  MCPSupervisorError,
} from '@robota-sdk/agent-mcp';
import { describe, expect, it } from 'vitest';

import { createMcpClientComposition } from '../mcp-client-composition.js';

import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type {
  IMCPDiscoveredTool,
  IMCPDiscovery,
  IMCPResolvedEntry,
} from '@robota-sdk/agent-mcp';
import type { IMcpServerConnection } from '../mcp-client-composition.js';

const VIEW_URI = 'ui://registration/view';

function entry(name: string, oauth: boolean): IMCPResolvedEntry {
  return {
    name,
    source: 'user',
    origin: '~/.test-product/settings.json',
    status: 'resolved',
    definition: {
      name,
      source: 'user',
      origin: '~/.test-product/settings.json',
      transport: 'http',
      url: `https://mcp.example.com/${encodeURIComponent(name)}`,
      unsetVariables: [],
      ...(oauth ? { oauth: {} } : {}),
    },
    shadowed: [],
  };
}

function tool(name: string, view = false): IMCPDiscoveredTool {
  return {
    name,
    inputSchema: { type: 'object', properties: {} },
    ...(view ? { ui: { resourceUri: VIEW_URI, visibility: ['model', 'app'] } } : {}),
  };
}

function discovery(serverId: string, tools: readonly IMCPDiscoveredTool[]): IMCPDiscovery {
  return {
    identity: { serverId, serverName: serverId, serverVersion: '1', protocolVersion: '2025-06-18' },
    tools: {
      state: { kind: 'supported', count: tools.length, listChanged: false },
      items: tools,
      pages: 1,
    },
    prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
  };
}

function approvedStore(entries: readonly IMCPResolvedEntry[]) {
  const store = new InMemoryMCPActivationApprovalStore();
  for (const request of new MCPDefinitionRegistry(entries).list()) {
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

function findTool(tools: readonly IToolWithEventService[], name: string): IToolWithEventService {
  const found = tools.find((candidate) => candidate.getName() === name);
  if (found === undefined) throw new Error(`Expected offered tool ${name}`);
  return found;
}

async function invoke(tool: IToolWithEventService) {
  return tool.execute({}, { toolName: tool.getName(), parameters: {} });
}

function collidingComposition(mode: 'reload' | 'oauth') {
  const entries = [entry('my_srv', false), entry('my.srv', mode === 'oauth')];
  const calls: string[] = [];
  const diagnostics: string[] = [];
  let attempts = 0;
  const composition = createMcpClientComposition({
    resolvedEntries: entries,
    approvalStore: approvedStore(entries),
    transport: { lookup: async () => ['93.184.216.34'] },
    ...(mode === 'oauth'
      ? {
          oauth: {
            signIn: async () => undefined,
            authenticatorFor: () => ({
              authorize: async () => ({}),
              onRejected: async () => 'fail' as const,
              close: () => undefined,
            }),
          },
        }
      : {}),
    createSupervisor: (options): IMcpServerConnection => ({
      discover: async () => {
        if (options.serverId === 'my.srv' && ++attempts === 1) {
          throw new MCPSupervisorError(mode === 'oauth' ? 'auth' : 'transient', 'unavailable');
        }
        return discovery(
          options.serverId,
          options.serverId === 'my_srv'
            ? [tool('x', true)]
            : [tool('x'), tool('show', true), tool('__proto__'), tool('constructor')],
        );
      },
      callTool: async (name) => {
        calls.push(`${options.serverId}:${name}`);
        return { content: [{ type: 'text', text: 'ok' }], isError: false };
      },
      readResource: async () => ({
        contents: [{ uri: VIEW_URI, mimeType: 'text/html;profile=mcp-app', text: '<html></html>' }],
      }),
      shutdown: async () => undefined,
    }),
    reportDiagnostic: (message) => diagnostics.push(message),
  });
  return { composition, calls, diagnostics };
}

describe('MCP app callback registration authority', () => {
  it.each(['reload', 'oauth'] as const)(
    'only exposes tools accepted from the exact server after %s registration',
    async (mode) => {
      const { composition, calls } = collidingComposition(mode);
      try {
        const initial = await composition.connect();
        const retained = findTool(initial, 'my_srv__x');
        const retainedBefore = await invoke(retained);
        expect(retainedBefore.view?.callableTools).toEqual({ x: 'my_srv__x' });
        const adapter = composition.activationAdapter;
        const offered = await (async () => {
          if (mode === 'reload') {
            const reload = adapter.reload;
            const acknowledge = adapter.reloadToolsAdded;
            if (reload === undefined || acknowledge === undefined) {
              throw new Error('Expected reload registration');
            }
            const result = await reload();
            const token = result.reloadToken;
            if (token === undefined) throw new Error('Expected a reload token');
            return {
              tools: result.tools,
              acknowledge: (names: readonly string[]) => acknowledge(token, names),
              wrongAcknowledge: () => acknowledge(`${token}-stale`, ['my_srv__show']),
            };
          }
          if (adapter.oauthLogin === undefined || adapter.oauthToolsAdded === undefined) {
            throw new Error('Expected OAuth registration');
          }
          const result = await adapter.oauthLogin({ serverId: 'my.srv', noBrowser: false });
          const acknowledge = adapter.oauthToolsAdded;
          return {
            tools: result.tools,
            acknowledge: (names: readonly string[]) => acknowledge('my.srv', names),
            wrongAcknowledge: () => acknowledge('other-server', ['my_srv__show']),
          };
        })();
        const show = findTool(offered.tools, 'my_srv__show');
        const before = await invoke(show);
        expect.soft(before.view?.callableTools).toEqual({});
        offered.wrongAcknowledge();
        expect.soft((await invoke(show)).view?.callableTools).toEqual({});
        const accepted = offered.tools
          .map((candidate) => candidate.getName())
          .filter((name) => !initial.some((candidate) => candidate.getName() === name));
        offered.acknowledge(accepted);
        const after = await invoke(show);
        const expected = Object.fromEntries([
          ['show', 'my_srv__show'],
          ['__proto__', 'my_srv____proto__'],
          ['constructor', 'my_srv__constructor'],
        ]);
        expect(after.view?.callableTools).toEqual(expected);
        expect(Object.hasOwn(after.view?.callableTools ?? {}, '__proto__')).toBe(true);
        expect(after.view?.callableTools).not.toHaveProperty('x');
        expect.soft(before.view?.callableTools).toEqual({});
        offered.acknowledge(['my_srv__x']);
        offered.wrongAcknowledge();
        expect((await invoke(show)).view?.callableTools).toEqual(expected);
        expect((await invoke(retained)).view?.callableTools).toEqual({ x: 'my_srv__x' });
        expect(composition.connectedToolProvenance.get('my_srv__x')?.serverId).toBe('my_srv');
        expect(calls).toContain('my_srv:x');
        expect(calls).not.toContain('my.srv:x');
      } finally {
        await composition.shutdown();
      }
    },
  );

  it('uses the canonical tool name in omission diagnostics for source names with control characters', async () => {
    const entries = [entry('dash', false)];
    const diagnostics: string[] = [];
    const rawName = 'show\n\u001b[31m';
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedStore(entries),
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: (): IMcpServerConnection => ({
        discover: async () => discovery('dash', [tool(rawName, true)]),
        callTool: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
        readResource: async () => {
          throw new Error('unavailable');
        },
        shutdown: async () => undefined,
      }),
      reportDiagnostic: (message) => diagnostics.push(message),
    });
    try {
      const [offered] = await composition.connect();
      if (offered === undefined) throw new Error('Expected an offered tool');
      expect((await invoke(offered)).success).toBe(true);
      expect(diagnostics).toContain(
        `MCP server "dash" tool "${offered.getName()}" app view omitted: read-failed`,
      );
      expect(diagnostics.join('\n')).not.toContain(rawName);
    } finally {
      await composition.shutdown();
    }
  });
});
