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

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { InMemoryMCPActivationApprovalStore, MCPDefinitionRegistry } from '@robota-sdk/agent-mcp';
import { describe, expect, it } from 'vitest';

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
    origin: '~/.robota/settings.json',
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
    origin: '~/.robota/settings.json',
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
