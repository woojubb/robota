---
title: 'REMOTE-013: Stage E4 — reconnection / session-resume'
status: todo
created: 2026-07-11
priority: medium
urgency: later
area: packages/agent-transport-webrtc, packages/agent-transport-protocol, packages/agent-cli, packages/agent-web-ui
depends_on: ['REMOTE-012']
---

# REMOTE-013: Stage E4 — reconnection / session-resume

Parent: [REMOTE-001](REMOTE-001-webrtc-p2p-remote-control.md). Stage E decomposition (2026-07-11):
E1 = TURN (REMOTE-010, DONE); E2 = signaling abuse (REMOTE-011); E3 = TOFU trusted-device reconnect
(REMOTE-012); **E4 = reconnection/session-resume (this, on E3)**; E5 = co-drive attribution (REMOTE-014).

## Problem / Goal

A WebRTC data channel drops on any network blip (Wi-Fi handoff, sleep/wake, NAT rebind, TURN hiccup).
Today a drop ends the remote session: the peer connection is torn down and the client must start over —
re-pair (unless E3 lands) and lose its view of the in-flight exchange. For a "drive my agent from my
phone" use case this is fragile: a transient drop should self-heal, not end the session.

Goal: **automatic reconnection with session-resume** — when the transport drops, the client re-establishes
the P2P channel (recognized via E3 TOFU, no fresh accept) and resumes the SAME logical agent session,
including any output streamed while disconnected, without duplicating or losing frames.

## Scope / Approach (to be confirmed in the spec)

- **Reconnect loop (client):** detect data-channel/ICE disconnect, re-run signaling + ICE (perfect-
  negotiation / ICE restart) with bounded backoff; re-open the channel to the same host session.
- **Session-resume contract:** a resume token / last-acked sequence in the transport-protocol framing so
  the host can replay or fast-forward the stream from the client's last acknowledged point — exactly-once
  delivery semantics across the reconnect (no dropped or duplicated `TServerMessage`).
- **Host-side buffering:** bounded buffer of un-acked output so a brief disconnect can be replayed; the
  host session itself keeps running while the peer is gone (already the case — confirm no teardown on
  peer drop).
- **Identity on reconnect:** the reconnecting peer is authenticated via E3 (trusted device), not a new
  pairing — hence the `depends_on: REMOTE-012`.

## Test Plan

- Unit: resume-token / sequence bookkeeping (last-acked advance, replay window bounds, exactly-once).
- Integration: two in-process peers establish a channel, force a disconnect mid-stream, and confirm the
  client reconnects and resumes with no lost/duplicated frames; backoff bounds honored; host session
  survives the peer drop.
- Security: a reconnect still passes the E3 trusted-device challenge; a non-trusted peer cannot resume
  another device's session (resume token is bound to the device identity, not guessable).
- Harness: `pnpm harness:scan` + typecheck + build green.

## User Execution Test Scenario

1. **Transient drop self-heals without losing the exchange.**
   - Prerequisites: host `agent-cli` `/remote-control`; a trusted (E3) browser client mid-conversation.
   - Steps: send a prompt that streams a long response; mid-stream, drop the client's network briefly
     (toggle Wi-Fi / sleep), then restore it.
   - Expected: the client reconnects automatically (no re-pair, no fresh accept), the streamed response
     continues from where it left off with no missing or duplicated output, and `/remote-control status`
     shows the same peer resumed (not a new one).
   - Evidence: _(fill after implementation)_

## Notes

Depends on E3 (REMOTE-012): resume must re-authenticate the reconnecting peer as a trusted device, not
open a fresh pairing. This is the first Stage-E item that changes the transport-protocol framing (resume
token / sequence), so it is a contract-boundary change — validate reachability across host + browser peers.
