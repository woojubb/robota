/**
 * MCP-002 (TC-21) — agent-cli COMPOSES `@robota-sdk/agent-mcp`'s manager; it owns no protocol,
 * catalog, retry or trust-policy logic of its own. Three properties prove that boundary:
 *
 * 1. A resolved, admitted HTTP definition's discovered tool reaches the generic dynamic-tool path
 *    under its canonical `<server>__<tool>` name — the composition wires the manager through, it
 *    does not rename or reshape anything the catalog already decided.
 * 2. An admission refusal is surfaced as a diagnostic (never swallowed) and no connection is even
 *    attempted — proven by a `fetch` stub the transport would have to call and never does.
 * 3. A static import-graph check, in the same spirit as `agent-mcp`'s own
 *    `definition-no-side-effects.test.ts`: nothing under `packages/agent-cli/src` imports the MCP
 *    SDK directly. The product depends on the manager's PUBLIC surface only.
 */

import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  InMemoryMCPActivationApprovalStore,
  MCPDefinitionRegistry,
} from '@robota-sdk/agent-mcp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildMcpClientTimeouts, createMcpClientComposition } from '../mcp-client-composition.js';

import type {
  IMCPConnectionSupervisorOptions,
  IMCPDiscovery,
  IMCPResolvedEntry,
  IMCPServerDefinitionResolved,
} from '@robota-sdk/agent-mcp';
import type { IMcpServerConnection } from '../mcp-client-composition.js';

function definition(
  overrides: Partial<IMCPServerDefinitionResolved> = {},
): IMCPServerDefinitionResolved {
  return {
    name: 'weather',
    source: 'user',
    origin: '~/.test-product/settings.json',
    transport: 'http',
    url: 'https://mcp.example.com/weather',
    unsetVariables: [],
    ...overrides,
  };
}

function resolvedEntry(overrides: Partial<IMCPResolvedEntry> = {}): IMCPResolvedEntry {
  return {
    name: 'weather',
    source: 'user',
    origin: '~/.test-product/settings.json',
    status: 'resolved',
    definition: definition(),
    shadowed: [],
    ...overrides,
  };
}

