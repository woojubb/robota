# agent-transport-mcp Specification

## Purpose

Model Context Protocol (MCP) server transport for the Robota SDK — stdio, authenticated loopback
Streamable HTTP, and OAuth-authorized remote Streamable HTTP, all served from the same exact runtime
session port. Split out of the consolidated `agent-transport` package so MCP SDK dependencies remain
isolated.

## Transport Admission

Stdio transport-admission is `none`: a peer that can write to this stdin already runs as the user.
The loopback HTTP carrier is different: it binds only `127.0.0.1`, mints a fresh 256-bit bearer with
the shared `agent-transport/node` admission primitive, and refuses an invalid Host, Origin, or bearer
before reading a request body. The remote HTTP carrier is an OAuth resource server: it admits only
an access token its injected verifier accepts and never mints or honours the loopback bearer, which
is only as safe as the machine boundary. Its gate is the shared resource-server gate of
`agent-transport/node`, so it answers exactly as every other token-admitted HTTP carrier does. Every name it checks — endpoint path, metadata path, Host,
Origin — comes from the public URL rather than the listener, because the public URL is all a client
ever sees; a proxy in front must forward the path unchanged and preserve Host. It verifies before it
counts and counts only failures, so a valid token is never throttled by failures sharing its address
(a NAT, a proxy), and it believes a forwarded address only from a configured proxy. All carriers
admit only the canonical runtime catalog and use the session permission wrapper without interactive
approval prompts.

## Boundaries

- Owns the MCP server transport adapter, stdio carrier, authenticated loopback and remote HTTP
  carriers, and agent MCP server builders. It does not verify token signatures itself; the verifier
  is injected, so the cryptography stays in `agent-transport/node`.
- Depends on `agent-interface-session` and `agent-interface-transport` contracts, not framework
  internals.
- No other transport package depends on this one.
- MCP consumes only the turn-submission and runtime-tool session roles. The public transport
  implements `ITransportAdapter<IMcpTransportSession>` directly, with no broader inherited signature
  or overload — a full session remains assignable structurally because it implements those roles.

## Lifecycle guarantees

- `createMcpTransport` is a frozen `service` lifecycle: `start()` validates the canonical catalog,
  connects the carrier, and resolves only when it can serve requests; a pending start is cancellable
  and bounded to 15 seconds. Start-before-attach and a repeated active start reject; repeated stop is
  safe; restart requires a new attach.
- Both HTTP hosts validate the canonical catalog and their bind before listening. They follow the
  SDK's stateless request/response model — no `Mcp-Session-Id` table, GET stream, expiry sweep, or
  resumption process — so a remote peer has no session identifier to guess or enumerate. One
  listener maps every admitted request onto the single attached `IMcpTransportSession`.
- On the loopback host, `Host` must match the listener's own loopback address and port; a present
  `Origin` must match that exact origin (absent is permitted for local non-browser clients). Invalid
  Host/Origin returns 403 and an invalid bearer returns 401, both before the request body is read.
  The bearer is minted at host start and returned only to the trusted process owner, which must keep
  it out of argv, logs, URLs, and world-readable files. The loopback host refuses a non-loopback bind; only the remote
  host, which cannot be built without a verifier and an `https` public URL, binds elsewhere.
- The external wire schema and protocol errors are MCP-SDK owned, not a Robota REST envelope.

## Canonical catalog and invocation

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
no credential, tool result, or internal runtime detail; a remote token refusal adds only the standard
Bearer challenge — an RFC 6750 error code, the required scope and the metadata location, never a
description — so a refusal tells a client how to recover and nothing more. A
refusal's audit record is likewise a closed-set reason and an address class, never token text or the
address itself. Listener/start/close failures reject visibly.
