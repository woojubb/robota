# agent-tool-mcp Specification

## Scope

MCP (Model Context Protocol) tool implementations for Robota SDK. Provides `MCPTool` (a JSON-RPC 2.0 tool executor) and `RelayMcpTool` (a relay adapter that bridges third-party MCP commands into Robota agent flows). The package is an internal, private (unpublished) workspace package (`"private": true` in `package.json`) named `@robota-sdk/agent-tool-mcp`.

## Boundaries

- Allowed dependencies: `@robota-sdk/agent-core` (sole peer dependency). The Streamable HTTP client is implemented with the global `fetch` — no protocol SDK dependency.
- Must not import `agent-framework`, `agent-session`, `agent-cli`, or any other `agent-*` package.
- `MCPTool` implements `ITool` directly (not via `AbstractTool`) to avoid a circular runtime dependency (`agent-tool-mcp` → `agents` → `tools` → `agents`); `RelayMcpTool` is structurally `ITool`-shaped (no declared `implements` clause).
- Does not own a tool registry or factory. The consumer (composition root or CLI) selects and wires tools at construction time.
- Transport: MCP Streamable HTTP (JSON-RPC 2.0 over HTTP POST via global `fetch`). stdio transport is out of scope — `IMCPConfig` has no command/args surface.
- MCP activation policy is transport-neutral and host-injected. This package owns the admission port,
  exact identity matching, and a replaceable approval/audit store, but it does not decide workspace
  trust or read project/plugin files. A missing admission request or admission implementation fails
  closed before `initialize` is sent.

## Architecture Overview

Single entry point `./` backed by `src/index.ts`.

**`MCPTool`** (`src/mcp-tool.ts`) implements `ITool` and speaks JSON-RPC 2.0 to a remote MCP server over Streamable HTTP. Every `execute()` first calls the injected `IMCPActivationAdmission`; denied, stale, rejected, revoked, untrusted, or incomplete requests fail before any connection attempt. The first admitted `execute()` performs the MCP `initialize` handshake followed by the `notifications/initialized` notification (`initializeMCPSession`), captures the `Mcp-Session-Id` response header when present, and echoes it on subsequent requests. Admission is checked again when a connected session is reused, so revocation and trust-generation changes take effect. `disconnect()` sends a best-effort HTTP DELETE with the session id (`terminateMCPSession`). It manages a `TMCPConnectionStatus` state machine (`disconnected → connecting → connected → disconnecting → disconnected | error`); `connected` is only reached after a successful handshake. Protocol helpers (`buildMCPRequest`, `sendMCPRequest`, `initializeMCPSession`, `terminateMCPSession`, `processMCPResponse`) live in `src/mcp-protocol.ts`.

**`mcp-activation.ts`** owns the reusable trust boundary. `MCPActivationAdmissionService` matches an
approval only when server id, source/provenance, definition fingerprint, security identity, and,
for project/plugin/local definitions, repository identity and workspace generation all match. It
requires a trusted workspace for those sources, refuses project/plugin self-approval, and exposes
  `approve`, `reject`, `revoke`, `inspect`, and `listAudit` through injected storage.
`MCPActivationController` adapts a definition registry into the command-layer's structural
list/approve/reject/revoke port; status inspection never connects.

**`RelayMcpTool`** (`src/relay-mcp-tool.ts`) is a minimal relay that accepts a caller-provided `run()` callback. It appends a single agent `IOwnerPathSegment` to the incoming `ownerPath` and forwards control to the callback with the augmented `IRelayMcpContext`. No prefix injection, no fallback, no context creation inside.

**`mcp-protocol.ts`** owns the JSON-RPC 2.0 message types (`IMCPRequest`, `IMCPResponse`, `IMCPToolCallParams`, `IMCPToolCallResult`, `IMCPContentPart`, `IMCPError`) and the protocol helpers. `tools/call` requests use the spec-conformant `params: { name, arguments }` shape. `sendMCPRequest` bounds each attempt with `AbortSignal.timeout(config.timeout ?? 30000)` (timeouts are not retried) and retries network-level failures and HTTP 5xx responses up to `config.retries ?? 3` times with linear backoff; responses may be `application/json` or `text/event-stream` (SSE `data:` lines are scanned for the message matching the request id). The module is not exported from the package entry point.

## Type Ownership

This package is SSOT for the following types. Types marked **public** are exported from the `.` entry point; others are internal.

- `IMCPConfig` — `MCPTool` constructor configuration (**public**).
- `IMCPToolOptions` — injected activation request/admission and optional schema reporter (**public**).
- `IMCPActivationRequest` / `IMCPActivationAdmission` — exact activation identity and admission port (**public**).
- `MCPActivationAdmissionService` / `MCPActivationController` — policy and registry adapter (**public**).
- `IMCPActivationApprovalStore` / `InMemoryMCPActivationApprovalStore` — replaceable approval/audit persistence (**public**).
- `IMCPActivationDefinitionRegistry` / `IMCPActivationSummary` — definition discovery and secret-free command projection (**public**).
- `MCPActivationPolicyError` / `createFailClosedMCPActivationAdmission` — typed policy failure and deny-by-default fallback (**public**).
- `IRelayMcpOptions` — `RelayMcpTool` constructor options (**public**).
- `IRelayMcpContext` — context passed to the `run()` callback (**public**).
- `TMCPConnectionStatus` — connection state union (`'connected' | 'disconnected' | 'connecting' | 'disconnecting' | 'error'`) (internal).
- `IMCPRequest`, `IMCPResponse`, `IMCPToolCallParams`, `IMCPToolCallResult`, `IMCPContentPart`, `IMCPError`, `IMCPSendResult` — JSON-RPC 2.0 / MCP protocol message shapes (internal).