/** Approves the one server so `admission.admit` returns `allowed: true` inside the module. */
function approvedApprovalStore(entries: readonly IMCPResolvedEntry[]) {
  const store = new InMemoryMCPActivationApprovalStore();
  const registry = new MCPDefinitionRegistry(entries);
  for (const request of registry.list()) {
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

function discoveryWithOneTool(): IMCPDiscovery {
  return {
    identity: {
      serverId: 'weather',
      serverName: 'weather-server',
      serverVersion: '1.0.0',
      protocolVersion: '2025-06-18',
    },
    tools: {
      state: { kind: 'supported', count: 1, listChanged: false },
      items: [
        {
          name: 'forecast',
          description: 'Get a forecast',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      pages: 1,
    },
    prompts: { state: { kind: 'unsupported' }, items: [], pages: 0 },
    resources: { state: { kind: 'unsupported' }, items: [], pages: 0 },
  };
}

function fakeConnection(discovery: IMCPDiscovery): {
  connection: IMcpServerConnection;
  calls: { name: string; args: Readonly<Record<string, unknown>> }[];
} {
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  return {
    calls,
    connection: {
      discover: async () => discovery,
      callTool: async (name: string, args: Readonly<Record<string, unknown>>) => {
        calls.push({ name, args });
        return { content: [{ type: 'text', text: 'sunny' }], isError: false };
      },
      shutdown: async () => {},
    },
  };
}

function diagnosticsSink() {
  const messages: string[] = [];
  return { messages, reportDiagnostic: (message: string) => messages.push(message) };
}

describe('createMcpClientComposition', () => {
  it.each(['sse', 'ws'] as const)(
    'reports unsupported %s transport at startup and reload',
    async (transport) => {
      const entries = [resolvedEntry({ definition: definition({ transport }) })];
      const diagnostics = diagnosticsSink();
      const createSupervisor = vi.fn();
      const composition = createMcpClientComposition({
        resolvedEntries: entries,
        approvalStore: approvedApprovalStore(entries),
        createSupervisor,
        reportDiagnostic: diagnostics.reportDiagnostic,
      });
      expect(await composition.connect()).toEqual([]);
      expect(diagnostics.messages.join(' ')).toContain(`unsupported transport: ${transport}`);
      expect(composition.activationAdapter.list()[0]).toMatchObject({
        connection: 'failed',
        connectionFailureReason: expect.stringContaining('unsupported transport'),
      });
      const reload = await composition.activationAdapter.reload!();
      expect(reload.failedServerIds).toEqual(['weather']);
      expect(reload.connectedServerIds).toEqual([]);
      expect(createSupervisor).not.toHaveBeenCalled();
      await composition.shutdown();
    },
  );

  it('offers no external-event subscription, even for a connected server', async () => {
    const entries = [resolvedEntry()];
    const { connection } = fakeConnection(discoveryWithOneTool());
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedApprovalStore(entries),
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => connection,
      reportDiagnostic: () => undefined,
    });
    await composition.connect();
    expect(Object.keys(composition).filter((name) => /external.?event/i.test(name))).toEqual([]);
    await composition.shutdown();
  });

  it('registers a discovered tool through the generic dynamic-tool path under its canonical name', async () => {
    const entries = [resolvedEntry()];
    const approvalStore = approvedApprovalStore(entries);
    const diagnostics = diagnosticsSink();
    const { connection, calls } = fakeConnection(discoveryWithOneTool());
    const fetchStub = async (): Promise<Response> => {
      throw new Error('the fake connection never opens a real transport; fetch must not run');
    };

    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      transport: { fetch: fetchStub, lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => connection,
      reportDiagnostic: diagnostics.reportDiagnostic,
    });

    const tools = await composition.connect();

    expect(tools).toHaveLength(1);
    expect(tools[0]!.getName()).toBe('weather__forecast');

    const result = await tools[0]!.execute({}, { toolName: 'weather__forecast', parameters: {} });
    expect(result.success).toBe(true);
    expect(calls).toEqual([{ name: 'forecast', args: {} }]);
    expect(diagnostics.messages).toEqual([]);

    await composition.shutdown();
  });

  it.each(['reject', 'revoke'] as const)(
    'blocks new calls after %s while preserving the outcome of an already dispatched call',
    async (decision) => {
      const entries = [resolvedEntry()];
      const { connection, calls } = fakeConnection(discoveryWithOneTool());
      let settle!: () => void;
      const pending = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const original = connection.callTool;
      connection.callTool = async (...args) => {
        const result = await original(...args);
        await pending;
        return result;
      };
      const composition = createMcpClientComposition({
        resolvedEntries: entries,
        approvalStore: approvedApprovalStore(entries),
        transport: { lookup: async () => ['93.184.216.34'] },
        createSupervisor: () => connection,
        reportDiagnostic: () => undefined,
      });
      const [tool] = await composition.connect();
      const first = tool!.execute({}, { toolName: tool!.getName(), parameters: {} });
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      await composition.activationAdapter[decision]('weather');
      // Settle first so the unfixed second call cannot leave this test hanging.
      settle();
      expect(await first).toMatchObject({ success: true, data: 'sunny' });
      expect(await tool!.execute({}, { toolName: tool!.getName(), parameters: {} })).toMatchObject({
        success: false,
      });
      expect(calls).toHaveLength(1);
      await composition.shutdown();
    },
  );

  it('refuses a retained tool after its composition shuts down', async () => {
    const entries = [resolvedEntry()];
    const { connection, calls } = fakeConnection(discoveryWithOneTool());
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedApprovalStore(entries),
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => connection,
      reportDiagnostic: () => undefined,
    });
    const [tool] = await composition.connect();
    await composition.shutdown();
    expect(await tool!.execute({}, { toolName: tool!.getName(), parameters: {} })).toMatchObject({
      success: false,
    });
    expect(calls).toHaveLength(0);
  });

  it('spills an oversized MCP result before product observers receive it and cleans up on shutdown', async () => {
    const entries = [resolvedEntry()];
    const diagnostics = diagnosticsSink();
    const raw = `private-output=${'x'.repeat(6_000)}`;
    const write = vi.fn().mockResolvedValue({ reference: 'tool-result:abcdefghijklmnopqrstuv' });
    const read = vi.fn().mockResolvedValue(raw);
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedApprovalStore(entries),
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => ({
        discover: async () => discoveryWithOneTool(),
        callTool: async () => ({ content: [{ type: 'text', text: raw }], isError: false }),
        shutdown: async () => undefined,
      }),
      createResultSpillStore: () => ({ write, read, shutdown }),
      resultAdmissionLimits: {
        warningChars: 100,
        hardChars: 120,
        repositoryMaxChars: 200,
      },
      reportDiagnostic: diagnostics.reportDiagnostic,
    });
    const tools = await composition.connect();
    const result = await tools[0]!.execute({}, { toolName: 'weather__forecast', parameters: {} });
    expect(result).toEqual({ success: true, data: 'tool-result:abcdefghijklmnopqrstuv' });
    expect(write).toHaveBeenCalledExactlyOnceWith(raw);
    const reader = tools.find((tool) => tool.getName() === 'agent_read_mcp_result');
    expect(reader).toBeDefined();
    const retrieved = await reader!.execute(
      {
        reference: 'tool-result:abcdefghijklmnopqrstuv',
        offset: 14,
      },
      { toolName: 'agent_read_mcp_result', parameters: {} },
    );
    expect(retrieved.success).toBe(true);
    const chunk = retrieved.data as { content: string; totalChars: number; nextOffset: number };
    expect(chunk.totalChars).toBe(raw.length);
    expect(chunk.content).toBe(raw.slice(14, chunk.nextOffset));
    expect(chunk.nextOffset).toBeGreaterThan(14);
    expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(120);
    expect(read).toHaveBeenCalledExactlyOnceWith('tool-result:abcdefghijklmnopqrstuv');
    expect(diagnostics.messages.join('\n')).not.toContain(raw);
    await composition.shutdown();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('refuses a reference read when the configured limit cannot advance its offset', async () => {
    const entries = [resolvedEntry()];
    const reference = 'tool-result:abcdefghijklmnopqrstuv';
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedApprovalStore(entries),
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => ({
        discover: async () => discoveryWithOneTool(),
        callTool: async () => ({
          content: [{ type: 'text', text: 'x'.repeat(6_000) }],
          isError: false,
        }),
        shutdown: async () => undefined,
      }),
      createResultSpillStore: () => ({
        write: async () => ({ reference }),
        read: async () => 'x'.repeat(6_000),
        shutdown: async () => undefined,
      }),
      resultAdmissionLimits: { warningChars: 10, hardChars: 47, repositoryMaxChars: 200 },
      reportDiagnostic: vi.fn(),
    });
    const tools = await composition.connect();
    try {
      await tools[0]!.execute({}, { toolName: 'weather__forecast', parameters: {} });
      const reader = tools.find((tool) => tool.getName() === 'agent_read_mcp_result');
      expect(reader).toBeDefined();
      await expect(
        reader!.execute(
          { reference, offset: 0 },
          { toolName: 'agent_read_mcp_result', parameters: {} },
        ),
      ).rejects.toThrow('Tool result read limit too small');
    } finally {
      await composition.shutdown();
    }
  });

  it('records connected-tool provenance (serverId, sourceName, securityIdentity) for MCP-004', async () => {
    const entries = [resolvedEntry()];
    const approvalStore = approvedApprovalStore(entries);
    const diagnostics = diagnosticsSink();
    const { connection } = fakeConnection(discoveryWithOneTool());

    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      transport: {
        fetch: async () => {
          throw new Error('the fake connection never opens a real transport; fetch must not run');
        },
        lookup: async () => ['93.184.216.34'],
      },
      createSupervisor: () => connection,
      reportDiagnostic: diagnostics.reportDiagnostic,
    });

    const tools = await composition.connect();
    const canonicalName = tools[0]!.getName();
    const provenance = composition.connectedToolProvenance.get(canonicalName);

    expect(provenance?.serverId).toBe('weather');
    expect(provenance?.sourceName).toBe('forecast');
    expect(typeof provenance?.securityIdentity).toBe('string');
    expect(provenance?.securityIdentity.length).toBeGreaterThan(0);

    await composition.shutdown();
  });

  it('surfaces an admission refusal as a diagnostic and never attempts a connection', async () => {
    // No approval is recorded — a `user`-source definition with no approval record is `pending`,
    // i.e. `allowed: false`.
    const entries = [resolvedEntry()];
    const diagnostics = diagnosticsSink();
    let fetchCalls = 0;
    const fetchStub = async (): Promise<Response> => {
      fetchCalls += 1;
      throw new Error('admission was refused; the transport must never be reached');
    };
    let supervisorConstructed = false;

    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      transport: { fetch: fetchStub, lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => {
        supervisorConstructed = true;
        throw new Error('unreachable: admission refusal must stop before a supervisor exists');
      },
      reportDiagnostic: diagnostics.reportDiagnostic,
    });

    const tools = await composition.connect();

    expect(tools).toEqual([]);
    expect(fetchCalls).toBe(0);
    expect(supervisorConstructed).toBe(false);
    expect(diagnostics.messages).toHaveLength(1);
    expect(diagnostics.messages[0]).toContain('weather');
    expect(diagnostics.messages[0]).toContain('not admitted');

    await composition.shutdown();
  });
});

