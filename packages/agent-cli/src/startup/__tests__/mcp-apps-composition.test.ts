/**
 * A tool's MCP app view crosses the composition root as display data: the callable names come from
 * the catalog the root built, and a view that cannot be attached is reported by a fixed reason.
 */

import {
  InMemoryMCPActivationApprovalStore,
  MCPDefinitionRegistry,
} from '@robota-sdk/agent-mcp';
import { describe, expect, it } from 'vitest';

import { createMcpClientComposition } from '../mcp-client-composition.js';

import type {
  IMCPDiscoveredTool,
  IMCPDiscovery,
  IMCPResolvedEntry,
  IMCPToolCallResult,
} from '@robota-sdk/agent-mcp';
import type { IMcpServerConnection } from '../mcp-client-composition.js';

const VIEW_URI = 'ui://dash/view';
const SERVER: IMCPResolvedEntry = {
  name: 'dash',
  source: 'user',
  origin: '~/.test-product/settings.json',
  status: 'resolved',
  definition: {
    name: 'dash',
    source: 'user',
    origin: '~/.test-product/settings.json',
    transport: 'http',
    url: 'https://mcp.example.com/dash',
    unsetVariables: [],
  },
  shadowed: [],
};

function approvedStore(): InMemoryMCPActivationApprovalStore {
  const store = new InMemoryMCPActivationApprovalStore();
  for (const request of new MCPDefinitionRegistry([SERVER]).list()) {
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

function tool(name: string, extra: Partial<IMCPDiscoveredTool> = {}): IMCPDiscoveredTool {
  return { name, inputSchema: { type: 'object', properties: {} }, ...extra };
}

function discovery(tools: readonly IMCPDiscoveredTool[]): IMCPDiscovery {
  return {
    identity: {
      serverId: 'dash',
      serverName: 'dash',
      serverVersion: '1',
      protocolVersion: '2025-06-18',
    },
    tools: {
      state: { kind: 'supported', count: tools.length, listChanged: false },
      items: tools,
      pages: 1,
    },
    prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
  };
}

const CALL: IMCPToolCallResult = {
  content: [{ type: 'text', text: 'drawn' }],
  structuredContent: { points: 3 },
  isError: false,
};

function compose(options: {
  tools: readonly IMCPDiscoveredTool[];
  readResource?: IMcpServerConnection['readResource'];
}) {
  const diagnostics: string[] = [];
  const composition = createMcpClientComposition({
    resolvedEntries: [SERVER],
    approvalStore: approvedStore(),
    transport: { lookup: async () => ['93.184.216.34'] },
    createSupervisor: (): IMcpServerConnection => ({
      discover: async () => discovery(options.tools),
      callTool: async () => CALL,
      ...(options.readResource === undefined ? {} : { readResource: options.readResource }),
      shutdown: async () => undefined,
    }),
    reportDiagnostic: (message) => diagnostics.push(message),
  });
  return { composition, diagnostics };
}

async function runShow(options: Parameters<typeof compose>[0]) {
  const { composition, diagnostics } = compose(options);
  const tools = await composition.connect();
  const show = tools.find((candidate) => candidate.getName() === 'dash__show');
  if (show === undefined) throw new Error('Expected the show tool to be offered');
  const result = await show.execute({}, { toolName: 'dash__show', parameters: {} });
  await composition.shutdown();
  return { result, diagnostics, offered: tools.map((candidate) => candidate.getName()) };
}

const validView = async () => ({
  contents: [{ uri: VIEW_URI, mimeType: 'text/html;profile=mcp-app', text: '<html></html>' }],
});

describe('MCP app views through the composition root', () => {
  it('names the callable tools from the catalog it built, never an app-only one', async () => {
    const { result, offered, diagnostics } = await runShow({
      tools: [
        tool('show', { ui: { resourceUri: VIEW_URI, visibility: ['model', 'app'] } }),
        tool('helper'),
        tool('refresh', { ui: { visibility: ['app'] } }),
        tool('model-only', { ui: { resourceUri: 'ui://dash/other', visibility: ['model'] } }),
      ],
      readResource: validView,
    });
    expect(result.view).toMatchObject({
      sourceId: 'dash',
      resourceUri: VIEW_URI,
      callableTools: { show: 'dash__show', helper: 'dash__helper' },
    });
    expect(offered).toEqual(['dash__show', 'dash__helper', 'dash__model-only']);
    expect(diagnostics).toContain(
      'MCP tool "dash__refresh" on "dash" was rejected: app-only tool; this host offers tools to the model only',
    );
  });

  it('reports an omitted view by server, tool and a fixed reason, and keeps the text result', async () => {
    const { result, diagnostics } = await runShow({
      tools: [tool('show', { ui: { resourceUri: VIEW_URI, visibility: ['model', 'app'] } })],
      readResource: async () => {
        throw new Error('token=server-secret');
      },
    });
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('view');
    expect(diagnostics).toEqual(['MCP server "dash" tool "show" app view omitted: read-failed']);
    expect(diagnostics.join('\n')).not.toContain('server-secret');
  });

  it('reports malformed UI metadata once and still offers the tool', async () => {
    const { offered, diagnostics } = await runShow({
      tools: [tool('show'), tool('broken', { uiProblem: 'invalid-uri' })],
    });
    expect(offered).toEqual(['dash__show', 'dash__broken']);
    expect(diagnostics).toEqual(['MCP tool "dash__broken" UI metadata ignored (invalid-uri)']);
  });

  it('attaches nothing, and reads nothing, for a tool that declared no view', async () => {
    let reads = 0;
    const { result, diagnostics } = await runShow({
      tools: [tool('show')],
      readResource: async () => {
        reads += 1;
        return validView();
      },
    });
    expect(result).not.toHaveProperty('view');
    expect(reads).toBe(0);
    expect(diagnostics).toEqual([]);
  });
});
