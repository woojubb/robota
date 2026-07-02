---
title: 'TRANS-001: payload-agnostic transport — binary/audio frames + custom event types (voice/multimodal direction)'
status: todo
created: 2026-07-03
priority: low
urgency: later
area: packages/agent-interface-transport, packages/agent-transport-ws
depends_on: []
---

# Payload-agnostic transport (+ audio adapter contracts follow-on)

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
4. **Follow-on (G5, separate scope once 1–3 exist)**: `ISttAdapter`/`ITtsAdapter` contracts +
   streaming audio types, so voice implementations (Deepgram/ElevenLabs class) can plug in as
   community blocks — together these open the voice-agent app class on robota.

Product-direction note: this is the "voice/multimodal direction" investment — confirm at
GATE-APPROVAL before design.

## Test Plan

- Unit: binary frame round-trip (order + integrity), custom event registration/dispatch typing,
  text-delta profile regression on the refactored base.
- Functional: a demo channel carrying interleaved text deltas + binary frames + one custom event.

## User Execution Test Scenarios

- Prereq: example app (or test rig) streaming an audio file as binary frames alongside a text turn.
- Steps: run it over the ws transport; verify playback-side reassembly.
- Expected: audio arrives intact and ordered alongside text events on one connection.
- Evidence: _to fill at implementation._