All `ITool`-related types (`ITool`, `IToolResult`, `IToolExecutionContext`, `TToolParameters`, `IParameterValidationResult`, `IToolSchema`) are owned by `@robota-sdk/agent-core`.

## Public API Surface

| Export                         | Kind      | Description                                                                                            |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------ |
| `MCPTool`                      | class     | `ITool` implementation for JSON-RPC 2.0 MCP server communication                                       |
| `createMCPTool`                | function  | Factory: `(config, schema, options?) => MCPTool`; omitted admission fails closed                    |
| `IMCPToolOptions`              | interface | Optional host-injected activation request/admission and schema enforcement callbacks                  |
| `MCPActivationAdmissionService` | class   | Exact-identity approval/rejection/revocation policy and status inspection                             |
| `MCPActivationController`      | class     | Definition-registry adapter for status and typed lifecycle decisions                                 |
| `InMemoryMCPActivationApprovalStore` | class | In-memory approval/audit store for tests and ephemeral hosts                                      |
| `createFailClosedMCPActivationAdmission` | function | Deny-by-default admission fallback when a host has not composed trust policy                 |
| `MCPActivationPolicyError`      | class     | Typed refusal for invalid approval, rejection, or revocation authority transitions                  |
| `RelayMcpTool`                 | class     | Relay adapter that bridges MCP commands into Robota agent flows                                        |
| `IMCPConfig`                   | interface | MCP server connection configuration (`endpoint`, `apiKey`, `timeout`, ...)                             |
| `IRelayMcpOptions`             | interface | `RelayMcpTool` constructor options (`schema`, `run`, `onUnenforceableSchema`)                          |
| `IRelayMcpContext`             | interface | Context passed to `RelayMcpTool.run()` callback                                                        |
| `IMCPActivationRequest`        | interface | Secret-free exact definition/provenance/security identity plus workspace trust snapshot               |
| `IMCPActivationAdmission`      | interface | Reusable `inspect`/`admit` port called before every MCP connection/use                                |
| `IMCPActivationApprovalRecord` | interface | Secret-free exact approval record bound to a definition and workspace identity                        |
| `IMCPActivationApprovalStore`  | interface | Replaceable approval and audit persistence port                                                       |
| `IMCPActivationAuditEvent`     | interface | Secret-free auditable approval lifecycle event                                                        |
| `IMCPActivationDefinitionRegistry` | interface | Definition discovery port used by the activation controller                                           |
| `IMCPActivationProvenance`     | interface | Source provenance identity carried into activation admission                                           |
| `IMCPActivationStatusResult`   | interface | Secret-free admission status and denial reason                                                        |
| `IMCPActivationSummary`        | interface | Secret-free definition status projection for command consumers                                        |
| `IMCPActivationWorkspace`      | interface | Repository identity, trust state, and generation supplied to admission                               |
| `TMCPActivationSource`         | type      | Activation source classification (`managed`, `user`, `project`, `plugin`, or `local`)                |
| `TMCPActivationStatus`         | type      | Public admission status classification                                                                |
| `TMCPApprovalAuthority`        | type      | Authority classification for approval lifecycle mutations                                             |
| `TMCPWorkspaceTrustState`      | type      | Workspace trust and availability state classification                                                  |
| `narrowToUniversalSubset`      | function  | CORE-040: narrow a third-party schema to the part the universal subset can enforce, reporting the rest |
| `ThirdPartySchemaValidator`    | class     | CORE-040: the parameter validator BOTH tool classes use — one owner for the trust-boundary decision    |
| `INarrowedSchema`              | interface | `{ schema, unenforceable }` — the enforceable copy and the paths dropped from it                       |
| `TUnenforceableSchemaReporter` | type      | `(toolName, paths) => void` — told once per tool when part of its schema cannot be enforced            |

## Extension Points

- `IMCPConfig.timeout` — per-attempt timeout in ms (default 30 000); enforced via `AbortSignal.timeout`.
- `IMCPConfig.retries` — retry count for network-level/HTTP-5xx failures (default 3); JSON-RPC errors and timeouts are never retried.
- `IMCPConfig.headers` — additional HTTP headers sent on every MCP request.
- `IMCPConfig.apiKey` — sent as `Authorization: Bearer <apiKey>` on every MCP request.
- `IMCPToolOptions.activationRequest` — the resolved definition identity; endpoint credentials are not part of it.
- `IMCPToolOptions.admission` — host-owned policy. It is optional at the type boundary so construction remains
  source-compatible, but omission is a deliberate deny-by-default decision at runtime.
