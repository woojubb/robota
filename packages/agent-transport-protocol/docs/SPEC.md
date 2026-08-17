# agent-transport-protocol Specification

## Transport Admission (SEC-008)

transport-admission: none — transport-neutral wire types and a session bridge, shared by the transports that do the admitting. It binds nothing.

## Scope

Owns the **transport-neutral session bridge + wire protocol** shared by transport implementations
(`agent-transport-ws`, `agent-transport-webrtc`, …). Extracted from `agent-transport-ws` (REMOTE-002) so a
non-WebSocket transport can reuse it without a `webrtc → ws` package edge.

- `createWsHandler({ session, deliver })` — accepts the named `IProtocolSession` role aggregate and the
  CARRIER's outbound delivery boundary (ARCH-030), subscribes to the session's events, and pushes them as
  `TServerMessage`s through that boundary; returns `onMessage(data)` (drives `session.submit/executeCommand/
abort/...` from inbound `TClientMessage`s) + `cleanup()`. Framework-agnostic: works over any byte/string
  channel via the carrier's `deliver`/`onMessage` callbacks — no `ws`, no `node:` sockets.
- `TClientMessage` / `TServerMessage` — the JSON wire protocol (inbound client verbs; outbound server events).
- **TRANS-001 payload-agnostic channel frame codec** (`src/channel-frames.ts`) — `encodeBinaryFrame`,
  `encodeChannelEventFrame`, `decodeChannelFrame`, `isChannelFrame`, plus `CHANNEL_FRAME_MAGIC` /
  `CHANNEL_FRAME_VERSION`. A pure, byte-oriented envelope for the contracts in
  `agent-interface-transport` (`IBinaryFrame` / `IChannelEventFrame`). It is a SEPARATE, sibling profile
  to the JSON agent protocol above — `TClientMessage`/`TServerMessage` are untouched by it, so an app
  adds its own payloads and event types without forking the agent wire protocol. The codec NEVER
  interprets a binary body, and `decodeChannelFrame` returns a `TChannelReceiveResult` union so a
  non-channel / truncated / malformed input is a stated error the carrier reports to its peer.

  Wire layout (big-endian integers):

  ```text
  0..2  magic 'RBF'                     ← a carrier can route without parsing
  3     version (1)
  4     kind: 0x01 opaque binary | 0x02 structured event (UTF-8 JSON body)
  5     channel-name length in bytes (1..255)
  6..   channel name (UTF-8)
  +4    seq (uint32) — sender-assigned, monotonic per channel, shared by both kinds
  ...   body: opaque bytes, or UTF-8 JSON `{ "event": string, "payload": … }`
  ```

  No body length prefix: the carrier already delimits the message (a WebSocket frame is a message
  boundary), so a length field would be a second source of truth that can disagree with the first.

- **REMOTE-007 transport-neutral permission/ask.** The handler forwards the session's
  `permission_request` / `ask_request` / `prompt_resolved` events as `TServerMessage`s and dispatches the
  inbound `permission-response` / `ask-response` verbs to `session.resolvePermission` / `resolveAsk`. So a
  driving client (WS or, via the same handler, WebRTC) renders + answers the SAME prompt as the local
  operator (local == remote); the first answer wins and `prompt_resolved` dismisses it on co-drive. A client
  disconnect (`cleanup` → `session.off`) drops the prompt listeners, and the session's reconcile-on-detach
  fails the prompt closed (deny/cancel) so a mid-prompt disconnect cannot hang the awaiting tool.
- **ARCH-020/028 total session-event delivery.**
  `PROTOCOL_SESSION_EVENT_CLASSIFICATION` is an exhaustive
  `Record<TInteractiveEventName, 'forwarded' | 'requester-routed' | 'non-surface'>`. The actual
  `subscribeSessionEvents` registrations are mechanically compared with every non-`non-surface`
  entry. `plan_event`, `context_file_refreshed`, and `branch_event` are forwarded as identically named
  `TServerMessage` variants.