describe('MCP Servers section runtime status (#3282 §4 part b-2)', () => {
  it('list() reports a connected server as connected, with its tool names', async () => {
    const entries = [resolvedEntry()];
    const approvalStore = approvedApprovalStore(entries);
    const { connection } = fakeConnection(discoveryWithOneTool());
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => connection,
      reportDiagnostic: () => undefined,
    });

    await composition.connect();
    const summary = composition.activationAdapter.list().find((s) => s.serverId === 'weather');

    expect(summary?.connection).toBe('connected');
    expect(summary?.toolNames).toEqual(['weather__forecast']);
    expect(summary?.connectionFailureReason).toBeUndefined();

    await composition.shutdown();
  });

  it('list() reports a plain failure reason for an admitted server whose discovery fails', async () => {
    const entries = [resolvedEntry()];
    const approvalStore = approvedApprovalStore(entries);
    const failingConnection: IMcpServerConnection = {
      discover: async () => {
        throw new Error('boom');
      },
      callTool: async () => ({ content: [], isError: true }),
      shutdown: async () => {},
    };
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => failingConnection,
      reportDiagnostic: () => undefined,
    });

    await composition.connect();
    const summary = composition.activationAdapter.list().find((s) => s.serverId === 'weather');

    expect(summary?.connection).toBe('failed');
    expect(summary?.connectionFailureReason).toBe('boom');
    expect(summary?.toolNames).toEqual([]);

    await composition.shutdown();
  });

  it('reload() retries only a server not currently connected, leaving a connected one alone', async () => {
    const entries = [
      resolvedEntry({ name: 'weather' }),
      resolvedEntry({
        name: 'flaky',
        definition: definition({ name: 'flaky', url: 'https://mcp.example.com/flaky' }),
      }),
    ];
    const approvalStore = approvedApprovalStore(entries);
    const { connection: weatherConnection } = fakeConnection(discoveryWithOneTool());
    let flakyAttempts = 0;
    const flakyDiscovery: IMCPDiscovery = {
      ...discoveryWithOneTool(),
      tools: {
        state: { kind: 'supported', count: 1, listChanged: false },
        items: [
          {
            name: 'status',
            description: 'Check status',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        pages: 1,
      },
    };
    const flakyConnection: IMcpServerConnection = {
      discover: async () => {
        flakyAttempts += 1;
        if (flakyAttempts === 1) throw new Error('connection refused');
        return flakyDiscovery;
      },
      callTool: async () => ({ content: [], isError: false }),
      shutdown: async () => {},
    };
    let weatherSupervisorCalls = 0;

    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: (options) => {
        if (options.serverId === 'weather') {
          weatherSupervisorCalls += 1;
          return weatherConnection;
        }
        return flakyConnection;
      },
      reportDiagnostic: () => undefined,
    });

    await composition.connect();
    expect(
      composition.activationAdapter.list().find((s) => s.serverId === 'flaky')?.connection,
    ).toBe('failed');
    expect(weatherSupervisorCalls).toBe(1);

    const result = await composition.activationAdapter.reload!();

    expect(result.connectedServerIds).toEqual(['flaky']);
    expect(result.failedServerIds).toEqual([]);
    expect(result.tools.map((tool) => tool.getName())).toEqual(['flaky__status']);
    // The already-connected server was left alone: no second supervisor for it.
    expect(weatherSupervisorCalls).toBe(1);
    const afterReload = composition.activationAdapter.list();
    expect(afterReload.find((s) => s.serverId === 'flaky')?.connection).toBe('connected');
    expect(afterReload.find((s) => s.serverId === 'weather')?.connection).toBe('connected');
    // `reload()` never commits tool provenance itself — nothing in `toolNames` yet, until the
    // session says (via `reloadToolsAdded`) which of the reloaded tools it actually took.
    expect(afterReload.find((s) => s.serverId === 'flaky')?.toolNames).toEqual([]);

    await composition.shutdown();
  });

  it("reload()'s tools reach toolNames only for the names reloadToolsAdded confirms, never a dropped collision", async () => {
    const entries = [
      resolvedEntry({ name: 'weather' }),
      resolvedEntry({
        name: 'flaky',
        definition: definition({ name: 'flaky', url: 'https://mcp.example.com/flaky' }),
      }),
    ];
    const approvalStore = approvedApprovalStore(entries);
    const failingThenTwoTools: IMcpServerConnection = {
      discover: (() => {
        let attempts = 0;
        return async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('connection refused');
          return {
            ...discoveryWithOneTool(),
            tools: {
              state: { kind: 'supported', count: 2, listChanged: false },
              items: [
                {
                  name: 'status',
                  description: 'Check status',
                  inputSchema: { type: 'object', properties: {} },
                },
                {
                  name: 'ping',
                  description: 'Ping',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
              pages: 1,
            },
          };
        };
      })(),
      callTool: async () => ({ content: [], isError: false }),
      shutdown: async () => {},
    };

    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: (options) =>
        options.serverId === 'weather'
          ? fakeConnection(discoveryWithOneTool()).connection
          : failingThenTwoTools,
      reportDiagnostic: () => undefined,
    });

    await composition.connect();
    const result = await composition.activationAdapter.reload!();
    expect(result.tools.map((tool) => tool.getName())).toEqual(['flaky__status', 'flaky__ping']);
    expect(result.reloadToken).toBeDefined();

    // The session took only one of the two (the other collided with a tool it already has).
    composition.activationAdapter.reloadToolsAdded!(result.reloadToken!, ['flaky__status']);

    const toolNames = composition.activationAdapter
      .list()
      .find((s) => s.serverId === 'flaky')?.toolNames;
    expect(toolNames).toEqual(['flaky__status']);
    expect(toolNames).not.toContain('flaky__ping');

    await composition.shutdown();
  });

  it('two overlapping reload() calls join one connection pass and both callers get the same result (#3282 §4 part b-2 review)', async () => {
    const entries = [
      resolvedEntry({ name: 'weather' }),
      resolvedEntry({
        name: 'flaky',
        definition: definition({ name: 'flaky', url: 'https://mcp.example.com/flaky' }),
      }),
    ];
    const approvalStore = approvedApprovalStore(entries);
    let discoverAttempts = 0;
    let releaseDiscover: (() => void) | undefined;
    const gatedDiscovery = new Promise<void>((resolve) => {
      releaseDiscover = resolve;
    });
    const flakyConnection: IMcpServerConnection = {
      discover: async () => {
        discoverAttempts += 1;
        // Attempt 1 (during `connect()`) fails immediately, same as the other tests' "flaky"
        // server. Attempt 2 (the reload's) is held open until the test lets both `reload()` calls
        // race past this point — a second, un-joined call would reach `discovered.has('flaky')`
        // (still false) before the first sets it, and would call `discover` a third time.
        if (discoverAttempts === 1) throw new Error('connection refused');
        await gatedDiscovery;
        return discoveryWithOneTool();
      },
      callTool: async () => ({ content: [], isError: false }),
      shutdown: async () => {},
    };

    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: (options) =>
        options.serverId === 'weather'
          ? fakeConnection(discoveryWithOneTool()).connection
          : flakyConnection,
      reportDiagnostic: () => undefined,
    });

    await composition.connect();
    expect(
      composition.activationAdapter.list().find((s) => s.serverId === 'flaky')?.connection,
    ).toBe('failed');

    const first = composition.activationAdapter.reload!();
    const second = composition.activationAdapter.reload!();
    releaseDiscover!();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    // Exactly one reload connection attempt for both callers (plus the one from `connect()`), not two.
    expect(discoverAttempts).toBe(2);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult.reloadToken).toBeDefined();
    expect(firstResult.tools.map((tool) => tool.getName())).toEqual(['flaky__forecast']);

    // Every tool the joined callers saw ends up in provenance once acknowledged with the shared token.
    composition.activationAdapter.reloadToolsAdded!(firstResult.reloadToken!, ['flaky__forecast']);
    expect(
      composition.activationAdapter.list().find((s) => s.serverId === 'flaky')?.toolNames,
    ).toEqual(['flaky__forecast']);

    await composition.shutdown();
  });

  it("a late reloadToolsAdded from a reload() that a later call already superseded doesn't clear the later one's provenance (#3282 §4 part b-2 review)", async () => {
    // Two servers, each fixed on a different reload: A on the first call, B only on the second.
    function flakyServer(name: string, succeedsFromAttempt: number): IMcpServerConnection {
      let attempts = 0;
      return {
        discover: async () => {
          attempts += 1;
          if (attempts < succeedsFromAttempt) throw new Error('connection refused');
          return {
            ...discoveryWithOneTool(),
            identity: { ...discoveryWithOneTool().identity, serverId: name },
            tools: {
              state: { kind: 'supported', count: 1, listChanged: false },
              items: [
                {
                  name: 'status',
                  description: 'Check',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
              pages: 1,
            },
          };
        },
        callTool: async () => ({ content: [], isError: false }),
        shutdown: async () => {},
      };
    }
    const entries = [
      resolvedEntry({
        name: 'flakyA',
        definition: definition({ name: 'flakyA', url: 'https://mcp.example.com/flakyA' }),
      }),
      resolvedEntry({
        name: 'flakyB',
        definition: definition({ name: 'flakyB', url: 'https://mcp.example.com/flakyB' }),
      }),
    ];
    const approvalStore = approvedApprovalStore(entries);
    // `connect()` is attempt 1 for both (fails); the first `reload()` is attempt 2 for both — A
    // succeeds there, B still fails; the second `reload()` is attempt 3 for B, which succeeds.
    const flakyAConnection = flakyServer('flakyA', 2);
    const flakyBConnection = flakyServer('flakyB', 3);

    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: (options) =>
        options.serverId === 'flakyA' ? flakyAConnection : flakyBConnection,
      reportDiagnostic: () => undefined,
    });

    await composition.connect();

    // First reload: A connects and stages provenance under token A; B still fails.
    const firstResult = await composition.activationAdapter.reload!();
    expect(firstResult.connectedServerIds).toEqual(['flakyA']);
    expect(firstResult.reloadToken).toBeDefined();
    const tokenA = firstResult.reloadToken!;
    composition.activationAdapter.reloadToolsAdded!(tokenA, ['flakyA__status']);
    expect(
      composition.activationAdapter.list().find((s) => s.serverId === 'flakyA')?.toolNames,
    ).toEqual(['flakyA__status']);

    // Second reload: B connects and stages provenance under its own, later token B.
    const secondResult = await composition.activationAdapter.reload!();
    expect(secondResult.connectedServerIds).toEqual(['flakyB']);
    expect(secondResult.reloadToken).toBeDefined();
    const tokenB = secondResult.reloadToken!;
    expect(tokenB).not.toBe(tokenA);

    // A LATE ack for the superseded token A arrives (e.g. a slow, duplicate command execution) —
    // it must be a no-op: B's still-pending provenance must not be disturbed by it.
    composition.activationAdapter.reloadToolsAdded!(tokenA, ['flakyA__status']);
    expect(
      composition.activationAdapter.list().find((s) => s.serverId === 'flakyB')?.toolNames,
    ).toEqual([]);

    // B's own, correct ack still commits normally afterwards.
    composition.activationAdapter.reloadToolsAdded!(tokenB, ['flakyB__status']);
    expect(
      composition.activationAdapter.list().find((s) => s.serverId === 'flakyB')?.toolNames,
    ).toEqual(['flakyB__status']);

    await composition.shutdown();
  });
});

