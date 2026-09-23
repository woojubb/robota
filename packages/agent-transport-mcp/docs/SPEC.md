# agent-transport-mcp Specification

## Transport Admission (SEC-008)

Stdio transport-admission is `none`: a peer that can write to this stdin already runs as the user. The loopback HTTP carrier is different: it binds only `127.0.0.1`, mints a fresh 256-bit bearer with the shared `agent-transport/node` admission primitive, and refuses an invalid Host, Origin, or bearer before reading a request body. Both carriers admit only the canonical runtime catalog and use the session permission wrapper without interactive approval prompts.

## Scope

Model Context Protocol (MCP) server transport for the Robota SDK. Split out of the consolidated
`agent-transport` package (DQ-AUDIT-005) so MCP SDK dependencies remain isolated. The package
serves stdio and authenticated loopback Streamable HTTP from the same exact runtime session port.

## Boundaries

- Owns the MCP server transport adapter, official SDK stdio carrier, authenticated loopback HTTP
  carrier, and agent MCP server builders.
- Depends on `agent-interface-session` and `agent-interface-transport` contracts, not framework internals.
- No other transport package depends on this one.

## Architecture Overview

```
agent-transport-mcp
  ├── createMcpTransport    ← ITransportAdapter over the MCP server
  ├── createAgentMcpServer  ← MCP server exposing an agent session over stdio
  └── createMcpHttpHost     ← admitted loopback listener over the same session port
```

## Type Ownership

Owns `IMcpTransportOptions`, `IAgentMcpOptions`, `IMcpHttpHostOptions`, `IMcpHttpHost`, and
`IMcpTransportSession`. MCP consumes only the
turn-submission and runtime-tool roles. The public transport implements
`ITransportAdapter<IMcpTransportSession>` directly; `attach` has no broader inherited signature or
overload. A full session remains assignable structurally because it implements those roles.

## Public API Surface

| Export                 | Kind      | Description                                   |
| ---------------------- | --------- | --------------------------------------------- |
| `createMcpTransport`   | function  | MCP server transport adapter                  |
| `createAgentMcpServer` | function  | Build an MCP server for an agent              |
| `createMcpHttpHost`    | function  | Authenticated loopback MCP HTTP host          |
| `IMcpTransport`        | interface | Adapter bound to the exact MCP session port   |
| `IMcpTransportSession` | interface | Exact submission + runtime-tool session roles |
| `IMcpHttpHost`         | interface | Start/stop/wait lifecycle and local endpoint  |

## Extension Points

New executable tools belong to the canonical session runtime catalog. Prompts and resources are explicitly unsupported in the minimum slice.

## Lifecycle Conformance (ARCH-011)

`createMcpTransport` is a frozen `service` lifecycle. `start()` validates the canonical catalog,
connects the official SDK `StdioServerTransport`, and resolves only when the carrier can serve
requests. This package owns carrier creation, stdin/stdout close/error observation, and idempotent
carrier/server teardown. Early input is bridged with backpressure during catalog validation, so
stdin EOF is observable before carrier connection. A pending start is cancellable by stop/EOF and
bounded to 15 seconds. `waitForClose()` resolves on peer/stdin close and rejects on carrier
failure, allowing the process owner to select an exit code and shut down its session. The optional
stdio streams are injected only to isolate the carrier in tests and reserve the product's stdout.
Start before attach and repeated active start reject `TransportLifecycleError`; repeated stop is
safe and restart requires a new attach. The shared suite owner id is
`@robota-sdk/agent-transport-mcp#createMcpTransport`.

`createMcpHttpHost` validates the canonical catalog and explicit IPv4 loopback bind before listening.
It uses the official SDK v2 `createMcpHandler` per-request factory and Node adapter, with the SDK's
2026-07-28 request protocol and default stateless 2025-era fallback. No `Mcp-Session-Id` table,
GET stream, expiry sweep, or resumption process is created. One listener maps every admitted request
to the one attached process-owned `IMcpTransportSession`; the MCP handler does not own that session.
The carrier limits body size, active requests, accepted TCP connections, and header/body receive
time before SDK parsing. Request abort and listener
shutdown cancel in-flight work through the exact session port; stop closes the SDK handler and
listener, then `waitForClose()` settles. The process shell owns signals and session shutdown.

The HTTP endpoint is `POST /mcp`; `GET /mcp` and `DELETE /mcp` follow the SDK's adopted-era
responses, with no custom GET event stream. `Host` must match the listener's numeric loopback
address and actual port; absent `Origin` is permitted for local non-browser clients, while a present
origin must match that exact loopback origin. Invalid Host/Origin returns 403 and invalid bearer
returns 401, all before body consumption; other methods and paths cannot invoke runtime tools.
The bearer is minted at host start and returned only to the trusted process owner, which must keep
it off command-line arguments, logs, URLs and world-readable files. Non-loopback binding is refused.
The external wire schema and protocol errors are MCP SDK-owned, rather than a Robota REST envelope.

## Error Taxonomy

MCP protocol errors surface through the MCP SDK. HTTP admission responses have empty bodies and
no credential, tool result, or internal runtime detail. Listener/start/close failures reject visibly.

## Test Strategy

Server + transport unit tests under `src/__tests__`, plus real loopback HTTP requests for both
protocol eras, Host/Origin/bearer refusal, body and concurrency limits, cancellation, and shutdown.

## Dependencies

- `@robota-sdk/agent-interface-transport`, `@robota-sdk/agent-interface-session`, and the shared
  `@robota-sdk/agent-transport/node` admission implementation.
- External: `@modelcontextprotocol/sdk` for existing stdio and `@modelcontextprotocol/server` /
  `@modelcontextprotocol/node` v2 for current Streamable HTTP.

### Canonical catalog and invocation (MCP-006)

`createAgentMcpServer` is asynchronous: it checks the canonical catalog before accepting calls.
`exposeCommands` is removed. Tools use their canonical runtime names, descriptions and input schemas;
`command_*` and direct `executeCommand` have no compatibility route.

The reserved `robota_submit` tool is a Robota extension for submitting a prompt. A runtime-tool collision
with this name fails startup; later catalog collisions fail listing/calling visibly. Resources and
prompts are not advertised and receive the SDK's unsupported-method response.

MCP tool calls delegate to `invokeRuntimeTool` with the request cancellation signal. The session
execution envelope is serialized as text and failures set `isError: true`. Unknown names, permission
denial, interactive permission requirements, busy state and cancellation are visible tool errors.
Submission cancellation forwards `ISubmitOptions.signal` for the accepted turn; it never aborts another caller's active turn.

Tests use in-memory MCP peers and actual session execution to verify canonical names, policy, hooks,
truncation, cancellation, busy/shutdown behavior, reserved-name collisions and failure isolation.