- **ARCH-030 one outbound delivery boundary per connection.** Every outbound `TServerMessage` — the
  session-event fan-out AND every reply to an inbound frame — leaves through one
  `TOutboundDeliver`, produced by `createOutboundDelivery(send, onDeliveryError)`. The **carrier**
  builds it, from its own raw sink and its own failure policy, and passes it down as
  `IWsHandlerOptions.deliver`; the protocol package never receives a raw sink. `TOutboundDeliver` is
  branded and `createOutboundDelivery` is its only producer, so a plain
  `(message: TServerMessage) => void` is refused by the compiler wherever a boundary is required —
  the mechanical floor that keeps a future reply family from reaching the wire unguarded.

  **Semantics.** A carrier failure is reported through `onDeliveryError(error, message.type)` and
  never thrown at the caller, so a reply resolving after a disconnect cannot escape as an unhandled
  rejection or out of the carrier's inbound listener, and an already-committed session operation is
  never reversed. A handler that itself throws is isolated. **The boundary LATCHES:** it reports at
  most ONE failure, after which every subsequent frame is dropped without a further report — all
  three carriers treat a delivery failure as terminal and each had grown its own latch to suppress
  the repeats.

  `SessionResumeBridge` builds a **fresh boundary per `attach`**, which is what un-latches the
  session after a reconnect; `detach` clears it and buffering continues. A frame is appended to the
  resume buffer BEFORE the boundary, so a dropped frame stays in the un-acked tail and replays on
  the next sink, and a failing multi-frame `replay()` reports exactly once.

  Before ARCH-030 the fan-out had its own guard and the eleven reply families had none — five of
  them resolving from a Promise continuation, which is the shape WS-001 recorded and half-fixed.

- **CMD-004 Phase 2 host-action/UI-intent split.** An inbound `command` verb passes the handler's
  SERVER-ASSIGNED `driverId` (REMOTE-014 E5 — never a client-sent one) into
  `session.executeCommand(name, args, 'remote', driverId)` so the session executes host actions
  host-side BEFORE `command_result` is sent (the pre-CMD-004 handler dropped `result.effects` on the
  floor). The handler forwards the session's `ui_intent` events as `{ type: 'ui_intent', event }`
  server messages (same pattern as `ask_request`); the event needs no answer (fire-and-forget).
  **Stage D — `ui_intent` is REQUESTER-ROUTED server-side:** `subscribeSessionEvents` delivers an
  intent only when `event.requesterDriverId` matches THIS surface's server-assigned driver id (read
  lazily via `ISubscribeSessionEventsOptions.getSurfaceDriverId` — lazy because the resume bridge
  binds its id only at pairing). Other surfaces never see it. An UNATTRIBUTED intent (no requester
  id — e.g. an idle model-invoked command) is unroutable and reaches every surface (never a silent
  drop). In the `SessionResumeBridge`, routing happens BEFORE seq-stamping/buffering, so a foreign
  surface's intent consumes no seq and cannot leak through a later `resume` replay.
  **Stage E — broadcast session-state events:** `subscribeSessionEvents` forwards the session's
  `session_renamed` (`{ type: 'session_renamed', event }`) and `history_cleared`
  (`{ type: 'history_cleared' }`) events to EVERY attached surface, unfiltered — the host executed
  the rename/clear; co-driving titles and transcripts follow the broadcast.
