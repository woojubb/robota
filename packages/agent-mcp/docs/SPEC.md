# agent-mcp Specification

## Scope

The MCP (Model Context Protocol) client-side owner for Robota SDK. It owns three things that stay
deliberately separate:

1. **Definitions** (MCP-001) — what an MCP server IS: the raw, validated and resolved forms, source
   provenance and shadow metadata, strict foreign `mcpServers` decoding, environment templates,
   whole-entry precedence, reversible disable overlays, redacted management projections, activation
   identity and fingerprints, and pure list/get/status results. Nothing in this half connects or
   spawns.
2. **Activation** (MCP-2520) — whether a definition may be used: the admission port, exact identity
   matching and a replaceable approval/audit store (`mcp-activation.ts`).
3. **Client, catalog and supervision** (MCP-002, absorbing MCP-003) — the official
   `@modelcontextprotocol/sdk` client behind an admit-then-construct transport seam (`client/`), the
   canonical tools/prompts/resources catalog with provenance, naming and explicit dispositions
   (`catalog/`), and the connection/catalog lifecycle supervisor that owns the package's ONE
   connection-state union (`supervisor/`). Discovered tools enter the runtime through the existing
   generic tool slot (`IToolWithEventService`); no MCP-only runtime path exists.

The package is published as `@robota-sdk/agent-mcp` (MCP-002 cleared its private status on
ADR-005's assignment and the owner's approval of 2026-09-22). It was renamed in place by MCP-001 from
its previous `agent-tool-mcp` identity. The hand-written JSON-RPC path that preceded the SDK client
(`mcp-protocol.ts`, `MCPTool`, `RelayMcpTool`) is removed, not wrapped: it had no discovery, and two
client stacks cannot both be authoritative.

## Boundaries

- Allowed dependencies: `@robota-sdk/agent-core` (sole workspace peer dependency; the shared egress
  policy is imported from its `./node` subpath) and `@modelcontextprotocol/sdk` (runtime dependency,
  `^1.29.0`, the same range every other declaration in the repository uses).
- Must not import `agent-framework`, `agent-session`, `agent-cli`, or any other `agent-*` package.
- Does not own a tool registry or factory. The consumer (composition root or CLI) selects and wires
  tools at construction time; `agent-cli` composes the manager and owns no protocol, catalog, retry or
  policy logic.
- Transport set is **Streamable HTTP and stdio**, behind `IMCPTransportAdapter`
  (admit → construct). Stdio requires an explicit host-owned `IMCPStdioAuthority` and activation
  admission before reading environment values, constructing the SDK transport, or spawning. The
  authority fixes the canonical allowed root, absolute executable and exact argv vectors, environment
  keys and values, a generation, and lifecycle budgets. Definitions cannot grant authority.
  Deprecated HTTP+SSE and custom WebSocket are **refusals** surfaced in the catalog's
  `rejected` bucket with a reason, never adapters and never silent.
- URL admission is the shared egress policy (`rejectDestination` from `@robota-sdk/agent-core/node`):
  `http:` outside loopback, private ranges and cloud-metadata addresses are refused BEFORE any
  connection attempt, and the refusal names the policy's reason. No second admission path exists.
  A redirect is refused rather than followed (`MCPTransportRedirectRefusedError`), so the admitted
  URL is the only URL the transport speaks to and definition headers never travel to a host the
  policy did not admit.
- Stdio requests may specify `cwd`; absent cwd means the authority's allowed root, never the ambient
  process cwd. Decoding, template materialization, projection and definition fingerprint all preserve
  requested cwd. Admission rejects lexical `..`, NUL, non-directory paths, and canonical paths outside
  the canonical root (including symlink escapes). Start rechecks activation and cwd before spawn.
  The check limits but cannot eliminate concurrent filesystem replacement. The official SDK spawns
  with `shell: false`; its default environment merge is countered by explicitly shadowing each
  `DEFAULT_INHERITED_ENV_VARS` key with a host-selected value or an empty string. Empty baseline keys
  remain present in the child. Stderr is piped and drained without publishing raw bytes. Cleanup
  observes direct-child close within a bound; it makes no process-tree termination guarantee.
- MCP activation policy is transport-neutral and host-injected. This package owns the admission port,
  exact identity matching, and a replaceable approval/audit store, but it does not decide workspace
  trust or read project/plugin files. `requiresTrustedWorkspace` is deny-by-default: only `managed`
  and `user` approvals bind to no repository or trust generation; every other source — including any
  member added later — requires a trusted workspace.
- The legacy protocol era is a recorded limit: the pinned SDK generation speaks the pre-2026-07-28
  protocol; a modern-era server that refuses the negotiated version is disconnected, not used.

## Architecture Overview

Single entry point `./` backed by `src/index.ts`.

**`definition/`** (MCP-001) is the pure control plane, one module per stage, and none of them
imports a process, socket or SDK module — asserted by
`src/__tests__/definition-no-side-effects.test.ts` both statically over the import graph and
behaviourally over a full pipeline run.

- `types.ts` — raw / validated / resolved definitions, provenance, shadow records, problems.
- `decode.ts` — strict decoding of a foreign `mcpServers` object. A bad entry is refused and named,
  never partially built; `streamable-http` normalises to `http`; a `url` with no `type` is refused
  rather than read as stdio.
- `env-template.ts` — `${VAR}` and `${VAR:-default}` in `command`, `args`, `cwd`, `env`, `url`, `headers`.
  An unset reference with no default is a reported warning whose literal text survives, because an
  empty substitution would produce a working-looking address that authenticates as nobody.
- `precedence.ts` — whole-entry resolution over `managed > local > project > user > plugin`. Entries
  are never field-merged, every loser is recorded as a shadow, and a malformed winner resolves
  `unresolved` while still shadowing rather than handing its name to a lower-trust source.
- `overlay.ts` — reversible disable. A disabled entry stays listed with its provenance and reason;
  an overlay naming an unknown server is refused.