// --- MCP-004 (TC-18): `toolCallMs` is a fifth, independently-set timeout — `buildMcpClientTimeouts`
// sets it from the resolved `mcp.callTimeoutMs`, and the composition passes the result straight
// through to the supervisor, leaving the other four MCP-002 defaults untouched.

describe('buildMcpClientTimeouts (TC-18)', () => {
  it('sets toolCallMs from callTimeoutMs while the other four keep their MCP-002 defaults', () => {
    const timeouts = buildMcpClientTimeouts(900_000);

    expect(timeouts).toEqual({
      startupMs: 10_000,
      perCallMs: 30_000,
      globalDefaultMs: 60_000,
      idleMs: 300_000,
      toolCallMs: 900_000,
    });
  });

  it('setting callTimeoutMs never changes the other four', () => {
    expect(buildMcpClientTimeouts(30_000)).toEqual(
      expect.objectContaining({
        startupMs: 10_000,
        perCallMs: 30_000,
        globalDefaultMs: 60_000,
        idleMs: 300_000,
      }),
    );
    expect(buildMcpClientTimeouts(600_000)).toEqual(
      expect.objectContaining({
        startupMs: 10_000,
        perCallMs: 30_000,
        globalDefaultMs: 60_000,
        idleMs: 300_000,
      }),
    );
  });

  it('the composition passes the resolved timeouts straight through to the supervisor', async () => {
    const entries = [resolvedEntry()];
    const approvalStore = approvedApprovalStore(entries);
    const diagnostics = diagnosticsSink();
    const { connection } = fakeConnection(discoveryWithOneTool());
    let capturedOptions: IMCPConnectionSupervisorOptions | undefined;

    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      timeouts: buildMcpClientTimeouts(900_000),
      transport: {
        fetch: async () => {
          throw new Error('the fake connection never opens a real transport; fetch must not run');
        },
        lookup: async () => ['93.184.216.34'],
      },
      createSupervisor: (options) => {
        capturedOptions = options;
        return connection;
      },
      reportDiagnostic: diagnostics.reportDiagnostic,
    });

    await composition.connect();

    expect(capturedOptions?.timeouts).toEqual({
      startupMs: 10_000,
      perCallMs: 30_000,
      globalDefaultMs: 60_000,
      idleMs: 300_000,
      toolCallMs: 900_000,
    });

    await composition.shutdown();
  });
});

