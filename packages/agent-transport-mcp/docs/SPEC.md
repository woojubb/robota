# agent-transport-mcp Specification

## Purpose

Model Context Protocol (MCP) server transport for the Robota SDK — stdio and authenticated loopback
Streamable HTTP, both served from the same exact runtime session port. Split out of the consolidated
`agent-transport` package (DQ-AUDIT-005) so MCP SDK dependencies remain isolated.

## Transport Admission (SEC-008)

Stdio transport-admission is `none`: a peer that can write to this stdin already runs as the user.
The loopback HTTP carrier is different: it binds only `127.0.0.1`, mints a fresh 256-bit bearer with
the shared `agent-transport/node` admission primitive, and refuses an invalid Host, Origin, or bearer
before reading a request body. Both carriers admit only the canonical runtime catalog and use the
session permission wrapper without interactive approval prompts.

## Boundaries

- Owns the MCP server transport adapter, stdio carrier, authenticated loopback HTTP carrier, and
  agent MCP server builders.
- Depends on `agent-interface-session` and `agent-interface-transport` contracts, not framework
  internals.
- No other transport package depends on this one.
- MCP consumes only the turn-submission and runtime-tool session roles. The public transport
  implements `ITransportAdapter<IMcpTransportSession>` directly, with no broader inherited signature
  or overload — a full session remains assignable structurally because it implements those roles.

## Lifecycle guarantees (ARCH-011)

- `createMcpTransport` is a frozen `service` lifecycle: `start()` validates the canonical catalog,
  connects the carrier, and resolves only when it can serve requests; a pending start is cancellable
  and bounded to 15 seconds. Start-before-attach and a repeated active start reject; repeated stop is
  safe; restart requires a new attach.
- `createMcpHttpHost` validates the canonical catalog and an explicit IPv4 loopback bind before
  listening. It follows the SDK's stateless request/response model — no `Mcp-Session-Id` table, GET
  stream, expiry sweep, or resumption process. One listener maps every admitted request onto the
  single attached `IMcpTransportSession`.
- `Host` must match the listener's own loopback address and port; a present `Origin` must match that
  exact origin (absent is permitted for local non-browser clients). Invalid Host/Origin returns 403
  and an invalid bearer returns 401, both before the request body is read. The bearer is minted at
  host start and returned only to the trusted process owner, which must keep it out of argv, logs,
  URLs, and world-readable files. Non-loopback binding is refused.
- The external wire schema and protocol errors are MCP-SDK owned, not a Robota REST envelope.

## Canonical catalog and invocation (MCP-006)

`createAgentMcpServer` checks the canonical catalog before accepting calls; tools use their canonical
runtime names, descriptions, and input schemas — `exposeCommands` and `command_*`/`executeCommand`
have no compatibility route. The submission extension uses a host-selected identity or a neutral
default; a runtime-tool name collision with that identity fails startup, and a later catalog
collision fails listing/calling visibly.
Resources and prompts are not advertised. MCP tool calls delegate to `invokeRuntimeTool`; unknown
names, permission denial, interactive permission requirements, busy state, and cancellation are all
visible tool errors, and submission cancellation never aborts another caller's active turn.

## Error Taxonomy

MCP protocol errors surface through the MCP SDK. HTTP admission responses have empty bodies and carry
no credential, tool result, or internal runtime detail. Listener/start/close failures reject visibly.
