---
title: 'TRANS-001: payload-agnostic transport — binary/opaque frames + custom event types'
status: done
created: 2026-07-03
priority: low
urgency: later
area: packages/agent-interface-transport, packages/agent-transport-ws
depends_on: []
---

# Payload-agnostic transport

Gap analysis G2/G5 (`.design/gap-analysis-realtime-voice-agent-app.md`, P1/P2 in its roadmap): the
speech app's realtime channel carries mic audio chunks (up), TTS clips (down), captions, coaching
events, and speaker state — but `agent-transport-ws` speaks a text-agent wire protocol
(`text_delta`/`abort` …), so reusing it meant fighting the protocol and they built their own channel,
erasing the reuse benefit of the transport layer entirely.

Read with the source doc's own caveats: its code evidence is marked ⚠️ (README/grep snapshot) — the
design pass must first re-verify what `agent-interface-transport` actually supports today.

## What (problem + intent — design is its own GATE-WRITE pass)

1. **Payload-agnostic frames**: a binary/opaque frame channel alongside the structured events, so
   audio (or any blob) rides the same connection without abusing the text protocol.
2. **Custom event registration**: consumers declare app-level event types (captions, speaker-state)
   that flow through the channel with type safety, instead of forking the protocol.
3. **Separation**: the text-delta agent protocol becomes one profile ON the generic transport, not
   the transport itself (CMD-004 precedent: contracts below, per-environment behavior above).

**Rescoped 2026-07-03 (owner decision, ROOM-001 principle)**: the former item 4 — G5
`ISttAdapter`/`ITtsAdapter` contracts + streaming audio types ("open the voice-agent app class")
— is REMOVED from robota scope. Voice/STT/TTS are app-domain contracts; putting them in the
library is the same "finished product imitating an ingredient" class that withdrew ROOM-001.
Items 1–3 remain: binary/opaque frames and consumer-declared event types are content-neutral
carrier mechanics (a WebSocket-class ingredient) usable by ANY payload domain (files, images,
audio, app events). Voice apps assemble their own adapters on top.

Product-direction note: confirm scope/priority at GATE-APPROVAL before design.

## Test Plan

- Unit: binary frame round-trip (order + integrity), custom event registration/dispatch typing,
  text-delta profile regression on the refactored base.
- Functional: a demo channel carrying interleaved text deltas + binary frames + one custom event.

## User Execution Test Scenarios

- Prereq: example app (or test rig) streaming an arbitrary binary file as opaque frames alongside a
  text turn (any payload domain — the transport must not know or care what the bytes are).
- Steps: run it over the ws transport; verify receiver-side reassembly (byte-identical, ordered).
- Expected: binary frames arrive intact and ordered alongside text events on one connection.
- Evidence: agent-run — `packages/agent-transport-ws/src/__tests__/ws-payload-channel.e2e.test.ts`
  (4/4 pass). See the Outcome section below for the full result.

## Outcome (2026-07-25)

**DONE.** All three findings were RE-VERIFIED against current code (post CMD-004 Phase 2 Stages A–E,
post TYPE-003) before any implementation — none had been resolved by the intervening refactors:

1. **No binary/opaque frames** — CONFIRMED still open. `WsTransport` sent only
   `ws.send(JSON.stringify(message))` and read only `onMessage(String(data))`; a grep for
   `isBinary` / `binaryType` / `Uint8Array` across `agent-transport-ws`, `agent-transport-protocol`,
   and `agent-interface-transport` returned no frame handling at all (the only `Buffer` hits were
   `timingSafeEqual` token comparison and the `ResumeBuffer` class name).
2. **No custom event registration** — CONFIRMED still open. `TClientMessage` / `TServerMessage` were
   closed unions in `agent-transport-protocol`; `handleClientMessage` answered anything outside them
   with `protocol_error: Unknown message type`. A consumer could only add an app event by editing
   the shared agent protocol.
3. **No separation** — CONFIRMED still open. `WsTransport.tryBind` hard-wired `createWsHandler` plus
   the agent-protocol handshake frames (`messages`, `execution_workspace_event`); the carrier
   mechanics (bind/retry, SEC-001 auth, Host/Origin gating, drain-then-terminate stop) could not be
   reused by any non-agent payload.

### What shipped

- `agent-interface-transport` — new `channel-contracts.ts` (types only, package purity preserved):
  `IBinaryFrame`, `IChannelEventFrame`, `TChannelFrame`, `TChannelEventMap`, `IChannelDescriptor`,
  `IPayloadChannel`, `IPayloadChannelHost`, `TChannelReceiveResult`.
- `agent-transport-protocol` — new `channel-frames.ts`, a pure `RBF`-magic frame codec
  (`encodeBinaryFrame` / `encodeChannelEventFrame` / `decodeChannelFrame` / `isChannelFrame`).
  MINIMAL and additive: `TClientMessage` / `TServerMessage` are untouched, so no consumer's
  exhaustive handling breaks. Placed here (not in `-ws`) because this package IS the shared wire
  protocol layer and a WebRTC data channel is the obvious second carrier.
- `agent-transport-ws` — `WsTransport` now also implements `IPayloadChannelHost` and routes by
  WebSocket **frame opcode**: TEXT → the text-agent protocol profile, BINARY → the new
  `PayloadChannelRegistry`. That is item 3's separation made concrete without restructuring
  `createWsHandler`. Connection guards were split into `ws-connection-guards.ts` (file-size ratchet).

Content-neutrality held: nothing in the shipped code names audio, files, or images. The 2026-07-03
rescope (former item 4, `ISttAdapter`/`ITtsAdapter`) stays out of scope as decided.

### Evidence

- RED before GREEN: `channel-frames.test.ts` and `payload-channels.test.ts` failed with
  `Cannot find module`; the e2e failed with `transport.registerChannel is not a function` /
  `encodeBinaryFrame is not a function`. The 4th e2e case (text-agent profile regression guard)
  PASSED pre-change, as it must.
- GREEN: `agent-transport-protocol` 73/73, `agent-transport-ws` 35/35 (15 registry + 4 e2e new).
- Downstream: `agent-transport` 56, `agent-transport-tui` 526, `agent-transport-webrtc` 29,
  `agent-transport-gui` 18, `-http` 22, `-mcp` 7, `agent-framework` 1258, `agent-cli` 238,
  `agent-session` 131, `agent-executor` 87, `agent-interface-transport` 21 — all pass.
- `pnpm build`, `pnpm -w typecheck`, and `node scripts/harness/run-all-scans.mjs` (61/61, incl.
  `interface-runtime` and `spec-public-surface`) all green.

### User Execution Test Scenarios — result

`ws-payload-channel.e2e.test.ts` runs a real `WsTransport` over a real WebSocket:

- 64 KiB of `randomBytes` (invalid UTF-8, JSON-hostile) streamed as 16 opaque 4 KiB frames
  interleaved with 16 `text_delta` events plus one consumer-declared `manifest` event, on ONE
  connection → all arrive, `seq` monotonic, reassembly byte-identical (`Buffer.equals`), and the
  text-agent handshake + every delta still land.
- The reverse direction (client → server, 20 KB in 7 chunks) reassembles byte-identically in order.
- A frame for an unregistered channel is answered with an explicit `protocol_error`, never dropped.
