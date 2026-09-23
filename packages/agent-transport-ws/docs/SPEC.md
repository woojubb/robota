# agent-transport-ws Specification

## Purpose

WebSocket carrier for the Robota SDK. The `ws` dependency and carrier lifecycle are isolated in
this package; transport-neutral wire messages and session handling belong to
`@robota-sdk/agent-transport` so browser and monitor consumers can depend on those contracts
without pulling in `ws`, React, Ink, or Hono.

## Non-goals / Boundaries

- Does not own the session bridge or the wire protocol (`TClientMessage`/`TServerMessage`) — both
  were extracted to `@robota-sdk/agent-transport` so a non-WS transport can reuse them; this
  package imports rather than redefines them.
- Does not own the channel contracts (`IPayloadChannel`, `IChannelDescriptor`, `IBinaryFrame`) —
  owned by `agent-interface-transport`.
- No other transport package may depend on this one; default transport-registry wiring that
  pre-registers the WS transport belongs to the CLI composition root, not the transport core.
- Consumers import execution-workspace contract types directly from `agent-interface-transport`
  rather than through a pass-through re-export from this package.

## Design decision: transport admission default (SEC-008)

A prior state had two transports independently answering the same "auto-mint a credential, or stay
open?" question differently. The admission decision now has exactly one owner
(`resolveAdmission` in `agent-transport`), so there is one place to read and one place to change
it, rather than transports drifting apart on a shared question. Opting to stay open additionally
requires a written reason, because "no credential" and "nobody thought about it" must remain
distinguishable outcomes.

## Invariants and guarantees

- **Payload-agnostic carrier.** The transport routes by WebSocket frame opcode: the text-agent
  protocol is one profile riding on the transport, not the transport itself. A binary frame for an
  unregistered channel, an undeclared event name, or a malformed envelope always gets an explicit
  `protocol_error` reply — never a silent drop. An application adds a new event type by declaring a
  channel, never by forking the agent wire protocol.
- **Protocol-scoped session attachment.** Both WebSocket adapters require only the session roles
  used by the shared protocol bridge. Hosts can attach a full interactive session, but the carrier
  does not depend on unrelated runtime capabilities.
- **Authentication ordering is fixed.** Channel sinks attach only after the token check, so an
  unauthenticated socket never receives channel traffic even if a channel was registered before the
  connection existed.
- **Optional token, constant-time comparison, closed before data.** When a per-connection token is
  configured, a non-matching connection is closed before any session data is emitted; comparison is
  constant-time. When unset, the transport is unauthenticated exactly as before — a
  backward-compatible no-op, not a stricter default.
- **Lifecycle rejects out-of-order use.** Starting before attaching, or a repeated active start,
  is rejected rather than silently reinitializing; a repeated stop is safe but clears the session so
  restart requires reattaching.
- **Outbound delivery failures are carrier failures, not session-operation failures**, and this
  applies uniformly to every outbound frame, not only the session-event fan-out. The socket sink is
  private; the only way onto the wire is through one delivery path, so nothing can bypass its
  failure handling. A non-open socket is treated as a failed send, and both synchronous and
  asynchronous send errors route through one idempotent cleanup/close path — latched, so a burst of
  post-close frames triggers that cleanup only once.
- **The host controls capability wiring and surface identity**, not the client: usage-reporting
  capabilities are injected by the host at construction, and the driver identity persisted with a
  session comes from the host's trusted launch path rather than a client-claimed value.
