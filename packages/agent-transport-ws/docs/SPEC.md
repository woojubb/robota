# agent-transport-ws Specification

## Transport Admission (SEC-008)

This transport got the default right — auto-mint unless told to stay open — and its sibling got it
wrong, which was the whole problem: one question, two answers, because each transport owned its own
copy of the decision. The behaviour is unchanged; it now comes from `resolveAdmission` in
`@robota-sdk/agent-transport-protocol`, so there is one place to read and one place to change.

`open` additionally requires a written reason. "No credential" and "nobody thought about it" were
indistinguishable in the code this replaces, and only one of them is a decision. A caller that opted
open before that requirement existed is recorded with a reason naming exactly that, so a reader can
tell an inherited opt-out from a considered one.

## Scope

WebSocket transport and wire protocol for the Robota SDK. Split out of the consolidated
`agent-transport` package (DQ-AUDIT-005) so the `ws` dependency and the WS message types are an
isolated unit — browser/monitor consumers (e.g. `agent-transport-gui`) depend on this package's types
without pulling React, Ink, or Hono.

## Boundaries

- Owns the `ws`-based transport adapter (`WsTransport`, `createWsTransport`). The transport-neutral session
  bridge (`createWsHandler`) + wire protocol (`TClientMessage`/`TServerMessage`) were **extracted to
  `@robota-sdk/agent-transport-protocol`** (REMOTE-002) so a non-WS transport can reuse them; this package
  imports them from there.
- Depends on `agent-interface-transport`, `agent-core`, and `agent-transport-protocol` (INFRA-025: the framework
  edge was deleted — every consumed type is an interface-transport / protocol contract).
- No other transport package depends on this one. The default transport-registry wiring that
  pre-registers `WsTransport` lives in the composition root (the CLI), not in the transport core.

## Architecture Overview

```
agent-transport-ws
  ├── WsTransport             ← IConfigurableTransport + IPayloadChannelHost (settings-backed)
  ├── PayloadChannelRegistry  ← TRANS-001 channel multiplexing (declare / route / fan out)
  └── createWsTransport       ← functional transport factory
  (reuses createWsHandler + TClientMessage/TServerMessage + the channel frame codec
   from @robota-sdk/agent-transport-protocol)
```

### Frame routing — two profiles on one connection (TRANS-001)

`WsTransport` is a **payload-agnostic carrier**. It routes by WebSocket frame opcode, so the
text-agent protocol is one profile ON the transport rather than being the transport:

| Inbound WS frame | Routed to                                        | Owner                      |
| ---------------- | ------------------------------------------------ | -------------------------- |
| TEXT             | `createWsHandler` (`TClientMessage` JSON)        | `agent-transport-protocol` |
| BINARY           | `PayloadChannelRegistry.receive` (channel frame) | this package               |

Outbound, a registered channel's frames are encoded by the shared codec and sent as BINARY frames to
every attached connection; the agent protocol keeps sending TEXT frames. The two never constrain
each other, and `TClientMessage`/`TServerMessage` are unchanged — a consumer adds an app-level event
type by declaring a channel, never by forking the agent wire protocol.

Rejections are explicit: a binary frame for an unregistered channel, an undeclared event name, or a
malformed envelope is answered with a `protocol_error` TEXT frame — never silently dropped.
Authentication is unaffected: channel sinks are attached only AFTER the SEC-001 token check, so an
unauthenticated socket receives no channel traffic.

## Type Ownership

Owns `IWsTransportOptions`, `IWsTransportConfig`, and `TChannelSink`. The session bridge
(`createWsHandler`/`IWsHandlerOptions`), the wire protocol (`TClientMessage`/`TServerMessage`), and the
TRANS-001 channel frame codec are owned by `@robota-sdk/agent-transport-protocol` and imported from
there; the channel CONTRACTS (`IPayloadChannel`, `IChannelDescriptor`, `IBinaryFrame`, …) are owned by
`@robota-sdk/agent-interface-transport`. Consumers import execution-workspace contract types from
`@robota-sdk/agent-interface-transport` directly (INFRA-025: no pass-through re-exports).

## Public API Surface

| Export                   | Kind     | Description                                                                       |
| ------------------------ | -------- | --------------------------------------------------------------------------------- |
| `WsTransport`            | class    | Settings-backed configurable WS transport; also an `IPayloadChannelHost`          |
| `createWsTransport`      | function | Functional WS transport factory                                                   |
| `PayloadChannelRegistry` | class    | TRANS-001 channel registry: declare, route inbound frames, fan out to connections |

### Payload-agnostic channels (TRANS-001)

`WsTransport.registerChannel(descriptor)` opens a consumer-declared channel on the transport:

```typescript
const channel = transport.registerChannel<{ manifest: { name: string; size: number } }>({
  name: 'file',
  events: ['manifest'],
  binary: true,
});
channel.sendEvent('manifest', { name: 'payload.bin', size: blob.byteLength });
channel.sendBinary(chunk); // opaque bytes — the transport never inspects them
channel.onBinary((frame) => reassemble(frame.seq, frame.payload));
```

A channel may be registered before or after `start()`; a later registration is served by every
already-connected client. Sends are broadcast to all attached connections. `sendEvent` with an
undeclared name and `sendBinary` on a channel without `binary: true` throw — the descriptor is the
contract. `close()` frees the name for re-registration.

### Loopback auth token (GUI-002)

`IWsTransportConfig.token?: string` — an OPTIONAL per-connection auth token. **When set**, every incoming
connection must present a matching token or the socket is **closed (code 1008) BEFORE any session data
(`messages` / `execution_workspace_event`) is emitted**. The token is read from the upgrade request as the
`?token=` query param (browser `WebSocket` cannot set headers) or, failing that, the first
`Sec-WebSocket-Protocol` subprotocol; comparison is constant-time (`node:crypto` `timingSafeEqual`, length-guarded).
**When unset** (the default, e.g. the local TUI path) the transport is unauthenticated exactly as before — a
backward-compatible no-op. It is a runtime-injected secret (not part of `optionsSchema`, never persisted to
settings). The `agent-cli` composition root passes it from `ROBOTA_WS_TOKEN` (+ optional `ROBOTA_WS_PORT`)
when a host such as the `agent-app` Electron shell spawns the CLI as a loopback sidecar. The pre-existing
unauthenticated default path is tracked for hardening by a companion SECURITY backlog.

## Extension Points

New message variants extend the protocol unions; new transport options extend the option interfaces.
App-level payloads and event types are added WITHOUT touching either: declare a channel through
`registerChannel` (TRANS-001).

## Error Taxonomy

Connection/protocol errors surface as `TServerMessage` error frames; no new error classes. An
unroutable channel frame surfaces as a `protocol_error` frame carrying the registry's stated reason;
misuse of a channel handle (undeclared event, binary on a text-only channel, duplicate name, closed
channel) throws a plain `Error` at the call site.

## Test Strategy

Protocol + handler unit tests under `src/__tests__`. TRANS-001 adds `payload-channels.test.ts`
(registry declare/route/reject) and `ws-payload-channel.e2e.test.ts` — an end-to-end run over a real
WebSocket server proving interleaved text deltas, opaque binary frames, and a custom event share one
connection, with byte-identical ordered reassembly in both directions.

## Dependencies

- `@robota-sdk/agent-interface-transport`, `@robota-sdk/agent-core`.
- External: `ws`.
