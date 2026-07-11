---
title: 'REMOTE-012: Stage E3 — TOFU trusted-device reconnect'
status: todo
created: 2026-07-11
priority: medium
urgency: later
area: packages/agent-remote-pairing, packages/agent-cli, packages/agent-web-ui
depends_on: []
---

# REMOTE-012: Stage E3 — TOFU trusted-device reconnect

Parent: [REMOTE-001](REMOTE-001-webrtc-p2p-remote-control.md). Stage E decomposition (2026-07-11):
E1 = TURN (REMOTE-010, DONE); E2 = signaling abuse (REMOTE-011); **E3 = TOFU trusted-device reconnect
(this)**; E4 = reconnection/session-resume (REMOTE-013, on E3); E5 = co-drive attribution (REMOTE-014).

## Problem / Goal

Today every connection requires a fresh out-of-band pairing: the host shows a QR/link carrying a
one-time pairing secret and the client pairs with an explicit host-side accept. That is correct for a
first contact, but it makes a **returning, already-trusted device** re-pair from scratch every time —
poor UX and it trains the user to approve pairing prompts reflexively (which weakens the security of the
prompt itself).

Goal: a **Trust On First Use (TOFU)** model — after a successful first pairing + explicit host accept, the
host may **remember that device** (an identity derived from the established channel) so a later reconnect
from the same device can be recognized and (per host policy) resume without a full re-pair, while an
unknown device still goes through the full first-use pairing + accept.

## Scope / Approach (to be confirmed in the spec)

- **Device identity:** derive a stable, non-secret device identifier from the established pairing —
  building on `deriveSessionKey` (`packages/agent-remote-pairing/src/pairing.ts:155`) / the directional-HMAC
  channel-binding (REMOTE-005). The stored value must NOT be the pairing secret itself and must not enable
  impersonation if the host's trust store leaks (store a commitment/derived id, not a replayable secret).
- **Host trust store:** persist accepted device ids locally (host side), with user-visible list +
  revoke. Fail-closed: an unrecognized or revoked device falls back to full pairing.
- **Reconnect recognition:** on a new connection, prove possession of the trusted device identity
  (challenge/response over the channel binding) before the host treats it as trusted — never trust a
  client-asserted id alone.
- Client stores its side of the trust material in a fragment-scoped / device-local store (never in a
  relayed or query-visible location — same discipline as the pairing secret).

## Test Plan

- Unit (pairing): device-id derivation is stable across reconnects and NOT equal to the pairing secret;
  a leaked trust-store entry cannot be replayed to impersonate without the device-held material.
- Integration: first pairing → host accept → store; reconnect from the same device is recognized
  (challenge/response passes) without a new accept prompt; an unknown device still requires full pairing;
  a revoked device is refused fail-closed.
- Security: forged/copied device id without the device-held secret fails the challenge; trust-store leak
  does not grant reconnect.
- Harness: `pnpm harness:scan` + typecheck + build green.

## User Execution Test Scenario

1. **Trusted device reconnects without re-pairing; unknown/revoked device does not.**
   - Prerequisites: host `agent-cli` with `/remote-control`; a browser client.
   - Steps: pair the client once and accept on the host; disconnect; reconnect from the same browser;
     then revoke the device on the host and reconnect again; then connect from a different browser.
   - Expected: the first reconnect is recognized and resumes per host policy with no fresh accept prompt;
     after revoke, the same browser must re-pair; the different browser always goes through full
     first-use pairing + accept.
   - Evidence: _(fill after implementation)_

## Notes

E3 introduces persistent host-side trust state — treat it as security-sensitive (SECURITY-typed spec).
It is a prerequisite for E4 (session-resume needs a recognized device to resume against).