- `projection.ts` — redacted management projections. `env` and `headers` VALUES never leave; their
  keys do, because "header configured but redacted" and "no header" are different answers. Stdio
  command, argv and cwd are redacted wholesale, including materialized template values.
- `identity.ts` — `definitionFingerprint` over what will run, `securityIdentity` over where it came
  from. Secret values are never hashed, so rotating a token does not invalidate an approval.
  **Contained — SECURITY-2793 (issue #2793):** only env/header KEYS are covered, so changing an
  execution-controlling VALUE such as `NODE_OPTIONS` leaves an approval valid for other transports.
  Stdio rejects execution-controlling environment keys and requires requested values to match the
  host authority; command and argv projections are redacted.
- `registry.ts` — `MCPDefinitionRegistry`, the producer `MCPActivationController` was written
  against and never had. It offers only resolved, enabled entries as activation requests.

**`management/results.ts`** returns pure `list` / `get` / `status` values over a resolved set.
`get` on an unknown name returns a typed not-found rather than throwing.

**`mcp-activation.ts`** owns the reusable trust boundary. `MCPActivationAdmissionService` matches an
approval only when server id, source/provenance, definition fingerprint, security identity, and, for
every source outside the not-required allowlist (`managed`, `user`), repository identity and workspace
generation all match. It refuses project/plugin self-approval and exposes `approve`, `reject`,
`revoke`, `inspect`, and `listAudit` through injected storage. `MCPActivationController` adapts a
definition registry into the command-layer's structural list/approve/reject/revoke port; status
inspection never connects.

**`client/`** (MCP-002/MCP-2522) is the official-SDK seam:

- `transport.ts` — **admit, then construct.** `IMCPTransportAdapter<TInput, TAdmitted>` pairs a typed
  admission step with a constructor that accepts only what admission produced. `admitHttpEndpoint`
  runs the shared egress policy with an injectable hostname lookup; `constructStreamableHttpTransport`
  builds the SDK `StreamableHTTPClientTransport`, which is inert until a `Client` connects it.
- `stdio.ts` — consumes activation first, checks request identity, then validates host-owned root,
  cwd containment, absolute executable and exact argv, environment keys and host-selected values,
  and bounds. It returns an opaque admitted capability. Construct is inert; every start rechecks
  activation, authority generation, executable, environment and canonical cwd/root.
- `stdio-transport.ts` — wraps the official `StdioClientTransport` through its public API. It shadows
  all SDK default inherited environment keys, pipes and drains stderr into a bounded count, captures
  the actual negotiated protocol version, and waits for direct-child close after SDK shutdown.
- `session.ts` — one initialized protocol session: `openMcpSession` connects the SDK `Client` within
  `startupMs`, verifies the negotiated `protocolVersion` against `SUPPORTED_MCP_PROTOCOL_VERSIONS`
  (else closes and throws `unsupported-protocol-version`), and exposes the negotiated facts —
  identity, `instructions`, declared capabilities — plus `discover`, `callTool`, `onListChanged` and
  an idempotent `close`. A session is **stateless about liveness** by contract.
  Stdio startup includes spawn and initialize within the smaller of caller and host budgets. Abort,
  timeout and failed initialization await bounded cleanup; raw SDK errors are not surfaced. The SDK
  has no cancellation acknowledgment, so abort or timeout of an active stdio request closes the
  direct child after its cancellation notification. Tool calls are never replayed by the supervisor.
  A stdio supervisor opts into `awaitOpenCleanupOnTimeout`: startup failure and shutdown await the
  open session's bounded cleanup before returning or retrying. HTTP keeps its existing timeout
  behavior. A failed stdio cleanup is a secret-free `config` failure requiring manual retry, and
  shutdown surfaces that failure. Once an active stdio request closes its session, the supervisor
  drops that session and
  returns to idle; a later request may open a new session, but the failed tool call is never replayed.
- `discovery.ts` — the caller-owned cursor loop. A capability the server did not declare is
  `unsupported` and its list method is never called; a declared one is drained page by page until
  `nextCursor` is absent, bounded by `maxPages` and a per-request timeout. An invalid cursor
  (`-32602`), an exceeded bound or a timeout is a named `MCPDiscoveryError`; a partial catalog is never
  reported as complete.

**`catalog/`** turns discoveries into the one exposure decision:

- `types.ts` — the shared vocabulary: three-valued `TMCPCapabilityState` (`unsupported` /
  `supported` with `count`, where `count: 0` is "declared, empty"), discovery results, catalog entries
  with `IMCPCatalogProvenance`, the `adopted` / `adapted` / `rejected` dispositions, rejections that
  always carry a reason, and `IMCPCatalogIdentity` for last-known-good binding.
- `naming.ts` — unconditional `<server-id>__<tool-name>` prefix, sanitised to `[A-Za-z0-9_-]`,
  deterministically middle-truncated to a 64-character budget; residual collisions resolve
  deterministically and the loser is `rejected` with its reason. Claude Code's scheme over
  first-come-wins, because an exposed name must not depend on registration order.
- `build.ts` — `buildCatalog` over per-server inputs: unsupported transports (`sse`, `ws`) are
  rejected servers; every tool's `inputSchema` is narrowed ONCE at registration through
  `narrowToUniversalSubset` (CORE-040), the dropped paths reported once per tool; renamed, truncated or
  narrowed entries are `adapted` with the reason, untouched ones `adopted`.
- `discovered-tool.ts` — `createDiscoveredTool` adapts a catalog tool entry to
  `IToolWithEventService`, the runtime's existing generic tool slot: validation through
  `ThirdPartySchemaValidator` over the narrowed schema, execution through the supervisor's `callTool`,
  and a retained event service. Nothing MCP-specific is added to `agent-framework`.
- `universal-value.ts` — `toUniversalValue` / `toUniversalObject`: the ONE conversion from an SDK
  payload (`unknown` JSON) onto the core value axis (`TUniversalValue` / `IUniversalObjectValue`), so
  tool arguments, results, `structuredContent` and `outputSchema` are typed on the SSOT axis everywhere
  past that boundary.

**`supervisor/connection.ts`** (absorbs MCP-003) owns open / reuse / close, all retry state and the
package's single connection-state union `TMCPConnectionState`
(`idle | connecting | connected | failed | closed`); the `failed` member carries its
`TMCPFailureClass` (`transient | auth | config | not-found`) so callers read a classification rather
than re-deriving one. Only `transient` failures are retried, under bounded exponential backoff on an
injected clock, moving `failed{retry: 'pending'}` → `failed{retry: 'manual-retry'}` at the bound
rather than looping. Five timeouts — `startupMs`, `perCallMs`, `globalDefaultMs`, `idleMs`, `toolCallMs`
— are distinct typed settings; `toolCallMs` is the budget of one `callTool` request, forwarded to the
SDK request in place of `perCallMs`, which keeps bounding discovery and protocol calls. A `list_changed`
notification marks that domain stale and refreshes it over
the live session without reconnecting; a failed refresh keeps the last-known-good catalog with `stale`
and the error rather than emptying it. The retained catalog is bound to an explicit
`IMCPCatalogIdentity` (server id, negotiated protocol version, server version); a reconnect whose
identity differs invalidates it, and nothing is inferred from a session id. `shutdown()` cancels every
armed timer and closes the transport, leaving no live request.

## Type Ownership

This package is SSOT for the following types. Types marked **public** are exported from the `.` entry point; others are internal.

- `IMCPActivationRequest` / `IMCPActivationAdmission` — exact activation identity and admission port (**public**).
- `MCPActivationAdmissionService` / `MCPActivationController` — policy and registry adapter (**public**).
- `IMCPActivationApprovalStore` / `InMemoryMCPActivationApprovalStore` — replaceable approval/audit persistence (**public**).
- `IMCPActivationDefinitionRegistry` / `IMCPActivationSummary` — definition discovery and secret-free command projection (**public**).
- `MCPActivationPolicyError` / `createFailClosedMCPActivationAdmission` — typed policy failure and deny-by-default fallback (**public**).

- `IMCPTransportAdapter`, `TMCPTransportAdmission`, `IMCPHttpEndpoint`, `IMCPAdmittedHttpEndpoint`, `IMCPHttpTransportDeps` — the admit-then-construct transport seam (**public**).
- `IMCPStdioInput`, `IMCPAdmittedStdioEndpoint`, `IMCPStdioAuthority`, `IMCPStdioExecutable`, `IMCPStdioAdapterOptions`, `MCPStdioError` — host-owned stdio authority and secret-free failure surface (**public**).
- `IMCPSession`, `IMCPOpenSessionOptions`, `IMCPSessionTimeouts`, `IMCPDiscoverOptions`, `IMCPToolCallResult`, `MCPSessionError`, `SUPPORTED_MCP_PROTOCOL_VERSIONS` — one initialized protocol session and its negotiated facts (**public**).
- `IMCPDiscovery`, `IMCPDiscoveryDomainResult`, `TMCPCapabilityState`, `TMCPCapabilityDomain`, `IMCPServerIdentity`, `MCPDiscoveryError`, `IMCPDiscoveryFailure` — what a server disclosed (**public**).
- `IMCPCatalog`, `TMCPCatalogEntry`, `IMCPCatalogToolEntry`, `IMCPCatalogPromptEntry`, `IMCPCatalogResourceEntry`, `IMCPCatalogRejection`, `IMCPCatalogServerEntry`, `IMCPCatalogProvenance`, `TMCPCatalogDisposition`, `IMCPCatalogIdentity`, `MCP_CANONICAL_NAME_BUDGET` — the canonical catalog and its dispositions (**public**).
- `TMCPConnectionState` — THE connection-state union; the only one under `src/**` (**public**); `TMCPFailureClass`, `IMCPTimeouts`, `IMCPBackoffPolicy`, `IMCPSupervisorClock`, `IMCPLastKnownGood`, `IMCPConnectionSupervisorOptions` (**public**).

All `ITool`-related types (`ITool`, `IToolResult`, `IToolExecutionContext`, `TToolParameters`, `IParameterValidationResult`, `IToolSchema`) are owned by `@robota-sdk/agent-core`.

## Public API Surface

| Export                                   | Kind      | Description                                                                                            |
| ---------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `MCPActivationAdmissionService`          | class     | Exact-identity approval/rejection/revocation policy and status inspection                              |
| `MCPActivationController`                | class     | Definition-registry adapter for status and typed lifecycle decisions                                   |
| `InMemoryMCPActivationApprovalStore`     | class     | In-memory approval/audit store for tests and ephemeral hosts                                           |
| `createFailClosedMCPActivationAdmission` | function  | Deny-by-default admission fallback when a host has not composed trust policy                           |
| `MCPActivationPolicyError`               | class     | Typed refusal for invalid approval, rejection, or revocation authority transitions                     |
| `IMCPActivationRequest`                  | interface | Secret-free exact definition/provenance/security identity plus workspace trust snapshot                |
| `IMCPActivationAdmission`                | interface | Reusable `inspect`/`admit` port called before every MCP connection/use                                 |
| `IMCPActivationApprovalRecord`           | interface | Secret-free exact approval record bound to a definition and workspace identity                         |
| `IMCPActivationApprovalStore`            | interface | Replaceable approval and audit persistence port                                                        |
| `IMCPActivationAuditEvent`               | interface | Secret-free auditable approval lifecycle event                                                         |
| `IMCPActivationDefinitionRegistry`       | interface | Definition discovery port used by the activation controller                                            |
| `IMCPActivationProvenance`               | interface | Source provenance identity carried into activation admission                                           |
| `IMCPActivationStatusResult`             | interface | Secret-free admission status and denial reason                                                         |
| `IMCPActivationSummary`                  | interface | Secret-free definition status projection for command consumers                                         |
| `IMCPActivationWorkspace`                | interface | Repository identity, trust state, and generation supplied to admission                                 |
| `TMCPActivationSource`                   | type      | Activation source classification (`managed`, `user`, `project`, `plugin`, or `local`)                  |
| `TMCPActivationStatus`                   | type      | Public admission status classification                                                                 |
| `TMCPApprovalAuthority`                  | type      | Authority classification for approval lifecycle mutations                                              |
| `TMCPWorkspaceTrustState`                | type      | Workspace trust and availability state classification                                                  |
| `narrowToUniversalSubset`                | function  | CORE-040: narrow a third-party schema to the part the universal subset can enforce, reporting the rest |
| `ThirdPartySchemaValidator`              | class     | CORE-040: the parameter validator BOTH tool classes use — one owner for the trust-boundary decision    |
| `INarrowedSchema`                        | interface | `{ schema, unenforceable }` — the enforceable copy and the paths dropped from it                       |
| `TUnenforceableSchemaReporter`           | type      | `(toolName, paths) => void` — told once per tool when part of its schema cannot be enforced            |

### Definition control plane (MCP-001)

| Export                          | Kind      | Description                                                                                         |
| ------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `decodeSource`                  | function  | Decode one foreign `mcpServers` container into definitions and named refusals                       |
| `decodeEntry`                   | function  | Decode one raw entry; returns the definition or the problem that stopped it, never a partial        |
| `readRawEntries`                | function  | Split a container into named raw entries, reporting container-level problems once                   |
| `IMCPDecodeResult`              | interface | `{ definitions, problems }` returned by `decodeSource`                                              |
| `materializeDefinition`         | function  | Expand `${VAR}` / `${VAR:-default}` in `command`, `args`, `env`, `url`, `headers`                   |
| `IMCPEnvironment`               | interface | The environment map materialization reads; never `process.env` directly                             |
| `MCP_SOURCE_PRECEDENCE`         | const     | `managed > local > project > user > plugin`, highest first                                          |
| `resolveByPrecedence`           | function  | Whole-entry resolution; records shadows and keeps a malformed winner `unresolved`                   |
| `IMCPSourceCandidates`          | interface | One source's decode output, tagged with its source and origin                                       |
| `applyDisableOverlay`           | function  | Apply a reversible disable overlay; refuses an unknown server name                                  |
| `clearDisable`                  | function  | Remove the overlay from one entry, restoring what precedence produced                               |
| `isDisabled`                    | function  | Whether an entry currently carries a disable overlay                                                |
| `IMCPDisableOverlay`            | interface | `{ disabled? }` — server names to disable with the reason shown beside each                         |
| `MCPOverlayError`               | class     | Typed refusal for an overlay naming a server that does not exist                                    |
| `projectEntry`                  | function  | Redacted projection of one entry; `env`/`headers` values become `[REDACTED]`, keys survive          |
| `projectEntries`                | function  | The same projection over a whole resolved set, in order                                             |
| `REDACTED`                      | const     | The redaction marker a projection substitutes for a secret value                                    |
| `IMCPDefinitionProjection`      | interface | A definition as it may be shown; env/header values and stdio command/argv/cwd redacted              |
| `definitionFingerprint`         | function  | Hash over what will run or be contacted; secret VALUES are never hashed                             |
| `securityIdentity`              | function  | Hash over name, source and origin — which configured subject this is                                |
| `activationIdentity`            | function  | Both ids for one entry, or `null` when it is unresolved                                             |
| `IMCPActivationIdentity`        | interface | `{ serverId, definitionFingerprint, securityIdentity }`                                             |
| `MCPDefinitionRegistry`         | class     | `IMCPActivationDefinitionRegistry` over a resolved set; offers only resolved, enabled entries       |
| `IMCPDefinitionRegistryOptions` | interface | Workspace trust snapshot passed through to admission unchanged                                      |
| `listServers`                   | function  | Every configured server, projected                                                                  |
| `getServer`                     | function  | One server by name, or a typed not-found carrying the names that exist                              |
| `statusOf`                      | function  | Counts (total, resolved, unresolved, disabled, unset-variable) plus the projected set               |
| `IMCPListResult`                | interface | `{ servers }` returned by `listServers`                                                             |
| `IMCPStatusResult`              | interface | Counts plus the projected set returned by `statusOf`                                                |
| `TMCPGetResult`                 | type      | `{ found: true, server }` or `{ found: false, name, knownNames }`                                   |
| `IMCPServerDefinitionRaw`       | interface | An entry exactly as read, before validation                                                         |
| `IMCPServerDefinition`          | interface | A decoded entry; environment templates not yet materialized                                         |
| `IMCPServerDefinitionResolved`  | interface | A materialized definition plus the references that had no value                                     |
| `IMCPResolvedEntry`             | interface | One server name's outcome: winner, status, shadows, and any disable reason                          |
| `IMCPDefinitionProblem`         | interface | Why a name could not produce a usable definition                                                    |
| `IMCPDefinitionShadow`          | interface | An entry a winner hid, with its own source and origin                                               |
| `IMCPUnsetVariable`             | interface | An unset `${VAR}`: the variable, the exact field, and the literal left in place                     |
| `TMCPDefinitionSource`          | type      | An alias of `TMCPActivationSource`, NOT a second union — one declaration cannot diverge from itself |
| `TMCPTransport`                 | type      | `stdio \| http \| sse \| ws`; `streamable-http` normalises to `http`                                |

### Client, catalog and supervision (MCP-002)

| Export                             | Kind      | Description                                                                                                                                                                                 |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admitHttpEndpoint`                | function  | Admit a Streamable HTTP endpoint through the shared egress policy BEFORE any connection; refusal names the policy's reason                                                                  |
| `constructStreamableHttpTransport` | function  | Build the SDK `StreamableHTTPClientTransport` from an ADMITTED endpoint only; inert until a `Client` connects it                                                                            |
| `MCPTransportRedirectRefusedError` | class     | Thrown by the transport's fetch wrapper on any 3xx; carries `status` and `location`                                                                                                         |
| `createStreamableHttpAdapter`      | function  | HTTP `IMCPTransportAdapter` (`admit` → `construct`)                                                                                                                                         |
| `createStdioAdapter`               | function  | Stdio `IMCPTransportAdapter`; consumes activation and host authority, returns an opaque admitted capability                                                                                 |
| `IMCPStdioAuthority`               | interface | Allowed root, generation, absolute executable/exact argv vectors, environment values and keys, startup/cleanup bounds                                                                       |
| `IMCPStdioInput`                   | interface | Resolved definition plus matching activation request                                                                                                                                        |
| `IMCPAdmittedStdioEndpoint`        | interface | Opaque adapter-bound admission; cannot be constructed by a different adapter                                                                                                                |
| `MCPStdioError`                    | class     | Secret-free authority, start, early-exit, send, cancelled or cleanup failure                                                                                                                |
| `IMCPTransportAdapter`             | interface | Admit-then-construct seam: `kind`, `admit(input)`, `construct(admitted)`                                                                                                                    |
| `TMCPTransportAdmission`           | type      | `{ ok: true, admitted }` or `{ ok: false, reason, message }` — a typed refusal, never a guess                                                                                               |
| `TMCPTransportKind`                | type      | `'streamable-http'                                                                                                                                                                          | 'stdio'`   |
| `IMCPHttpEndpoint`                 | interface | `url` + optional `headers` handed to admission                                                                                                                                              |
| `IMCPAdmittedHttpEndpoint`         | interface | What admission produced: parsed `URL` and headers; the only input `construct` accepts                                                                                                       |
| `IMCPHttpTransportDeps`            | interface | Injectable egress `policy`, hostname `lookup` (tests never touch DNS) and `fetch`                                                                                                           |
| `openMcpSession`                   | function  | Connect the SDK `Client` within `startupMs`, verify the negotiated protocol version, return an `IMCPSession`                                                                                |
| `IMCPSession`                      | interface | One initialized session: identity, instructions, declared capabilities, `discover`, `callTool`, `onListChanged`, idempotent `close`; stateless about liveness                               |
| `IMCPOpenSessionOptions`           | interface | `serverId`, an already-admitted `transport`, optional `clientInfo`, `timeouts`, `signal`                                                                                                    |
| `IMCPSessionTimeouts`              | interface | `startupMs` (initialize + initialized) and `perCallMs` (each request)                                                                                                                       |
| `IMCPDiscoverOptions`              | interface | `maxPages` bound, `perRequestTimeoutMs`, optional `signal`                                                                                                                                  |
| `IMCPToolCallResult`               | interface | `content: IUniversalObjectValue[]`, optional `structuredContent: IUniversalObjectValue`, `isError` — the session's one conversion of the SDK result onto the core value axis                |
| `TMCPListChangedListener`          | type      | `(domain) => void`, fired on `notifications/<domain>/list_changed`                                                                                                                          |
| `MCPSessionError`                  | class     | `unsupported-protocol-version` (server closed, not used), `initialize-failed`, `startup-timeout`                                                                                            |
| `SUPPORTED_MCP_PROTOCOL_VERSIONS`  | const     | The legacy-era versions this client accepts; a server outside the set is disconnected                                                                                                       |
| `IMCPDiscovery`                    | interface | Everything one session disclosed: identity, instructions, per-domain results                                                                                                                |
| `IMCPDiscoveryDomainResult`        | interface | `state` (three-valued), `items`, `pages`                                                                                                                                                    |
| `TMCPCapabilityState`              | type      | `unsupported` (never called) or `supported` with `count` (`0` = declared, empty) and `listChanged`                                                                                          |
| `TMCPCapabilityDomain`             | type      | `'tools'                                                                                                                                                                                    | 'prompts'  | 'resources'` |
| `IMCPServerIdentity`               | interface | `serverId`, `serverName`, `serverVersion`, `protocolVersion`                                                                                                                                |
| `IMCPDiscoveredTool`               | interface | A tool as the server listed it (`inputSchema` unnarrowed)                                                                                                                                   |
| `IMCPDiscoveredPrompt`             | interface | A prompt as listed, with `arguments`                                                                                                                                                        |
| `IMCPDiscoveredPromptArgument`     | interface | Prompt argument `name`, `description`, `required`                                                                                                                                           |
| `IMCPDiscoveredResource`           | interface | A resource as listed: `uri`, `name`, `mimeType`                                                                                                                                             |
| `MCPDiscoveryError`                | class     | A named domain failure: `invalid-cursor` (`-32602`), `page-bound-exceeded`, `timeout`, `protocol`; a partial catalog is never reported complete                                             |
| `IMCPDiscoveryFailure`             | interface | `kind`, `domain`, `message`, JSON-RPC `code`, `pagesSeen`                                                                                                                                   |
| `TMCPDiscoveryFailureKind`         | type      | The four discovery failure kinds                                                                                                                                                            |
| `buildCatalog`                     | function  | Per-server inputs → the one exposure decision: `servers`, `adopted`, `adapted`, `rejected` (always with reasons); CORE-040 narrowing applied once per tool                                  |
| `IMCPCatalogInput`                 | interface | `serverId`, `origin`, `transport` (`sse`/`ws` are rejected servers), optional `discovery`                                                                                                   |
| `IMCPCatalog`                      | interface | `servers`, `adopted`, `adapted`, `rejected`                                                                                                                                                 |
| `TMCPCatalogEntry`                 | type      | Tool, prompt or resource entry                                                                                                                                                              |
| `IMCPCatalogToolEntry`             | interface | Canonical name, source name, NARROWED `schema`, `unenforceablePaths`, provenance, disposition + reason                                                                                      |
| `IMCPCatalogPromptEntry`           | interface | Canonical name, arguments, provenance, disposition                                                                                                                                          |
| `IMCPCatalogResourceEntry`         | interface | Canonical name, `uri`, `mimeType`, provenance, disposition                                                                                                                                  |
| `IMCPCatalogRejection`             | interface | `kind` (server/tool/prompt/resource), `serverId`, `name`, `reason`                                                                                                                          |
| `IMCPCatalogServerEntry`           | interface | Per-server identity, instructions and three-valued capabilities                                                                                                                             |
| `IMCPCatalogProvenance`            | interface | `serverId`, `serverName`, `serverVersion`, `protocolVersion`, `origin`                                                                                                                      |
| `TMCPCatalogDisposition`           | type      | `'adopted'                                                                                                                                                                                  | 'adapted'  | 'rejected'`  |
| `IMCPCatalogIdentity`              | interface | What a retained catalog is bound to: server id + protocol version + server version                                                                                                          |
| `catalogIdentityOf`                | function  | `IMCPServerIdentity` → `IMCPCatalogIdentity`                                                                                                                                                |
| `sameCatalogIdentity`              | function  | Field-wise identity comparison used to invalidate last-known-good on reconnect                                                                                                              |
| `TMCPCanonicalName`                | type      | `<server-id>__<tool-name>`, sanitised and budgeted                                                                                                                                          |
| `MCP_CANONICAL_NAME_BUDGET`        | const     | `64` — the exposed-name budget                                                                                                                                                              |
| `canonicalName`                    | function  | Unconditional prefix, `[A-Za-z0-9_-]` sanitisation, deterministic middle-truncation; reports whether and why the name changed                                                               |
| `resolveNameCollisions`            | function  | Deterministic collision resolution; losers carry a reason and are rejected by the builder                                                                                                   |
| `createDiscoveredTool`             | function  | Adapt a catalog tool entry to `IToolWithEventService` (the generic runtime slot): CORE-040 validation over the narrowed schema, execution through the supervisor                            |
| `IMCPToolInvoker`                  | interface | The narrow supervisor shape `createDiscoveredTool` needs: `callTool(name, args: TToolParameters, { signal })`                                                                               |
| `ICreateDiscoveredToolOptions`     | interface | Optional `report` (`TUnenforceableSchemaReporter`) for the adapter                                                                                                                          |
| `IBuildCatalogOptions`             | interface | Optional `report` for `buildCatalog`'s once-per-tool narrowing report                                                                                                                       |
| `INameCollisionCandidate`          | interface | `{ key, name }` handed to `resolveNameCollisions`                                                                                                                                           |
| `MCPConnectionSupervisor`          | class     | Open / reuse / close, bounded retry, `list_changed` refresh without reconnecting, last-known-good with identity, five typed timeouts, `shutdown`                                            |
| `IMCPConnectionSupervisorOptions`  | interface | `serverId`, `openSession(signal)`, `timeouts`, optional `backoff`, `clock`, `discovery.maxPages`, `onStateChange`, `awaitOpenCleanupOnTimeout` for stdio                                    |
| `TMCPConnectionState`              | type      | THE connection-state union: `idle                                                                                                                                                           | connecting | connected    | failed                                   | closed`; `failed`carries`classification`, `attempt`, `retry` |
| `TMCPFailureClass`                 | type      | `'transient'                                                                                                                                                                                | 'auth'     | 'config'     | 'not-found'`— only`transient` is retried |
| `IMCPTimeouts`                     | interface | `startupMs`, `perCallMs`, `globalDefaultMs`, `idleMs`, `toolCallMs` — five independent settings; `toolCallMs` bounds one `callTool` request, distinct from `perCallMs` (discovery/protocol) |
| `IMCPBackoffPolicy`                | interface | `initialMs`, `maxMs`, `factor`, `maxAttempts`                                                                                                                                               |
| `DEFAULT_MCP_BACKOFF`              | const     | 500 ms × 2 up to 30 s, five attempts                                                                                                                                                        |
| `IMCPSupervisorClock`              | interface | Injectable `now` / `setTimeout` / `clearTimeout` so retry timing is deterministic under a fake clock                                                                                        |
| `IMCPLastKnownGood`                | interface | Retained discovery, its identity, per-domain `stale` flags and the last classified error                                                                                                    |
| `MCPSupervisorError`               | class     | Thrown by `callTool` / `discover` / `refresh` carrying the `TMCPFailureClass` so callers read one classification                                                                            |
| `classifyMcpFailure`               | function  | One classifier for every thrown failure (auth / not-found / config / transient)                                                                                                             |

## Extension Points

- `IMCPHttpTransportDeps.policy` / `.lookup` / `.fetch` — the egress policy, the hostname resolver
  (tests inject one so no DNS is touched) and the fetch the SDK transport uses. Admission runs before
  construction; nothing in this seam opens a connection.
- `IMCPTransportAdapter` — a second transport is a second value of this type with its own admission
  (the stdio adapter admits an executable, exact argv, host environment values and a cwd authority).
- `IMCPOpenSessionOptions.clientInfo` / `.timeouts` — the client identity sent at `initialize` and the
  startup / per-call budgets; `SUPPORTED_MCP_PROTOCOL_VERSIONS` is the accepted set.
- `IMCPDiscoverOptions.maxPages` / `.perRequestTimeoutMs` — the page bound and per-request budget of the
  caller-owned cursor loop.
- `buildCatalog(inputs, { report })` and `createDiscoveredTool(entry, invoker, { report })` — the
  `TUnenforceableSchemaReporter` told once per tool when CORE-040 narrowing drops paths; omitting it
  logs a warning, it is never silent.
- `IMCPConnectionSupervisorOptions.timeouts` / `.backoff` / `.clock` / `.onStateChange` /
  `.discovery.maxPages` — five independent timeouts, the bounded backoff policy, an injectable clock,
  a state-transition observer, and the discovery page bound.
- `MCPActivationAdmissionService` — inject a durable store and clock. Every source outside the
  not-required allowlist (`managed`, `user`) requires `workspace.trustState === 'trusted'`;
  project/plugin authority cannot approve itself; changed provenance, definition fingerprint, security
  identity, repository, or trust generation is stale.

## Parameter Validation Across the Third-Party Trust Boundary (CORE-040)

An MCP tool's `inputSchema` is authored by a **third-party server**, and `parameters` is the contract
the model is shown. Both tool classes previously hand-rolled the same check — presence of the
schema's TOP-LEVEL `required` keys, and nothing else. No types, no enums, no bounds, no nested
traversal, and two character-identical copies of the decision. A payload with the right key names and
entirely wrong values reached the tool handler unchallenged.

Both now route through `ThirdPartySchemaValidator`, which is the single owner, and through
`validateAgainstJsonSchema` — the one complete walk over the universal subset (CORE-039).

**A schema the subset cannot express is NARROWED, not refused.** The walk rejects a node outside the
subset (`unsupported schema type`, or `declares neither a type nor anyOf` for `oneOf` / `allOf` /
`$ref`). Handing a third-party schema to it unchanged would refuse _every_ payload for that tool,
breaking a working tool over a limitation that is this repo's rather than the server's. So:

1. Inexpressible property subtrees are replaced with an accepts-anything `anyOf` node — **replaced,
   not deleted**, because an object node declaring `properties` is CLOSED, so deleting a key would
   turn the server's own declared parameter into an "unexpected additional property" and refuse the
   payload for the opposite reason.
2. `required` is carried through untouched. A narrowed property is one whose VALUE cannot be checked,
   not one that stopped being required — an omitted key is still an error.
3. Everything expressible is enforced completely, including nested objects and array items.
4. The dropped paths are **reported** — once per tool, not once per call, since narrowing is a pure
   function of a schema that does not change. Silence here would be a downgrade nobody could see
   (`enforcement-architecture.md`).

## Error Taxonomy

| Source                             | Error / Condition                                                                               | Trigger                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `admitHttpEndpoint`                | `{ ok: false, reason: 'invalid-url' }`                                                          | The endpoint is not a URL                                                                                                                                    |
| `admitHttpEndpoint`                | `{ ok: false, reason: 'egress-policy:<reason>' }`                                               | `http:` outside loopback, private range, cloud metadata or a policy-blocked host — BEFORE any connection                                                     |
| `constructStreamableHttpTransport` | `MCPTransportRedirectRefusedError`                                                              | Any 3xx from the admitted URL; classified `config` by `classifyMcpFailure`                                                                                   |
| `createStdioAdapter.admit`         | `{ ok: false, reason }`                                                                         | Identity, activation, authority, cwd, executable, argv or environment refusal before spawn; no raw values in reason/message                                  |
| `MCPStdioTransport`                | `MCPStdioError`                                                                                 | Start, send, cancellation or cleanup failure; direct-child close observed and raw SDK/stderr text withheld                                                   |
| `openMcpSession`                   | `MCPSessionError('unsupported-protocol-version')`                                               | Negotiated version outside `SUPPORTED_MCP_PROTOCOL_VERSIONS`; the client is closed first                                                                     |
| `openMcpSession`                   | `MCPSessionError('startup-timeout')`                                                            | `initialize` + `notifications/initialized` exceed `startupMs`                                                                                                |
| `openMcpSession`                   | `MCPSessionError('initialize-failed')`                                                          | Any other connect failure, or a server that reports no `serverInfo`                                                                                          |
| `IMCPSession.discover`             | `MCPDiscoveryError` — `invalid-cursor` (`-32602`), `page-bound-exceeded`, `timeout`, `protocol` | A list request fails, the bound is exceeded or a request times out; a partial catalog is never returned as complete                                          |
| `buildCatalog`                     | `rejected` entry with `reason` (never a throw)                                                  | Unsupported transport (`sse`, `ws`), a name lost to a collision                                                                                              |
| `MCPConnectionSupervisor`          | `TMCPConnectionState` `failed { classification, retry }`                                        | Open/refresh/call failed; `transient` arms a bounded backoff (`pending`), the bound reached → `manual-retry`; other classes never retry                      |
| `MCPConnectionSupervisor`          | `MCPSupervisorError` (carries `classification`)                                                 | `callTool` / `discover` / `refresh` failure, or use after `shutdown`                                                                                         |
| `MCPConnectionSupervisor`          | `lastRefreshFailure` (`{ domain, message, at } \| undefined`)                                   | A `list_changed` refresh that failed with no caller awaiting it: the domain stays `stale`, and the failure is recorded as readable state rather than dropped |
| `createDiscoveredTool`             | `IToolResult { success: false, error }`                                                         | The server answered `isError: true`, or the supervisor threw — reported in the result envelope the runtime slot expects, never swallowed                     |
| Activation                         | `MCPActivationPolicyError`                                                                      | Invalid approval / rejection / revocation authority transition                                                                                               |
| Definition overlay                 | `MCPOverlayError`                                                                               | An overlay names an unknown server                                                                                                                           |

## Test Strategy

Tests live in `src/__tests__/` (Vitest) and run against the in-process `node:http` mock MCP server
(`mock-mcp-server.ts`), which now speaks paginated `tools/list` / `prompts/list` / `resources/list`
with opaque cursors, declared-vs-absent capabilities, an invalid-cursor and an endless-cursor mode,
server-pushed `list_changed` over a Streamable HTTP SSE response, and 401 / 404 / 5xx knobs. Every
spec criterion (TC-NN) names the file that proves it and the change that turns it red.

| Area                      | Test file(s)                                                                                                                                                                                                                                                    | Coverage                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition control plane  | `definition-*.test.ts`, `management-results.test.ts`                                                                                                                                                                                                            | MCP-001: decode, templates, precedence, overlay, projection, identity, no side effects                                                                                                                                                                                                                                                                                                         |
| Activation admission      | `mcp-activation.test.ts`, `host-admission-trust-binding.test.ts`                                                                                                                                                                                                | Exact identity, staleness, self-approval; untrusted workspace refused, rotated generation invalidates, deny-by-default for an unknown source (TC-29)                                                                                                                                                                                                                                           |
| Session                   | `client-initialize.test.ts`                                                                                                                                                                                                                                     | Negotiated facts stored; unsupported version closed, not used (TC-01)                                                                                                                                                                                                                                                                                                                          |
| Discovery                 | `client-pagination.test.ts`, `discovery-bounds.test.ts`                                                                                                                                                                                                         | Three pages drained, absent cursor ends, `-32602` named (TC-02); page bound and per-request timeout (TC-19)                                                                                                                                                                                                                                                                                    |
| URL admission             | `client-url-admission.test.ts`                                                                                                                                                                                                                                  | Private / metadata / non-loopback `http:` refused before any fetch (TC-05)                                                                                                                                                                                                                                                                                                                     |
| Stdio authority/lifecycle | `stdio-admission.test.ts`, `stdio-integration.test.ts`, `stdio-supervisor-cleanup.test.ts`                                                                                                                                                                      | Identity/activation, cwd traversal/symlink refusal, real SDK discovery/call, stderr drain, early exit, cancellation, direct-child close observation, and late cleanup failure propagation                                                                                                                                                                                                      |
| Catalog                   | `catalog-naming.test.ts`, `catalog-capability.test.ts`, `catalog-dispositions.test.ts`, `catalog-provenance.test.ts`, `catalog-schema-narrowing.test.ts`                                                                                                        | Naming and collisions (TC-03); three-valued capabilities (TC-04); rejected transports (TC-07); provenance and buckets (TC-18); CORE-040 narrowing keeps a caller (TC-30)                                                                                                                                                                                                                       |
| Runtime tool slot         | `dynamic-tool-registration.test.ts`, `tool-006-registrable.test.ts`, `third-party-schema-enforcement.test.ts`                                                                                                                                                   | Generic registration with no MCP-only branch (TC-08); event service retained; CORE-040 enforcement through the discovered tool                                                                                                                                                                                                                                                                 |
| Supervisor                | `connection-supervisor.test.ts`, `canonical-failed-state.test.ts`, `failure-classification.test.ts`, `reconnect-backoff.test.ts`, `last-known-good.test.ts`, `timeout-semantics.test.ts`, `shutdown-no-live-requests.test.ts`, `catalog-cache-identity.test.ts` | Lifecycle and `list_changed` (TC-09); failed value carries its class (TC-10); four classes, transient-only retry (TC-13); bounded backoff under a fake clock (TC-14); last-known-good kept on failed refresh (TC-15); five independent timeouts, including `toolCallMs` bounding only `callTool` (TC-16); no live request or armed timer after shutdown (TC-17); identity invalidation (TC-22) |
| Connection-state SSOT     | `connection-state-type.test.ts` (via `tsgo --noEmit`), `single-connection-state-union.test.ts` (TypeScript compiler API over `src/**`)                                                                                                                          | The `failed` member is required by the type (TC-23); exactly one connection-state union in the package (TC-24)                                                                                                                                                                                                                                                                                 |
| Scenario                  | `examples/verify-mcp-client.ts` via `pnpm scenario:verify:mcp-client`                                                                                                                                                                                           | End-to-end product path over the mock server, isolated `HOME`; prints one `result=` line (TC-20)                                                                                                                                                                                                                                                                                               |
| Stdio scenario            | `examples/verify-stdio-transport.ts` via `pnpm scenario:verify:stdio-transport --allowed/--denied`                                                                                                                                                              | Real child discovery/call and zero-spawn denied mode with isolated `HOME`                                                                                                                                                                                                                                                                                                                      |

## Class Contract Registry

### Interface Implementations

| Interface                                         | Implementor                                                                 | Location                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `IToolWithEventService` (core)                    | `DiscoveredMCPTool` (via `createDiscoveredTool`)                            | `src/catalog/discovered-tool.ts` (declared `implements IToolWithEventService`; no `AbstractTool`, to avoid the circular runtime dependency) |
| `IMCPTransportAdapter` (this package)             | Streamable HTTP and stdio adapter values                                    | `src/client/transport.ts`, `src/client/stdio.ts`                                                                                            |
| `IMCPSession` (this package)                      | the session object `openMcpSession` returns                                 | `src/client/session.ts`                                                                                                                     |
| `IMCPActivationAdmission` (this package)          | `MCPActivationAdmissionService`, `createFailClosedMCPActivationAdmission()` | `src/mcp-activation.ts`                                                                                                                     |
| `IMCPActivationDefinitionRegistry` (this package) | `MCPDefinitionRegistry`                                                     | `src/definition/registry.ts`                                                                                                                |

### Cross-Package Port Consumers

| Port (Owner)                                                                                                                                                                                                             | Consumer                                                                                              | Location                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `IToolWithEventService`, `IToolSchema`, `IToolResult`, `IToolExecutionContext`, `IParameterValidationResult`, `IEventService`, `TToolParameters`, `TUniversalValue`, `IParameterSchema`, `IObjectParameterSchema` (core) | `DiscoveredMCPTool`                                                                                   | `src/catalog/discovered-tool.ts`                                                                                  |
| `IParameterSchema` (core)                                                                                                                                                                                                | catalog types, builder, discovery driver                                                              | `src/catalog/types.ts`, `src/catalog/build.ts`, `src/client/discovery.ts`                                         |
| `TToolParameters`, `IUniversalObjectValue`, `TUniversalValue` (core)                                                                                                                                                     | tool arguments, call results, `structuredContent`, `outputSchema`, and the one SDK-payload conversion | `src/client/session.ts`, `src/supervisor/connection.ts`, `src/catalog/types.ts`, `src/catalog/universal-value.ts` |
| `rejectDestination`, `IEgressPolicy`, `TEgressLookup` (core `./node` subpath)                                                                                                                                            | `admitHttpEndpoint`                                                                                   | `src/client/transport.ts`                                                                                         |
| `Client`, notification schemas, `McpError` / `ErrorCode` (`@modelcontextprotocol/sdk`)                                                                                                                                   | `openMcpSession`, `discoverAll`                                                                       | `src/client/session.ts`, `src/client/discovery.ts`                                                                |
| `StreamableHTTPClientTransport`, `Transport` (`@modelcontextprotocol/sdk`)                                                                                                                                               | transport seam                                                                                        | `src/client/transport.ts`                                                                                         |
| `UnauthorizedError` (`@modelcontextprotocol/sdk`)                                                                                                                                                                        | `classifyMcpFailure`                                                                                  | `src/supervisor/connection.ts`                                                                                    |
