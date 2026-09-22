/**
 * MCP-002 product composition: agent-cli COMPOSES `@robota-sdk/agent-mcp`'s manager, it does not
 * own any protocol, catalog, retry or trust-policy logic itself.
 *
 * This is the one place in the product that turns MCP-001's resolved definitions into:
 *
 * 1. the `/mcp` command port (`ICommandMCPActivationAdapter`, wired via
 *    `IStartCliOptions.mcpActivationAdapter` in `./command-setup.ts`) — a thin projection over
 *    `MCPActivationController`, the definition-registry adapter `agent-mcp` already ships;
 * 2. the runtime tool set for every resolved, admitted, Streamable HTTP definition — admit the
 *    endpoint, open a supervised session, discover, build the catalog and wrap each adopted/adapted
 *    tool with `createDiscoveredTool`, all `agent-mcp` functions called in the sequence its own SPEC
 *    documents (`docs/SPEC.md` § Architecture Overview). The result is `IToolWithEventService[]`,
 *    the SAME generic dynamic-tool shape every other tool in this product satisfies
 *    (`ICreateSessionOptions.additionalTools`), so nothing MCP-specific reaches `agent-framework`.
 *
 * What this module deliberately does NOT do: decode raw `mcpServers` config, resolve precedence, or
 * decide trust — `agent-mcp` (MCP-001) already owns all of that, `MCPActivationAdmissionService`
 * already decides admission, and none of it is duplicated here. It also does not yet SOURCE
 * `IMCPResolvedEntry[]` from disk: nothing in `agent-cli`/`agent-command` reads a project's/user's
 * `mcpServers` settings into that shape today (only `bundle-plugin-inspection.ts`'s informational,
 * connection-free listing exists), so `resolvedEntries` is accepted as an explicit input rather than
 * invented here — the composition root that eventually reads those settings sources feeds this
 * module, exactly as it feeds `MCPDefinitionRegistry`'s constructor.
 */

import {
  MCPActivationAdmissionService,
  MCPActivationController,
  MCPConnectionSupervisor,
  MCPDefinitionRegistry,
  buildCatalog,
  createDiscoveredTool,
  createStreamableHttpAdapter,
  openMcpSession,
} from '@robota-sdk/agent-mcp';
import type {
  IMCPActivationApprovalStore,
  IMCPActivationRequest,
  IMCPActivationSummary,
  IMCPActivationWorkspace,
  IMCPAdmittedHttpEndpoint,
  IMCPBackoffPolicy,
  IMCPCatalog,
  IMCPCatalogInput,
  IMCPConnectionSupervisorOptions,
  IMCPDiscovery,
  IMCPHttpEndpoint,
  IMCPHttpTransportDeps,
  IMCPResolvedEntry,
  IMCPServerDefinitionResolved,
  IMCPSupervisorClock,
  IMCPTimeouts,
  IMCPToolCallResult,
  IMCPTransportAdapter,
} from '@robota-sdk/agent-mcp';
import type {
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
} from '@robota-sdk/agent-framework';
import type { IToolWithEventService, TToolParameters } from '@robota-sdk/agent-core';

/**
 * Operational defaults for the four supervisor timeouts (`agent-mcp`'s SPEC leaves the numbers to
 * the caller; nothing about their VALUES is protocol logic). Overridable via
 * {@link IMcpClientCompositionDeps.timeouts}.
 */
const DEFAULT_MCP_CLIENT_TIMEOUTS: IMCPTimeouts = {
  startupMs: 10_000,
  perCallMs: 30_000,
  globalDefaultMs: 60_000,
  idleMs: 300_000,
};

export interface IMcpClientCompositionDeps {
  /** MCP-001's resolved definitions — see the module doc for why this is injected, not sourced. */
  readonly resolvedEntries: readonly IMCPResolvedEntry[];
  /** Repository identity/trust snapshot, passed through to admission unchanged. */
  readonly workspace?: IMCPActivationWorkspace;
  /** Durable approval/audit persistence; defaults to an in-memory store (session-scoped trust). */
  readonly approvalStore?: IMCPActivationApprovalStore;
  readonly now?: () => string;
  readonly timeouts?: IMCPTimeouts;
  readonly backoff?: Partial<IMCPBackoffPolicy>;
  readonly clock?: IMCPSupervisorClock;
  readonly discovery?: { readonly maxPages: number };
  readonly transport?: IMCPHttpTransportDeps;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  /**
   * Constructs the per-server connection. Defaults to a real `MCPConnectionSupervisor`; a test
   * injects a fake that never opens a transport. Never used to change WHEN or HOW a connection
   * decides its own retry/backoff/state — only what class backs it.
   */
  readonly createSupervisor?: (options: IMCPConnectionSupervisorOptions) => IMcpServerConnection;
  /**
   * Every admission refusal, transport-policy refusal, catalog rejection, unenforceable-schema
   * report and discovery failure is surfaced here — never swallowed
   * (`enforcement-architecture.md`, "Silence is not success"). The CLI's existing diagnostics
   * sink (whatever the host uses for user-visible warnings) is the intended target.
   */
  readonly reportDiagnostic: (message: string) => void;
}