- `MCPActivationAdmissionService` — inject a durable store and clock. Project/plugin/local admission requires
  `workspace.trustState === 'trusted'`; project/plugin authority cannot approve itself; changed provenance,
  definition fingerprint, security identity, repository, or trust generation is stale.
- `IRelayMcpOptions.run` — inject the relay executor callback that creates and runs a Robota agent flow.
- `IRelayMcpOptions.onUnenforceableSchema` / `MCPTool`'s third constructor argument — told once, with
  the paths, when part of a tool's schema lies outside the universal subset. Omitting it logs a
  warning; it is never silent.

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

| Source         | Error / Condition                                                             | Trigger                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MCPTool`      | `ToolExecutionError('MCP tool execution failed: ...')`                        | JSON-RPC `error` response, `isError` tool result, HTTP failure, timeout, or exhausted retries — `execute()` never wraps failures in a success envelope |
| `MCPTool`      | `Error('MCP connection timeout: still connecting after Nms')`                 | `ensureConnection()` poll exceeds 50 iterations (5 000 ms)                                                                                             |
| `MCPTool`      | `Error('Failed to connect to MCP server: ...')`                               | Error thrown during `ensureConnection()`                                                                                                               |
| `MCPTool`      | `ToolExecutionError('MCP activation denied: ...')`                            | Missing or denied admission before the first handshake or a later reused-session execution                                                            |
| `MCPTool`      | `Error('Error disconnecting from MCP server: ...')`                           | Error thrown during `disconnect()`                                                                                                                     |
| `RelayMcpTool` | `ToolExecutionError('RelayMcpTool requires tool-call scoped EventService')`   | `context.eventService` is absent                                                                                                                       |
| `RelayMcpTool` | `ToolExecutionError('RelayMcpTool requires baseEventService')`                | `context.baseEventService` is absent                                                                                                                   |
| `RelayMcpTool` | `ToolExecutionError('RelayMcpTool requires ownerPath bound to tool segment')` | `context.ownerPath` is absent or empty                                                                                                                 |

`ToolExecutionError` and `ValidationError` are re-thrown as-is; all other errors are wrapped in `ToolExecutionError`.

## Test Strategy

Tests live in `src/__tests__/` (Vitest) and run against an in-process `node:http` mock MCP
server (`mock-mcp-server.ts`) that records received methods, headers, and bodies.

| Area                   | Test file          | Coverage                                                                                           |
| ---------------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| Handshake + tools/call | `mcp-tool.test.ts` | initialize → notifications/initialized → tools/call ordering; spec `params.name`/`arguments` shape |
| Error propagation      | `mcp-tool.test.ts` | JSON-RPC error and `isError` result both throw `ToolExecutionError`                                |
| Timeout / retries      | `mcp-tool.test.ts` | delayed route aborts at `timeout`; HTTP 500 retried `retries` times (attempt count asserted)       |
| Auth / session         | `mcp-tool.test.ts` | `Authorization: Bearer`, custom headers, `Mcp-Session-Id` echo, DELETE on `disconnect()`           |
| Status machine         | `mcp-tool.test.ts` | `connected` only after handshake; refused endpoint → `error` status + thrown failure               |
| Activation admission   | `mcp-activation.test.ts`, `mcp-tool.test.ts` | pending/status-only, untrusted workspace, self-approval, exact identity staleness, reject/revoke/audit, fail-closed pre-handshake, post-connect revocation |

Coverage gap: `RelayMcpTool.execute()` remains untested (relay context validation only).

## Class Contract Registry

### Interface Implementations

| Interface      | Implementor    | Location                                                                        |
| -------------- | -------------- | ------------------------------------------------------------------------------- |
| `ITool` (core) | `MCPTool`      | `src/mcp-tool.ts` (declared `implements ITool`)                                 |
| `ITool` (core) | `RelayMcpTool` | `src/relay-mcp-tool.ts` (structurally `ITool`-shaped, no declared `implements`) |

### Cross-Package Port Consumers

| Port (Owner)                   | Consumer       | Location                |
| ------------------------------ | -------------- | ----------------------- |
| `ITool` (core)                 | `MCPTool`      | `src/mcp-tool.ts`       |
| `ITool` (core)                 | `RelayMcpTool` | `src/relay-mcp-tool.ts` |
| `IToolExecutionContext` (core) | `MCPTool`      | `src/mcp-tool.ts`       |
| `IToolExecutionContext` (core) | `RelayMcpTool` | `src/relay-mcp-tool.ts` |
| `IEventService` (core)         | `RelayMcpTool` | `src/relay-mcp-tool.ts` |
| `IOwnerPathSegment` (core)     | `RelayMcpTool` | `src/relay-mcp-tool.ts` |
| `ToolExecutionError` (core)    | `MCPTool`      | `src/mcp-tool.ts`       |
| `ToolExecutionError` (core)    | `RelayMcpTool` | `src/relay-mcp-tool.ts` |
