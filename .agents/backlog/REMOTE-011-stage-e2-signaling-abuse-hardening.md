---
title: 'REMOTE-011: Stage E2 — signaling-server abuse hardening'
status: todo
created: 2026-07-11
priority: medium
urgency: later
area: apps/remote-signaling
depends_on: []
---

# REMOTE-011: Stage E2 — signaling-server abuse hardening

Parent: [REMOTE-001](REMOTE-001-webrtc-p2p-remote-control.md). Stage E (final hardening) decomposition
(grounding 2026-07-11): E1 = TURN fallback (REMOTE-010, DONE); **E2 = signaling-server abuse hardening
(this)**; E3 = TOFU trusted-device reconnect (REMOTE-012); E4 = reconnection/session-resume (REMOTE-013,
on E3); E5 = co-drive concurrency + attribution (REMOTE-014). E2 is **self-contained and protocol-free**
— it hardens only `apps/remote-signaling` and needs no change to the pairing protocol or the session
contract, so it can proceed independently of E3–E5.

## Problem / Goal

The signaling server (`apps/remote-signaling`) is the one owner-hosted, publicly reachable component. It
relays SDP offers/answers + ICE candidates by rendezvous id and holds no session content — but a public
rendezvous endpoint with no abuse controls is exploitable by an unauthenticated attacker:

- **Rendezvous-slot hijack / squatting:** a peer that is not the paired client claims or races for a
  rendezvous id, intercepting the host's offer or denying the real client its slot.
- **Enumeration / flooding:** brute-forcing or spraying rendezvous ids to discover live sessions or to
  exhaust server memory/connection slots (DoS).
- **Oversized / malformed frames:** unbounded or malformed signaling messages consuming resources or
  crashing the relay.
- **Replay / stale-slot reuse:** reconnecting against an expired or already-consumed rendezvous id.

Goal: add abuse hardening to the signaling server while keeping it strictly minimal and content-free —
no session payload, no long-term state beyond what a rendezvous needs.

## Scope / Approach (to be confirmed in the spec)

- **Per-connection + per-IP rate limiting** on rendezvous registration and message relay; connection caps.
- **Rendezvous-slot exclusivity:** a rendezvous id is claimed by exactly the two expected roles
  (host + one client); additional claimants are refused. Short-lived, single-use slot with TTL/expiry.
- **Message validation:** strict allowlist of signaling message kinds (offer/answer/ice), bounded size,
  schema-validated shape; reject anything else fail-closed.
- **High-entropy rendezvous ids** (already pairing-secret-bound; confirm enumeration resistance) and
  slot expiry so stale ids cannot be reused.
- No new dependency-direction violation; the server stays a minimal SSOT with no session content.

## Test Plan

- Unit/integration (server): slot-exclusivity (second claimant refused); rate-limit trips at threshold;
  oversized/malformed frame rejected fail-closed; expired rendezvous rejected; valid two-party rendezvous
  still succeeds end-to-end (regression).
- Security: an attacker connection cannot hijack a rendezvous already claimed by the paired pair, cannot
  enumerate live ids within the rate budget, and cannot exhaust slots below the cap.
- Harness: `pnpm harness:scan` + typecheck + build green.

## User Execution Test Scenario

1. **Abuse controls hold under a hostile second peer.**
   - Prerequisites: `apps/remote-signaling` running; a host `/remote-control on` with a rendezvous id;
     a legitimate client paired.
   - Steps: from a third (attacker) connection, attempt to (a) claim the same rendezvous id, (b) spray N
     random ids past the rate threshold, (c) send an oversized/malformed frame.
   - Expected: (a) refused (slot already claimed) — the legitimate pair stays connected; (b) throttled
     after the threshold with no server memory blowup; (c) connection dropped fail-closed. The legitimate
     host↔client P2P session is unaffected throughout.
   - Evidence: _(fill after implementation)_

## Notes

Keep the signaling server content-free; all security- and content-sensitive logic stays on the P2P
channel. This item is the orthogonal sibling of E1 (TURN) — both are hardening-first and protocol-free.