describe('remote server authentication', () => {
  it('asks the host for the authenticator of exactly the admitted server', async () => {
    const entries = [resolvedEntry()];
    const approvalStore = approvedApprovalStore(entries);
    const { connection } = fakeConnection(discoveryWithOneTool());
    const authenticatorFor = vi.fn(() => ({
      authorize: async () => ({ authorization: 'Bearer t' }),
      onRejected: async () => 'fail' as const,
    }));

    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      authenticatorFor,
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => connection,
      reportDiagnostic: diagnosticsSink().reportDiagnostic,
    });
    await composition.connect();

    expect(authenticatorFor).toHaveBeenCalledOnce();
    expect(authenticatorFor).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'weather', securityIdentity: expect.any(String) }),
    );
    await composition.shutdown();
  });

  it('refuses a server that declares authentication this version cannot perform', async () => {
    const entries = [
      resolvedEntry({ definition: definition({ unsupportedAuthentication: ['oauth'] }) }),
    ];
    const approvalStore = approvedApprovalStore(entries);
    const diagnostics = diagnosticsSink();
    let supervisorConstructed = false;

    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore,
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => {
        supervisorConstructed = true;
        throw new Error('unreachable');
      },
      reportDiagnostic: diagnostics.reportDiagnostic,
    });

    expect(await composition.connect()).toEqual([]);
    expect(supervisorConstructed).toBe(false);
    expect(diagnostics.messages.join('\n')).toContain('unsupported-authentication');
    await composition.shutdown();
  });
});

