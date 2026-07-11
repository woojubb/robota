# agent-transport-protocol Specification

## Scope

Owns the **transport-neutral session bridge + wire protocol** shared by transport implementations
(`agent-transport-ws`, `agent-transport-webrtc`, …). Extracted from `agent-transport-ws` (REMOTE-002) so a
non-WebSocket transport can reuse it without a `webrtc → ws` package edge.

- `createWsHandler({ session, send })` — subscribes to an `IInteractiveSession`'s events and pushes them as
  `TServerMessage`s via the injected `send`; returns `onMessage(data)` (drives `session.submit/executeCommand/
abort/...` from inbound `TClientMessage`s) + `cleanup()`. Framework-agnostic: works over any byte/string
  channel via `send`/`onMessage` callbacks — no `ws`, no `node:` sockets.
- `TClientMessage` / `TServerMessage` — the JSON wire protocol (inbound client verbs; outbound server events).
- **REMOTE-007 transport-neutral permission/ask.** The handler forwards the session's
  `permission_request` / `ask_request` / `prompt_resolved` events as `TServerMessage`s and dispatches the
  inbound `permission-response` / `ask-response` verbs to `session.resolvePermission` / `resolveAsk`. So a
  driving client (WS or, via the same handler, WebRTC) renders + answers the SAME prompt as the local
  operator (local == remote); the first answer wins and `prompt_resolved` dismisses it on co-drive. A client
  disconnect (`cleanup` → `session.off`) drops the prompt listeners, and the session's reconcile-on-detach
  fails the prompt closed (deny/cancel) so a mid-prompt disconnect cannot hang the awaiting tool.
- **REMOTE-014 E5 co-drive attribution (SERVER-ASSIGNED, display-only).** `IWsHandlerOptions.driverId` binds a
  surface's server-assigned driver id (the E3 `deviceId`; the SessionResumeBridge sets it at pairing via
  `setDriverId`). The handler INJECTS it into every inbound `submit` / `permission-response` / `ask-response`
  — a client can never send its own id, so authorship is not forgeable. Outbound, `subscribeSessionEvents`
  SELECTIVELY stamps the eight turn-authored events (`text_delta`, `user_message`, `tool_start`/`tool_end`,
  `thinking`, `complete`, `interrupted`, `error`) with the active turn's `driverId` read from
  `session.getActiveDriverId()`; background / job-group / execution-workspace events are NEVER stamped (not
  authored by a driver turn). **Invariant:** `driverId` is DISPLAY attribution only, never an authorization
  input — the OWNER PRINCIPLE (local == remote) governs who may act; every paired driver holds owner authority.

## Boundaries

- **Contains runtime logic** (the handler) — so it is NOT `agent-interface-transport` (which bans runtime code,
  INFRA-035). It is a leaf below every transport implementation.
- **Dependencies: `@robota-sdk/agent-interface-transport` ONLY.** No `agent-core`, no `ws`, no `node:` sockets
  (verified). Transport implementations (`-ws`, `-webrtc`) depend DOWN on this package; it depends on none of
  them (no cycle).

## Public API Surface

| Export                        | Kind      |
| ----------------------------- | --------- |
| `createWsHandler`             | function  |
| `IWsHandlerOptions`           | interface |
| `TClientMessage`              | type      |
| `TServerMessage`              | type      |
| `TSeqServerMessage`           | type      |
| `ResumeBuffer`                | class     |
| `IResumeBufferOptions`        | interface |
| `IBufferedFrame`              | interface |
| `TResumeTail`                 | type      |
| `SessionResumeBridge`         | class     |
| `ISessionResumeBridgeOptions` | interface |
| `TResumeSink`                 | type      |

## Type Ownership

| Type/Symbol       | Location             | Purpose                                       |
| ----------------- | -------------------- | --------------------------------------------- |
| `createWsHandler` | `src/ws-handler.ts`  | Session↔client bridge over `send`/`onMessage` |
| `TClientMessage`  | `src/ws-protocol.ts` | Inbound client wire messages                  |
| `TServerMessage`  | `src/ws-protocol.ts` | Outbound server wire messages                 |

## Test Strategy

`src/__tests__/ws-handler.test.ts` (moved from `agent-transport-ws`) covers the session-event → `TServerMessage`
subscription and inbound `TClientMessage` dispatch with a stubbed session (no socket, no real provider),
including the REMOTE-007 prompt-event forwarding and the `permission-response` / `ask-response` → `resolve*`
dispatch (TC-06).
