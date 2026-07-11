---
title: 'REMOTE-014: Stage E5 — co-drive concurrency + attribution'
status: done
completed: 2026-07-12
created: 2026-07-11
priority: medium
urgency: later
area: packages/agent-transport-protocol, packages/agent-cli, packages/agent-web-ui
depends_on: []
---

# REMOTE-014: Stage E5 — co-drive concurrency + attribution

Parent: [REMOTE-001](REMOTE-001-webrtc-p2p-remote-control.md). Stage E decomposition (2026-07-11):
E1 = TURN (REMOTE-010, DONE); E2 = signaling abuse (REMOTE-011); E3 = TOFU reconnect (REMOTE-012);
E4 = reconnection/session-resume (REMOTE-013); **E5 = co-drive concurrency + attribution (this)** — the
last Stage-E item, sequenced after the hardening + reconnect pieces because it changes the session/input
model rather than merely hardening it.

## Problem / Goal

The local host and a remote peer share the SAME live session (mirror + co-drive) — both can send input.
Today input arbitration and authorship are implicit: when two drivers (local TUI + remote client, or
multiple remote peers if allowed) submit near-simultaneously, there is no defined ordering, no indication
of **who** issued a given prompt/command, and no per-driver permission attribution. For a shared session
this is both a correctness problem (interleaved input) and a trust problem (an action's origin is
invisible, so the permission decision cannot be tied to the actor).

Goal: a defined **co-drive concurrency model** with **per-message attribution** — every input frame
carries a driver identity, the session serializes concurrent input deterministically, and both the local
TUI and the remote client can see who did what (and permission prompts name the requesting driver).

## Scope / Approach (to be confirmed in the spec)

- **Driver identity in the protocol:** extend the transport-protocol framing so each client→session input
  frame carries an authenticated driver id (bound to the pairing / E3 device identity, not client-asserted).
- **Input arbitration:** define serialization for concurrent input (e.g. single-writer token, or ordered
  queue with fairness) so two drivers cannot interleave a single logical turn; specify the policy
  (turn-taking vs. last-writer, host-configurable).
- **Attribution surfacing:** the session event stream tags each prompt/command/permission with its driver;
  local TUI + remote client render authorship; permission/ask prompts (REMOTE-007) name the requesting
  driver so the approver knows whose action they are authorizing.
- **Permission attribution:** a remote driver remains subject to the same permission/command gating; the
  gate decision is recorded against the actual driver, not the session generically.

## Test Plan

- Unit: framing carries + validates an authenticated driver id; arbitration serializes two concurrent
  inputs deterministically per the chosen policy; attribution tag is attached to each session event.
- Integration: local TUI + remote client both drive; concurrent submissions are serialized (no
  interleaving) and each rendered with the correct author; a permission prompt names the requesting driver;
  a remote driver cannot exceed the local permission policy.
- Security: driver id cannot be spoofed by a client (bound to device identity); attribution cannot be
  forged onto another driver.
- Harness: `pnpm harness:scan` + typecheck + build green.

## User Execution Test Scenario

1. **Two drivers, deterministic ordering, visible authorship.**
   - Prerequisites: host `agent-cli` `/remote-control` with a paired remote client; both local TUI and
     remote client active on the same session.
   - Steps: submit a prompt from the local TUI and one from the remote client at nearly the same time;
     then trigger a tool that requires permission from the remote client.
   - Expected: the two prompts are serialized in a defined, non-interleaved order; each turn shows who
     authored it on BOTH surfaces; the permission prompt identifies the remote client as the requester and
     enforces the same policy as a local action.
   - Evidence: _(fill after implementation)_

## Notes

E5 changes the session/input contract (protocol + session), so it is the highest-blast-radius Stage-E
item — sequence it last. It builds naturally on E3 device identity (attribution should bind to the same
identity) but is specced independently; if E3 slips, E5 can fall back to pairing-scoped driver ids.