describe('OAuth remote servers', () => {
  const oauthEntries = () => [resolvedEntry({ definition: definition({ oauth: {} }) })];

  it('refuses an oauth server when the host offers no OAuth, never connecting without it', async () => {
    const entries = oauthEntries();
    const diagnostics = diagnosticsSink();
    let supervisorConstructed = false;
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedApprovalStore(entries),
      authenticatorFor: () => ({
        authorize: async () => ({ authorization: 'Bearer static' }),
        onRejected: async () => 'fail' as const,
      }),
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => {
        supervisorConstructed = true;
        throw new Error('unreachable');
      },
      reportDiagnostic: diagnostics.reportDiagnostic,
    });
    expect(await composition.connect()).toEqual([]);
    expect(supervisorConstructed).toBe(false);
    expect(diagnostics.messages.join('\n')).toContain('oauth-unavailable');
    await composition.shutdown();
  });

  it('builds one OAuth authenticator per server for the composition, closed at shutdown', async () => {
    const entries = oauthEntries();
    const { connection } = fakeConnection(discoveryWithOneTool());
    const close = vi.fn();
    const authenticatorFor = vi.fn(() => ({
      authorize: async () => ({ Authorization: 'Bearer t' }),
      onRejected: async () => 'fail' as const,
      close,
    }));
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedApprovalStore(entries),
      oauth: { authenticatorFor },
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => connection,
      reportDiagnostic: diagnosticsSink().reportDiagnostic,
    });
    await composition.connect();
    await composition.connect();
    expect(authenticatorFor).toHaveBeenCalledOnce();
    expect(authenticatorFor).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'weather' }),
      expect.objectContaining({ oauth: {} }),
    );
    expect(close).not.toHaveBeenCalled();
    await composition.shutdown();
    expect(close).toHaveBeenCalledOnce();
  });

  it('a /mcp sign-out makes the live authenticator drop the token it holds', async () => {
    const entries = oauthEntries();
    const { connection } = fakeConnection(discoveryWithOneTool());
    const forget = vi.fn();
    const signOut = vi.fn(async () => ({ removed: true, revocation: 'revoked' as const }));
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedApprovalStore(entries),
      oauth: {
        authenticatorFor: () => ({
          authorize: async () => ({ Authorization: 'Bearer t' }),
          onRejected: async () => 'fail' as const,
          forget,
          close: () => undefined,
        }),
        state: async () => 'signed-in',
        signOut,
      },
      transport: { lookup: async () => ['93.184.216.34'] },
      createSupervisor: () => connection,
      reportDiagnostic: diagnosticsSink().reportDiagnostic,
    });
    await composition.connect();
    await expect(composition.activationAdapter.oauthStatus?.()).resolves.toEqual([
      { serverId: 'weather', state: 'signed-in' },
    ]);
    await expect(composition.activationAdapter.oauthLogout?.('weather')).resolves.toEqual({
      serverId: 'weather',
      removed: true,
      revocation: 'revoked',
    });
    expect(signOut).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 'weather' }),
      expect.objectContaining({ oauth: {} }),
    );
    expect(forget).toHaveBeenCalledOnce();
    await composition.shutdown();
  });
});

