/**
 * MCP-002 product composition: agent-cli COMPOSES `@robota-sdk/agent-mcp`'s manager, it does not
 * own any protocol, catalog, retry or trust-policy logic itself.
 *
 * This is the one place in the product that turns MCP-001's resolved definitions into:
 *
 * 1. the `/mcp` command port (`ICommandMCPActivationAdapter`, wired via
 *    `IStartCliOptions.mcpActivationAdapter` in `./command-setup.ts`) — a thin projection over
 *    `MCPActivationController`, the definition-registry adapter `agent-mcp` already ships;
 * 2. the runtime tool set for resolved, admitted HTTP and host-authorized stdio definitions — admit the
 *    endpoint, open a supervised session, discover, build the catalog and wrap each adopted/adapted
 *    tool with `createDiscoveredTool`, all `agent-mcp` functions called in the sequence its own SPEC
 *    documents (`docs/SPEC.md` § Architecture Overview). The result is `IToolWithEventService[]`,
 *    the SAME generic dynamic-tool shape every other tool in this product satisfies
 *    (`ICreateSessionOptions.additionalTools`), so nothing MCP-specific reaches `agent-framework`.
 *
 * What this module deliberately does NOT do: decode raw `mcpServers` config, resolve precedence, or
 * decide trust — `agent-mcp` (MCP-001) already owns all of that, `MCPActivationAdmissionService`
 * already decides admission, and none of it is duplicated here. `mcp-startup.ts` supplies the
 * resolved definitions from the product's settings sources and separately forwards host-owned
 * stdio authority. This module never derives execution authority from those definitions.
 */

import {
  MCP_SOURCE_PRECEDENCE,
  MCPActivationAdmissionService,
  MCPActivationController,
  MCPConnectionSupervisor,
  MCPDefinitionRegistry,
  buildCatalog,
  createDiscoveredTool,
  createHeadersHelperAuthenticator,
  createStdioAdapter,
  createStreamableHttpAdapter,
  isBlockedByManagedFailure,
  openMcpSession,
  refuseHeadersHelper,
} from '@robota-sdk/agent-mcp';
import { DEFAULT_TOOL_RESULT_HARD_CHARS, FunctionTool } from '@robota-sdk/agent-core';
import type {
  IMCPActivationApprovalStore,
  IMCPActivationRequest,
  IMCPClientAuthenticator,
  IMCPActivationSummary,
  IMCPActivationWorkspace,
  IMCPBackoffPolicy,
  IMCPCatalog,
  IMCPCatalogInput,
  IMCPConnectionSupervisorOptions,
  IMCPDefinitionProblem,
  IMCPDiscovery,
  IMCPHeadersHelper,
  IMCPHeadersHelperAuthenticator,
  IMCPHttpTransportDeps,
  IMCPResolvedEntry,
  IMCPServerDefinitionResolved,
  IMCPStdioAuthority,
  IMCPSupervisorClock,
  IMCPTimeouts,
  IMCPToolCallResult,
  IMCPTransportAdapter,
  TMCPDefinitionSource,
  TMCPExternalEventListener,
} from '@robota-sdk/agent-mcp';
import type {
  ICommandMCPActivationAdapter,
  ICommandMCPActivationSummary,
  ICommandMCPSourceProblem,
} from '@robota-sdk/agent-framework';
import type {
  IToolResultAdmissionOptions,
  IToolResultSpillStore,
  IToolWithEventService,
  TToolParameters,
} from '@robota-sdk/agent-core';

/**
 * Operational defaults for the five supervisor timeouts (`agent-mcp`'s SPEC leaves the numbers to
 * the caller; nothing about their VALUES is protocol logic). Overridable via
 * {@link IMcpClientCompositionDeps.timeouts}. `toolCallMs` here is the MCP-002 placeholder value —
 * a caller that cares about MCP-004's tool-call budget uses {@link buildMcpClientTimeouts} instead of
 * this constant directly.
 */
const DEFAULT_MCP_CLIENT_TIMEOUTS: IMCPTimeouts = {
  startupMs: 10_000,
  perCallMs: 30_000,
  globalDefaultMs: 60_000,
  idleMs: 300_000,
  toolCallMs: 30_000,
};