export interface IMcpClientComposition {
  /** Wire directly into `IStartCliOptions.mcpActivationAdapter` — the `/mcp` command port. */
  readonly activationAdapter: ICommandMCPActivationAdapter;
  /**
   * Admits, connects to, and discovers every resolved+enabled Streamable HTTP definition, and
   * returns the resulting tools for the generic dynamic-tool path
   * (`ICreateSessionOptions.additionalTools`). A single server's refusal/failure is reported via
   * `reportDiagnostic` and that server is excluded; it never fails the whole call.
   */
  connect(signal?: AbortSignal): Promise<readonly IToolWithEventService[]>;
  /** Closes every supervisor opened by `connect`, cancelling their armed timers. */
  shutdown(): Promise<void>;
}

/**
 * The narrow shape this module actually drives on a connection — exactly `MCPConnectionSupervisor`'s
 * `discover` / `callTool` / `shutdown`. Structural, not `MCPConnectionSupervisor` itself, so a test
 * can inject a fake connection (no real transport, no real MCP server) without this module knowing
 * the difference; production code never supplies anything but a real supervisor.
 */
export interface IMcpServerConnection {
  discover(signal?: AbortSignal): Promise<IMCPDiscovery>;
  callTool(
    name: string,
    args: TToolParameters,
    options?: { readonly signal?: AbortSignal },
  ): Promise<IMCPToolCallResult>;
  shutdown(): Promise<void>;
}