describe('stdio client host authority (MCP-2522)', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture(name = 'weather') {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'mcp-cli-stdio-')));
    roots.push(root);
    const entries = [
      resolvedEntry({
        name,
        definition: {
          name,
          source: 'user',
          origin: '~/.test-product/settings.json',
          unsetVariables: [],
          transport: 'stdio',
          command: process.execPath,
          args: [],
          cwd: root,
        },
      }),
    ];
    return {
      entries,
      authority: {
        allowedRoot: root,
        generation: 'host-1',
        executables: [{ command: process.execPath, args: [[]] }],
      },
    };
  }

  it.each(['weather', 'constructor'])(
    'reports missing host authority for %s without constructing a connection',
    async (name) => {
      const { entries } = fixture(name);
      const reportDiagnostic = vi.fn();
      const createSupervisor = vi.fn();
      const composition = createMcpClientComposition({
        resolvedEntries: entries,
        approvalStore: approvedApprovalStore(entries),
        stdioAuthorities: {},
        reportDiagnostic,
        createSupervisor,
      });
      expect(await composition.connect()).toEqual([]);
      expect(createSupervisor).not.toHaveBeenCalled();
      expect(reportDiagnostic).toHaveBeenCalledWith(expect.stringContaining('host authority'));
    },
  );

  it('uses the shared catalog and shuts down the admitted stdio connection', async () => {
    const { entries, authority } = fixture();
    const { connection } = fakeConnection(discoveryWithOneTool());
    const shutdown = vi.spyOn(connection, 'shutdown');
    const reportDiagnostic = vi.fn();
    const createSupervisor = vi.fn(() => connection);
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedApprovalStore(entries),
      stdioAuthorities: { weather: authority },
      createSupervisor,
      reportDiagnostic,
    });
    expect((await composition.connect()).map((tool) => tool.getName())).toEqual([
      'weather__forecast',
    ]);
    expect(composition.connectedToolProvenance.get('weather__forecast')?.serverId).toBe('weather');
    expect(reportDiagnostic).not.toHaveBeenCalled();
    expect(createSupervisor).toHaveBeenCalledWith(
      expect.objectContaining({ awaitOpenCleanupOnTimeout: true }),
    );
    await composition.shutdown();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('does not let host authority replace activation approval', async () => {
    const { entries, authority } = fixture();
    const createSupervisor = vi.fn();
    const reportDiagnostic = vi.fn();
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      stdioAuthorities: { weather: authority },
      createSupervisor,
      reportDiagnostic,
    });
    expect(await composition.connect()).toEqual([]);
    expect(createSupervisor).not.toHaveBeenCalled();
    expect(reportDiagnostic).toHaveBeenCalledWith(expect.stringContaining('not admitted'));
  });

  it('reports stdio discovery failure without exposing child error text', async () => {
    const { entries, authority } = fixture();
    const { connection } = fakeConnection(discoveryWithOneTool());
    connection.discover = async () => {
      throw new Error('SECRET_FROM_CHILD');
    };
    const reportDiagnostic = vi.fn();
    const composition = createMcpClientComposition({
      resolvedEntries: entries,
      approvalStore: approvedApprovalStore(entries),
      stdioAuthorities: { weather: authority },
      createSupervisor: () => connection,
      reportDiagnostic,
    });
    expect(await composition.connect()).toEqual([]);
    expect(reportDiagnostic).toHaveBeenCalledWith(expect.stringContaining('discovery failed'));
    expect(JSON.stringify(reportDiagnostic.mock.calls)).not.toContain('SECRET_FROM_CHILD');
    await composition.shutdown();
  });
});