- **REMOTE-014 E5 co-drive attribution (SERVER-ASSIGNED, display-only).** `IWsHandlerOptions.driverId` binds a
  surface's server-assigned driver id (the E3 `deviceId`; the SessionResumeBridge sets it at pairing via
  `setDriverId`). The handler INJECTS it into every inbound `submit` / `permission-response` / `ask-response`
  — a client can never send its own id, so authorship is not forgeable. Outbound, `subscribeSessionEvents`
  SELECTIVELY stamps the eight turn-authored events (`text_delta`, `user_message`, `tool_start`/`tool_end`,
  `thinking`, `complete`, `interrupted`, `error`) with the active turn's `driverId` read from
  `session.getActiveDriverId()`; background / job-group / execution-workspace events are NEVER stamped (not
  authored by a driver turn). **Invariant:** `driverId` is DISPLAY attribution only, never an authorization
  input — the OWNER PRINCIPLE (local == remote) governs who may act; every paired driver holds owner authority.

`IProtocolSession` is the exact shared protocol capability: turn submission/control, commands,
events, prompt resolution, conversation/execution reads, driver attribution, background tasks and
groups, and execution-workspace reads. WS and WebRTC reuse this one named protocol-owned aggregate;
they do not rebuild anonymous intersections or require the unrelated lifecycle/goal/identity roles.

## Boundaries

- **Contains runtime logic** (the handler) — so it is NOT `agent-interface-transport` (which bans runtime code,
  INFRA-035). It is a leaf below every transport implementation.
- **Dependencies: `@robota-sdk/agent-interface-transport` ONLY.** No `agent-core`, no `ws`, no `node:` sockets
  (verified). Transport implementations (`-ws`, `-webrtc`) depend DOWN on this package; it depends on none of
  them (no cycle).

### Peer-message ledger (PEER-001, #1809)

The issue requires delivery, acknowledgement, duplicate, retry and shutdown to produce
"deterministic, documented outcomes". Every one is a question about what the receiver has **seen
before**, which no carrier can answer — a data channel redelivers on reconnect, a retry repeats a
message, and neither the socket nor the frame codec has memory to consult. So the decision lives here
once and the carriers stay dumb.

| Rule                                            | Why it is this way                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A repeated `id` returns the **original** ack    | A message must never get two contradictory answers; a retry of a refusal stays refused                                                                                                                                                                        |
| Sequence is **per origin**                      | Two peers are independent senders; a shared counter makes one peer's traffic look like the other's gap                                                                                                                                                        |
| A gap is **reported, never reordered**          | Buffer-and-reorder is a session-layer policy; inventing it here would hide a lost message behind an apparent success                                                                                                                                          |
| A new id on a **delivered** sequence is refused | A retry repeats its id, so this is a protocol error rather than a duplicate. Membership, not a high-water mark: a gap that arrives LATE was never delivered, and refusing it would contradict the row above by denying the session the choice it was promised |
| Nothing survives the ledger                     | State is per connection by construction — a reconnecting peer gets a fresh sequence space                                                                                                                                                                     |

## Public API Surface