/** Narrows `agent-mcp`'s internal activation summary to the command layer's secret-free port shape. */
function toCommandSummary(summary: IMCPActivationSummary): ICommandMCPActivationSummary {
  return {
    serverId: summary.serverId,
    ...(summary.displayName === undefined ? {} : { displayName: summary.displayName }),
    source: summary.source,
    status: summary.status,
    allowed: summary.allowed,
    reason: summary.reason,
    provenanceId: summary.provenanceId,
    definitionFingerprint: summary.definitionFingerprint,
    securityIdentity: summary.securityIdentity,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One resolved+enabled server's outcome: what `buildCatalog` should see, and the live connection (if any) `createDiscoveredTool` should call back into. */
interface IConnectedServer {
  readonly catalogInput: IMCPCatalogInput;
  readonly connection?: IMcpServerConnection;
}

interface IConnectServerContext {
  readonly admission: MCPActivationAdmissionService;
  readonly createSupervisor: (options: IMCPConnectionSupervisorOptions) => IMcpServerConnection;
  readonly timeouts: IMCPTimeouts;
  readonly deps: IMcpClientCompositionDeps;
  readonly signal: AbortSignal | undefined;
}

/**
 * Admits, connects to and discovers exactly ONE resolved Streamable HTTP definition. Every refusal
 * or failure is reported via `deps.reportDiagnostic` and answered with `undefined` — the caller
 * excludes that server and moves on, never aborting the others (per-server isolation).
 */
/** The per-server options a real `MCPConnectionSupervisor` (or the test fake standing in for it) needs. */
function buildSupervisorOptions(
  request: IMCPActivationRequest,
  transportAdapter: IMCPTransportAdapter<IMCPHttpEndpoint, IMCPAdmittedHttpEndpoint>,
  admittedEndpoint: IMCPAdmittedHttpEndpoint,
  timeouts: IMCPTimeouts,
  deps: IMcpClientCompositionDeps,
): IMCPConnectionSupervisorOptions {
  return {
    serverId: request.serverId,
    openSession: (openSignal) =>
      openMcpSession({
        serverId: request.serverId,
        transport: transportAdapter.construct(admittedEndpoint),
        timeouts: { startupMs: timeouts.startupMs, perCallMs: timeouts.perCallMs },
        ...(deps.clientInfo === undefined ? {} : { clientInfo: deps.clientInfo }),
        signal: openSignal,
      }),
    timeouts,
    ...(deps.backoff === undefined ? {} : { backoff: deps.backoff }),
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    ...(deps.discovery === undefined ? {} : { discovery: deps.discovery }),
  };
}

async function connectOneServer(
  request: IMCPActivationRequest,
  definition: IMCPServerDefinitionResolved,
  origin: string,
  context: IConnectServerContext,
): Promise<IConnectedServer | undefined> {
  const { admission, createSupervisor, timeouts, deps, signal } = context;

  const admissionResult = admission.admit(request);
  if (!admissionResult.allowed) {
    deps.reportDiagnostic(
      `MCP server "${request.serverId}" was not admitted (${admissionResult.status}): ${admissionResult.reason}`,
    );
    return undefined;
  }

  const transportAdapter = createStreamableHttpAdapter(deps.transport);
  const endpointAdmission = await transportAdapter.admit({
    url: definition.url ?? '',
    ...(definition.headers === undefined ? {} : { headers: definition.headers }),
  });
  if (!endpointAdmission.ok) {
    deps.reportDiagnostic(
      `MCP server "${request.serverId}" endpoint was refused (${endpointAdmission.reason}): ${endpointAdmission.message}`,
    );
    return undefined;
  }
  const admittedEndpoint = endpointAdmission.admitted;

  const connection = createSupervisor(
    buildSupervisorOptions(request, transportAdapter, admittedEndpoint, timeouts, deps),
  );

  // allow-fallback: one server's discovery failure is reported via `reportDiagnostic` (never
  // swallowed) and that server is recorded with no `discovery` — a catalog server entry with every
  // capability `unsupported` — rather than aborting discovery for every OTHER configured server.
  // This composition's contract is per-server isolation, not all-or-nothing; the thrown
  // `MCPDiscoveryError`/`MCPSupervisorError` still terminates THAT server's connection, it just does
  // not propagate past this one server.
  try {
    const discovery = await connection.discover(signal);
    return {
      catalogInput: { serverId: request.serverId, origin, transport: 'streamable-http', discovery },
      connection,
    };
  } catch (error) {
    deps.reportDiagnostic(
      `MCP server "${request.serverId}" discovery failed: ${describeError(error)}`,
    );
    return {
      catalogInput: { serverId: request.serverId, origin, transport: 'streamable-http' },
      connection,
    };
  }
}

/**
 * Composes `@robota-sdk/agent-mcp`'s definition registry, activation controller and per-server
 * connection supervisors into the two things this product needs from MCP-002.
 */
/** The `/mcp` command port: a thin projection over `MCPActivationController`. */
function buildActivationAdapter(controller: MCPActivationController): ICommandMCPActivationAdapter {
  return {
    list: () => controller.list().map(toCommandSummary),
    approve: (serverId) => toCommandSummary(controller.approve(serverId)),
    reject: (serverId) => toCommandSummary(controller.reject(serverId)),
    revoke: (serverId) => toCommandSummary(controller.revoke(serverId)),
  };
}

/** Every adopted/adapted tool entry whose server has a live connection, wrapped as a runtime tool. */
function collectToolsFromCatalog(
  catalog: IMCPCatalog,
  connectionByServerId: ReadonlyMap<string, IMcpServerConnection>,
): IToolWithEventService[] {
  const tools: IToolWithEventService[] = [];
  for (const entry of [...catalog.adopted, ...catalog.adapted]) {
    if (entry.kind !== 'tool') continue;
    const connection = connectionByServerId.get(entry.provenance.serverId);
    if (connection === undefined) continue;
    tools.push(createDiscoveredTool(entry, connection));
  }
  return tools;
}

export function createMcpClientComposition(deps: IMcpClientCompositionDeps): IMcpClientComposition {
  const registry = new MCPDefinitionRegistry(deps.resolvedEntries, {
    ...(deps.workspace === undefined ? {} : { workspace: deps.workspace }),
  });
  const admission = new MCPActivationAdmissionService(deps.approvalStore, deps.now);
  const controller = new MCPActivationController(registry, admission, registry.displayNames());
  const activationAdapter = buildActivationAdapter(controller);

  const openConnections: IMcpServerConnection[] = [];
  const timeouts = deps.timeouts ?? DEFAULT_MCP_CLIENT_TIMEOUTS;
  const createSupervisor =
    deps.createSupervisor ??
    ((options: IMCPConnectionSupervisorOptions) => new MCPConnectionSupervisor(options));

  async function connect(signal?: AbortSignal): Promise<readonly IToolWithEventService[]> {
    const catalogInputs: IMCPCatalogInput[] = [];
    const connectionByServerId = new Map<string, IMcpServerConnection>();
    const context: IConnectServerContext = { admission, createSupervisor, timeouts, deps, signal };

    for (const request of registry.list()) {
      const entry = deps.resolvedEntries.find((candidate) => candidate.name === request.serverId);
      if (entry === undefined || entry.definition === undefined) continue;
      const definition = entry.definition;
      // TC-06: this unit's transport set is exactly Streamable HTTP. stdio is MCP-2522's scope;
      // sse/ws have no adapter and are refused by `buildCatalog` itself when a caller reaches it —
      // neither belongs in THIS composition's connect loop.
      if (definition.transport !== 'http') continue;

      const connected = await connectOneServer(request, definition, entry.origin, context);
      if (connected === undefined) continue;
      catalogInputs.push(connected.catalogInput);
      if (connected.connection !== undefined) {
        openConnections.push(connected.connection);
        connectionByServerId.set(request.serverId, connected.connection);
      }
    }

    const catalog = buildCatalog(catalogInputs, {
      report: (toolName, unenforceablePaths) =>
        deps.reportDiagnostic(
          `MCP tool "${toolName}" has an unenforceable schema subtree: ${unenforceablePaths.join(', ')}`,
        ),
    });

    for (const rejection of catalog.rejected) {
      deps.reportDiagnostic(
        `MCP ${rejection.kind} "${rejection.name}" on "${rejection.serverId}" was rejected: ${rejection.reason}`,
      );
    }

    return collectToolsFromCatalog(catalog, connectionByServerId);
  }

  async function shutdown(): Promise<void> {
    await Promise.all(openConnections.map((connection) => connection.shutdown()));
  }

  return { activationAdapter, connect, shutdown };
}