/**
 * MCP-004 S3: the five supervisor timeouts with `toolCallMs` set from the resolved
 * `mcp.callTimeoutMs` setting (`mcp-settings.ts`) — `startupMs`, `perCallMs`, `globalDefaultMs` and
 * `idleMs` keep their MCP-002 defaults untouched. The one caller, `mcp-startup.ts`, passes the result
 * as {@link IMcpClientCompositionDeps.timeouts}.
 */
export function buildMcpClientTimeouts(callTimeoutMs: number): IMCPTimeouts {
  return { ...DEFAULT_MCP_CLIENT_TIMEOUTS, toolCallMs: callTimeoutMs };
}

/** One helper run the host is asked to perform, for an allowed helper of an admitted server. */
export interface IMcpHeadersHelperInvocation {
  readonly request: IMCPActivationRequest;
  readonly definition: IMCPServerDefinitionResolved;
  readonly helper: IMCPHeadersHelper;
}

/** The host's authority over header helpers: which exact command lines it allows, and how it runs one. */
export interface IMcpHeadersHelperHost {
  readonly allowed: readonly IMCPHeadersHelper[];
  run(invocation: IMcpHeadersHelperInvocation, signal: AbortSignal): Promise<string>;
}

export interface IMcpClientCompositionDeps {
  /** MCP-001's resolved definitions — see the module doc for why this is injected, not sourced. */
  readonly resolvedEntries: readonly IMCPResolvedEntry[];
  /**
   * Every problem that named no server at all (issue #2794): a config root that is not an object,
   * no `mcpServers`, `mcpServers` not an object, or a layer that failed to parse. Surfaced through
   * `activationAdapter.sourceProblems()` so `/mcp status` can say which source could not be read,
   * beside the servers that did resolve — not only as a one-time startup diagnostic.
   */
  readonly sourceProblems?: readonly IMCPDefinitionProblem[];
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
  /** Host capabilities, never populated from project or user MCP definitions. */
  readonly stdioAuthorities?: Readonly<Record<string, IMCPStdioAuthority>>;
  /**
   * The authenticator a host registers for one remote server, chosen by its admitted identity.
   * Host-owned like the stdio authorities: a definition never supplies one.
   */
  readonly authenticatorFor?: (
    request: IMCPActivationRequest,
  ) => IMCPClientAuthenticator | undefined;
  /**
   * Header helpers, host-owned like the stdio authorities. Absent, every definition that declares
   * a helper is refused; a helper is never replaced by the definition's static headers alone.
   */
  readonly headersHelpers?: IMcpHeadersHelperHost;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  /** Created only for the first overflow and owned through this composition's shutdown. */
  readonly createResultSpillStore?: () => IToolResultSpillStore & {
    read(reference: string): Promise<string>;
    shutdown(): Promise<void>;
  };
  readonly resultAdmissionLimits?: Pick<
    IToolResultAdmissionOptions,
    'warningChars' | 'hardChars' | 'repositoryMaxChars'
  >;
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

/**
 * MCP-004 S3: one connected tool's handoff-relevant provenance — everything
 * `IToolCallHandoffProvenance` (`@robota-sdk/agent-framework`) needs beyond `permissionMode`, which
 * is a session-level input `mcp-startup.ts` supplies, not a per-server fact this module holds.
 */
export interface IMcpConnectedToolProvenance {
  readonly serverId: string;
  /** The tool's name as the MCP server declared it — distinct from its exposed canonical name. */
  readonly sourceName: string;
  readonly securityIdentity: string;
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
  /** Bind a host listener only to an admitted, connected, capability-declaring MCP server. */
  subscribeExternalEvent(
    serverId: string,
    listener: TMCPExternalEventListener,
  ):
    | { readonly ok: true; readonly unsubscribe: () => void }
    | { readonly ok: false; readonly reason: string };
  /** Closes every supervisor opened by `connect`, cancelling their armed timers. */
  shutdown(): Promise<void>;
  /**
   * Provenance for every tool the most recent `connect()` call returned, keyed by the tool's exposed
   * canonical name (`getName()`). Empty until `connect()` resolves at least once. `mcp-startup.ts`
   * reads this to build MCP-004's `toolCallHandoff` policy — never mutated outside `connect()`.
   */
  readonly connectedToolProvenance: ReadonlyMap<string, IMcpConnectedToolProvenance>;
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
  onExternalEvent?(listener: TMCPExternalEventListener): () => void;
}

/**
 * Narrows a source-scoped `IMCPDefinitionProblem` (`name === ''`) to the command layer's port shape.
 *
 * `blockedServerNames` (PR #3076 review): a MANAGED-tier problem is the one case where
 * `resolveByPrecedence` also blocked lower-tier entries — those names would otherwise vanish from
 * `/mcp status` with no explanation, since `MCPActivationController.list()` only ever offers resolved
 * candidates. `managedTier` is a parameter (not re-imported from `@robota-sdk/agent-mcp` here) so the
 * caller passes the SAME `MCP_SOURCE_PRECEDENCE[0]` it already resolved once, rather than this
 * function re-deriving the tier name from a second import.
 */
function toCommandSourceProblem(
  problem: IMCPDefinitionProblem,
  managedTier: TMCPDefinitionSource,
  blockedServerNames: readonly string[],
): ICommandMCPSourceProblem {
  return {
    source: problem.source,
    origin: problem.origin,
    reason: problem.reason,
    blockedServerNames: problem.source === managedTier ? blockedServerNames : [],
  };
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
  /** Every helper authenticator created, closed at shutdown so no helper outlives the client. */
  /** One helper slot per server, closed when the server is connected again or at shutdown. */
  readonly helperSlots: Map<string, IHelperAuthenticatorSlot>;
}

/**
 * Admits, connects to and discovers exactly ONE resolved Streamable HTTP definition. Every refusal
 * or failure is reported via `deps.reportDiagnostic` and answered with `undefined` — the caller
 * excludes that server and moves on, never aborting the others (per-server isolation).
 */
/**
 * A server's helper authenticator, replaced each time its session is opened: helper headers belong
 * to one connection, so a reconnect runs the helper afresh and the old one's cache is dropped
 * rather than kept alive until shutdown. A request already waiting on the old cache is refused when
 * it closes; one that authorizes after the renewal gets the new helper run's headers, for the same
 * server, helper and URL.
 */
interface IHelperAuthenticatorSlot {
  readonly authenticator: IMCPClientAuthenticator;
  renew(): void;
  close(): void;
}

function helperAuthenticatorSlot(
  create: () => IMCPHeadersHelperAuthenticator,
): IHelperAuthenticatorSlot {
  let current: IMCPHeadersHelperAuthenticator | undefined;
  let closed = false;
  const active = (): IMCPHeadersHelperAuthenticator => {
    current ??= create();
    if (closed) current.close();
    return current;
  };
  return {
    authenticator: {
      authorize: (request) => active().authorize(request),
      onRejected: (rejection) => active().onRejected(rejection),
    },
    renew: () => {
      current?.close();
      current = undefined;
    },
    close: () => {
      closed = true;
      current?.close();
    },
  };
}

/** The per-server options a real `MCPConnectionSupervisor` (or the test fake standing in for it) needs. */
function buildSupervisorOptions<TInput, TAdmitted>(
  request: IMCPActivationRequest,
  transportAdapter: IMCPTransportAdapter<TInput, TAdmitted>,
  admittedEndpoint: TAdmitted,
  timeouts: IMCPTimeouts,
  deps: IMcpClientCompositionDeps,
  onOpen?: () => void,
): IMCPConnectionSupervisorOptions {
  return {
    serverId: request.serverId,
    awaitOpenCleanupOnTimeout: transportAdapter.kind === 'stdio',
    openSession: (openSignal) => {
      onOpen?.();
      return openMcpSession({
        serverId: request.serverId,
        transport: transportAdapter.construct(admittedEndpoint),
        timeouts: { startupMs: timeouts.startupMs, perCallMs: timeouts.perCallMs },
        ...(deps.clientInfo === undefined ? {} : { clientInfo: deps.clientInfo }),
        signal: openSignal,
      });
    },
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

  let supervisorOptions: IMCPConnectionSupervisorOptions;
  const transport = definition.transport === 'stdio' ? 'stdio' : 'streamable-http';
  if (definition.transport === 'stdio') {
    const authority =
      deps.stdioAuthorities !== undefined && Object.hasOwn(deps.stdioAuthorities, request.serverId)
        ? deps.stdioAuthorities[request.serverId]
        : undefined;
    if (authority === undefined) {
      deps.reportDiagnostic(
        `MCP server "${request.serverId}" stdio was refused: missing host authority.`,
      );
      return undefined;
    }
    const adapter = createStdioAdapter({ admission, authority });
    const result = await adapter.admit({ definition, activation: request });
    if (!result.ok) {
      deps.reportDiagnostic(
        `MCP server "${request.serverId}" stdio was refused (${result.reason}).`,
      );
      return undefined;
    }
    supervisorOptions = buildSupervisorOptions(request, adapter, result.admitted, timeouts, deps);
  } else {
    const adapter = createStreamableHttpAdapter(deps.transport);
    const helper = definition.headersHelper;
    let authenticator: IMCPClientAuthenticator | undefined;
    let helperSlot: IHelperAuthenticatorSlot | undefined;
    if (helper === undefined) {
      authenticator = deps.authenticatorFor?.(request);
    } else {
      const host = deps.headersHelpers;
      const refusal = refuseHeadersHelper(
        helper,
        request.source,
        request.workspace,
        host?.allowed ?? [],
      );
      if (host === undefined || refusal !== undefined) {
        deps.reportDiagnostic(
          `MCP server "${request.serverId}" endpoint was refused (${refusal ?? 'headers-helper-not-allowed'}).`,
        );
        return undefined;
      }
      const slot = helperAuthenticatorSlot(() =>
        createHeadersHelperAuthenticator((runSignal) =>
          host.run({ request, definition, helper }, runSignal),
        ),
      );
      context.helperSlots.get(request.serverId)?.close();
      context.helperSlots.set(request.serverId, slot);
      helperSlot = slot;
      authenticator = slot.authenticator;
    }
    const result = await adapter.admit({
      url: definition.url ?? '',
      ...(helper === undefined ? {} : { authenticationRequired: true }),
      ...(definition.headers === undefined ? {} : { headers: definition.headers }),
      ...(definition.unsupportedAuthentication === undefined
        ? {}
        : { unsupportedAuthentication: definition.unsupportedAuthentication }),
      ...(authenticator === undefined
        ? {}
        : {
            authentication: {
              serverId: request.serverId,
              securityIdentity: request.securityIdentity,
              authenticator,
            },
          }),
    });
    if (!result.ok) {
      deps.reportDiagnostic(
        `MCP server "${request.serverId}" endpoint was refused (${result.reason}): ${result.message}`,
      );
      return undefined;
    }
    supervisorOptions = buildSupervisorOptions(
      request,
      adapter,
      result.admitted,
      timeouts,
      deps,
      helperSlot === undefined ? undefined : () => helperSlot.renew(),
    );
  }
  const connection = createSupervisor(supervisorOptions);

  // allow-fallback: one server's discovery failure is reported via `reportDiagnostic` (never
  // swallowed) and that server is recorded with no `discovery` — a catalog server entry with every
  // capability `unsupported` — rather than aborting discovery for every OTHER configured server.
  // This composition's contract is per-server isolation, not all-or-nothing; the thrown
  // `MCPDiscoveryError`/`MCPSupervisorError` still terminates THAT server's connection, it just does
  // not propagate past this one server.
  try {
    const discovery = await connection.discover(signal);
    return {
      catalogInput: { serverId: request.serverId, origin, transport, discovery },
      connection,
    };
  } catch (error) {
    deps.reportDiagnostic(
      `MCP server "${request.serverId}" discovery failed: ${transport === 'stdio' ? 'stdio connection failed' : describeError(error)}`,
    );
    return {
      catalogInput: { serverId: request.serverId, origin, transport },
      connection,
    };
  }
}

/**
 * Composes `@robota-sdk/agent-mcp`'s definition registry, activation controller and per-server
 * connection supervisors into the two things this product needs from MCP-002.
 */
/**
 * The `/mcp` command port: a thin projection over `MCPActivationController`, plus the source-scoped
 * problems (issue #2794) `MCPActivationController.list()` structurally cannot carry — it is keyed by
 * server id, and a source-level problem names no server.
 */
function buildActivationAdapter(
  controller: MCPActivationController,
  sourceProblems: readonly IMCPDefinitionProblem[],
  resolvedEntries: readonly IMCPResolvedEntry[],
): ICommandMCPActivationAdapter {
  const managedTier = MCP_SOURCE_PRECEDENCE[0];
  return {
    list: () => controller.list().map(toCommandSummary),
    sourceProblems: () => {
      // Recomputed on each call rather than captured once: `resolvedEntries` is this composition's
      // input for its whole lifetime (MCP-002 does not mutate it), so this is only ever the same
      // list — but reading it lazily here, beside `controller.list()` above, keeps both projections
      // built the same way (on read) rather than one eager and one lazy for no reason.
      const blockedServerNames = resolvedEntries
        .filter(isBlockedByManagedFailure)
        .map((entry) => entry.name);
      return sourceProblems.map((problem) =>
        toCommandSourceProblem(problem, managedTier, blockedServerNames),
      );
    },
    approve: (serverId) => toCommandSummary(controller.approve(serverId)),
    reject: (serverId) => toCommandSummary(controller.reject(serverId)),
    revoke: (serverId) => toCommandSummary(controller.revoke(serverId)),
  };
}

/**
 * Every adopted/adapted tool entry whose server has a live connection, wrapped as a runtime tool.
 * `provenanceByCanonicalName` is populated as a side effect (MCP-004 S3) — one entry per returned
 * tool, keyed by the exact name `getName()` reports.
 */
function collectToolsFromCatalog(
  catalog: IMCPCatalog,
  connectionByServerId: ReadonlyMap<string, IMcpServerConnection>,
  securityIdentityByServerId: ReadonlyMap<string, string>,
  provenanceByCanonicalName: Map<string, IMcpConnectedToolProvenance>,
  admission: IToolResultAdmissionOptions,
): IToolWithEventService[] {
  const tools: IToolWithEventService[] = [];
  for (const entry of [...catalog.adopted, ...catalog.adapted]) {
    if (entry.kind !== 'tool') continue;
    const connection = connectionByServerId.get(entry.provenance.serverId);
    if (connection === undefined) continue;
    const tool = createDiscoveredTool(entry, connection, { admission });
    tools.push(tool);
    const securityIdentity = securityIdentityByServerId.get(entry.provenance.serverId);
    if (securityIdentity !== undefined) {
      provenanceByCanonicalName.set(tool.getName(), {
        serverId: entry.provenance.serverId,
        sourceName: entry.sourceName,
        securityIdentity,
      });
    }
  }
  return tools;
}

export function createMcpClientComposition(deps: IMcpClientCompositionDeps): IMcpClientComposition {
  const registry = new MCPDefinitionRegistry(deps.resolvedEntries, {
    ...(deps.workspace === undefined ? {} : { workspace: deps.workspace }),
  });
  const admission = new MCPActivationAdmissionService(deps.approvalStore, deps.now);
  const controller = new MCPActivationController(registry, admission, registry.displayNames());
  const activationAdapter = buildActivationAdapter(
    controller,
    deps.sourceProblems ?? [],
    deps.resolvedEntries,
  );

  const openConnections: IMcpServerConnection[] = [];
  const helperSlots = new Map<string, IHelperAuthenticatorSlot>();
  const connectedByServerId = new Map<string, IMcpServerConnection>();
  const timeouts = deps.timeouts ?? DEFAULT_MCP_CLIENT_TIMEOUTS;
  const createSupervisor =
    deps.createSupervisor ??
    ((options: IMCPConnectionSupervisorOptions) => new MCPConnectionSupervisor(options));
  const connectedToolProvenance = new Map<string, IMcpConnectedToolProvenance>();
  let resultSpillStore:
    | (IToolResultSpillStore & {
        read(reference: string): Promise<string>;
        shutdown(): Promise<void>;
      })
    | undefined;
  const resultAdmission: IToolResultAdmissionOptions = {
    ...deps.resultAdmissionLimits,
    ...(deps.createResultSpillStore
      ? {
          spillStore: {
            write: (content: string) => {
              resultSpillStore ??= deps.createResultSpillStore!();
              return resultSpillStore.write(content);
            },
          },
        }
      : {}),
    onWarning: ({ resultChars, warningChars }) =>
      deps.reportDiagnostic(
        `MCP tool result warning: ${resultChars} characters exceeds ${warningChars}`,
      ),
  };

  async function connect(signal?: AbortSignal): Promise<readonly IToolWithEventService[]> {
    connectedByServerId.clear();
    const catalogInputs: IMCPCatalogInput[] = [];
    const connectionByServerId = new Map<string, IMcpServerConnection>();
    const securityIdentityByServerId = new Map<string, string>();
    const context: IConnectServerContext = {
      admission,
      createSupervisor,
      timeouts,
      deps,
      signal,
      helperSlots,
    };

    for (const request of registry.list()) {
      const entry = deps.resolvedEntries.find((candidate) => candidate.name === request.serverId);
      if (entry === undefined || entry.definition === undefined) continue;
      const definition = entry.definition;
      // HTTP and stdio use shared adapters; SSE/WebSocket have no adapter in this composition.
      if (definition.transport !== 'http' && definition.transport !== 'stdio') continue;

      const connected = await connectOneServer(request, definition, entry.origin, context);
      if (connected === undefined) continue;
      catalogInputs.push(connected.catalogInput);
      if (connected.connection !== undefined) {
        openConnections.push(connected.connection);
        connectionByServerId.set(request.serverId, connected.connection);
        connectedByServerId.set(request.serverId, connected.connection);
        securityIdentityByServerId.set(request.serverId, request.securityIdentity);
      }
    }

    const catalog = buildCatalog(catalogInputs, {
      report: (toolName, unenforceablePaths) =>
        deps.reportDiagnostic(
          `MCP tool "${toolName}" has an unenforceable schema subtree: ${unenforceablePaths.join(', ')}`,
        ),
      reportResultSizeProblem: (reason) =>
        deps.reportDiagnostic(`MCP result-size metadata ignored (${reason})`),
    });

    for (const rejection of catalog.rejected) {
      deps.reportDiagnostic(
        `MCP ${rejection.kind} "${rejection.name}" on "${rejection.serverId}" was rejected: ${rejection.reason}`,
      );
    }

    connectedToolProvenance.clear();
    const tools = collectToolsFromCatalog(
      catalog,
      connectionByServerId,
      securityIdentityByServerId,
      connectedToolProvenance,
      resultAdmission,
    );
    if (tools.length > 0 && deps.createResultSpillStore) {
      tools.push(
        new FunctionTool(
          {
            name: 'robota_read_mcp_result',
            description:
              'Read up to 4,000 characters of a saved MCP tool result using its opaque tool-result reference and a zero-based character offset.',
            parameters: {
              type: 'object',
              properties: {
                reference: { type: 'string', description: 'The exact tool-result reference' },
                offset: { type: 'number', description: 'Zero-based character offset, default 0' },
              },
              required: ['reference'],
            },
          },
          async (parameters) => {
            const reference = parameters.reference;
            const offset = parameters.offset ?? 0;
            if (
              typeof reference !== 'string' ||
              typeof offset !== 'number' ||
              !Number.isSafeInteger(offset) ||
              offset < 0
            ) {
              throw new Error('Tool result read arguments invalid');
            }
            if (!resultSpillStore) throw new Error('Tool result reference unavailable');
            let content: string;
            try {
              content = await resultSpillStore.read(reference);
            } catch {
              throw new Error('Tool result reference unavailable');
            }
            const start = Math.min(offset, content.length);
            const hardChars =
              deps.resultAdmissionLimits?.hardChars ?? DEFAULT_TOOL_RESULT_HARD_CHARS;
            let lower = -1;
            let upper = Math.min(4_000, content.length - start) + 1;
            while (upper - lower > 1) {
              const length = Math.floor((lower + upper) / 2);
              const candidate = {
                content: content.slice(start, start + length),
                totalChars: content.length,
                nextOffset: start + length,
              };
              if (JSON.stringify(candidate).length <= hardChars) lower = length;
              else upper = length;
            }
            if (lower < 0 || (lower === 0 && start < content.length)) {
              throw new Error('Tool result read limit too small');
            }
            return {
              content: content.slice(start, start + lower),
              totalChars: content.length,
              nextOffset: start + lower,
            };
          },
        ),
      );
    }
    return tools;
  }

  async function shutdown(): Promise<void> {
    connectedByServerId.clear();
    try {
      await Promise.all([
        ...openConnections.map((connection) => connection.shutdown()),
        ...(resultSpillStore ? [resultSpillStore.shutdown()] : []),
      ]);
    } finally {
      // After the connections: closing a session may still send one authorized request.
      for (const slot of helperSlots.values()) slot.close();
      helperSlots.clear();
    }
  }

  function subscribeExternalEvent(
    serverId: string,
    listener: TMCPExternalEventListener,
  ): ReturnType<IMcpClientComposition['subscribeExternalEvent']> {
    const connection = connectedByServerId.get(serverId);
    if (!connection?.onExternalEvent) {
      return { ok: false, reason: 'server is not connected for external events' };
    }
    try {
      return { ok: true, unsubscribe: connection.onExternalEvent(listener) };
    } catch {
      return { ok: false, reason: 'server rejected external event subscription' };
    }
  }

  return { activationAdapter, connect, subscribeExternalEvent, shutdown, connectedToolProvenance };
}