| Export                                  | Kind      |
| --------------------------------------- | --------- |
| `resolveAdmission`                      | Function  | SEC-008: the one place a transport asks what credential it requires (secure by default)    |
| `createPeerMessageLedger`               | Function  | PEER-001: fresh per-connection receive state for peer messaging                            |
| `admitPeerMessage`                      | Function  | PEER-001: record a peer message and decide deliver / duplicate / refused, reporting gaps   |
| `acknowledgePeerMessage`                | Function  | PEER-001: promote a delivered message to acknowledged (a different question from delivery) |
| `forgetPeerOrigin`                      | Function  | PEER-001: drop one peer's sequence space on disconnect, so a reconnect starts fresh        |
| `mintTransportToken`                    | Function  | SEC-008: mint a per-launch credential; throws rather than returning a weak one             |
| `credentialMatches`                     | Function  | SEC-008: constant-time comparison of a presented credential against the required one       |
| `bearerCredential`                      | Function  | SEC-008: extract a bearer credential from an `Authorization` header value                  |
| `createWsHandler`                       | function  |
| `IWsHandlerOptions`                     | interface |
| `createOutboundDelivery`                | function  | ARCH-030: the ONLY producer of a connection's outbound delivery boundary                   |
| `TOutboundDeliver`                      | type      | ARCH-030: the branded boundary a carrier passes down as `IWsHandlerOptions.deliver`        |
| `TDeliveryErrorHandler`                 | type      | ARCH-030: a carrier's failure policy — required, invoked at most once per boundary         |
| `PROTOCOL_SESSION_EVENT_CLASSIFICATION` | constant  | Exhaustive protocol surface policy for every shared session-event key                      |
| `TProtocolSessionEventClassification`   | type      | The classification vocabulary the constant is keyed by                                     |
| `TClientMessage`                        | type      |
| `TServerMessage`                        | type      |
| `TSeqServerMessage`                     | type      |
| `ResumeBuffer`                          | class     |
| `IResumeBufferOptions`                  | interface |
| `IBufferedFrame`                        | interface |
| `TResumeTail`                           | type      |
| `SessionResumeBridge`                   | class     |
| `ISessionResumeBridgeOptions`           | interface |
| `TResumeSink`                           | type      |
| `IAttachOptions`                        | interface |
| `encodeBinaryFrame`                     | function  |
| `encodeChannelEventFrame`               | function  |
| `decodeChannelFrame`                    | function  |
| `isChannelFrame`                        | function  |
| `CHANNEL_FRAME_MAGIC`                   | constant  |
| `CHANNEL_FRAME_VERSION`                 | constant  |

## Type Ownership

| Type/Symbol              | Location                   | Purpose                                                 |
| ------------------------ | -------------------------- | ------------------------------------------------------- |
| `createWsHandler`        | `src/ws-handler.ts`        | Session↔client bridge over `deliver`/`onMessage`        |
| `createOutboundDelivery` | `src/outbound-delivery.ts` | The one connection-scoped outbound boundary             |
| `TOutboundDeliver`       | `src/outbound-delivery.ts` | The branded boundary type; only the factory produces it |
| `TClientMessage`         | `src/ws-protocol.ts`       | Inbound client wire messages                            |
| `TServerMessage`         | `src/ws-protocol.ts`       | Outbound server wire messages                           |

The TRANS-001 channel frame codec owns the ENVELOPE only; the frame/channel CONTRACT types
(`IBinaryFrame`, `IChannelEventFrame`, `TChannelReceiveResult`, …) are owned by
`@robota-sdk/agent-interface-transport` and imported type-only from there.

## Test Strategy

`src/__tests__/ws-handler.test.ts` (moved from `agent-transport-ws`) covers the session-event → `TServerMessage`
subscription and inbound `TClientMessage` dispatch with a stubbed session (no socket, no real provider),
including the REMOTE-007 prompt-event forwarding and the `permission-response` / `ask-response` → `resolve*`
dispatch (TC-06). `src/__tests__/session-event-delivery.test.ts` mechanically compares the real
subscriptions and teardown handlers with the exhaustive classification, verifies plan/context/branch
fan-out, and proves a throwing carrier is reported without escaping the session listener.
`src/__tests__/session-resume-bridge.test.ts` proves sink failure detaches while retaining the frame, and
(ARCH-030) that a failing multi-frame replay reports once, its frames replay on the next sink, and a fresh
`attach` un-latches the connection. Those three pass against the PRE-ARCH-030 bridge too and are recorded
as such: the bridge path was already guarded, so they guard the restructure rather than red-prove a defect. `src/__tests__/outbound-delivery.test.ts` covers the boundary itself:
all eleven reply families after a disconnect (five Promise continuations asserting zero unhandled
rejections, six synchronous ones asserting nothing escapes `onMessage`), the latch, observer isolation,
and a `@ts-expect-error` case that fails typecheck if the brand is ever dropped.
`src/__tests__/channel-frames.test.ts` (TRANS-001) covers the channel codec: opaque
round-trip integrity (including non-UTF-8 bytes), chunked reassembly by `seq` from out-of-order delivery,
multi-byte channel names, encoder input validation, and every malformed-input error result.