// --- Static import-boundary check (TC-21): the product composes the manager, it does not import
// the protocol SDK directly. Mirrors `agent-mcp`'s own `definition-no-side-effects.test.ts`.

const CLI_SRC = path.resolve(import.meta.dirname, '..', '..');
const FORBIDDEN_SDK_IMPORT = /^@modelcontextprotocol\/sdk/;

function tsSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    if (entry.parentPath?.includes(`${path.sep}__tests__`)) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) continue;
    out.push(path.join(entry.parentPath ?? dir, entry.name));
  }
  return out;
}

function importSpecifiersOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s+'([^']+)'/g)) {
    specifiers.push(match[1]!);
  }
  for (const match of text.matchAll(/\bimport\(\s*'([^']+)'/g)) specifiers.push(match[1]!);
  for (const match of text.matchAll(/\brequire\(\s*'([^']+)'/g)) specifiers.push(match[1]!);
  return specifiers;
}

describe('agent-cli imports no MCP protocol SDK directly (TC-21)', () => {
  it('finds source files to check', () => {
    expect(tsSourceFiles(CLI_SRC).length).toBeGreaterThan(0);
  });

  it('no file outside __tests__ imports @modelcontextprotocol/sdk', () => {
    const offenders: string[] = [];
    for (const file of tsSourceFiles(CLI_SRC)) {
      for (const specifier of importSpecifiersOf(file)) {
        if (FORBIDDEN_SDK_IMPORT.test(specifier)) {
          offenders.push(`${path.relative(CLI_SRC, file)} imports ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('would catch a forbidden import if one appeared', () => {
    expect(FORBIDDEN_SDK_IMPORT.test('@modelcontextprotocol/sdk/client/streamableHttp.js')).toBe(
      true,
    );
    expect(FORBIDDEN_SDK_IMPORT.test('@robota-sdk/agent-mcp')).toBe(false);
  });
});
