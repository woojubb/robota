---
title: 'REMOTE-001: /remote-control — WebRTC P2P remote access to a running agent-cli session'
status: in-progress
created: 2026-07-10
priority: medium
urgency: later
area: packages/agent-cli, packages/agent-transport, apps/(new signaling server)
depends_on: []
---

# REMOTE-001: WebRTC P2P remote control for agent-cli

> **Phase status (2026-07-10):** Research DONE; design ENDORSED (proposal-reviewer, 2 rounds) —
> see [`.agents/spec-docs/todo/REMOTE-001-webrtc-p2p-remote-control-design.md`](../spec-docs/todo/REMOTE-001-webrtc-p2p-remote-control-design.md).
> Implementation proceeds as per-stage gated specs (Stage A: extract `agent-transport-protocol` +
> `agent-transport-webrtc` skeleton + minimal signaling server, loopback-only, no enable path).
>
> **Stage progress (2026-07-11):** Stages A–D DONE + on main (REMOTE-002…009) — the full user story
> ships (host `/remote-control` → QR/link → browser pairs + co-drives over WebRTC). **Stage E (final
> hardening)** is decomposed into child backlog items, sequenced:
>
> - E1 = user-supplied TURN fallback — REMOTE-010, **DONE** (`.agents/spec-docs/done/`).
> - E2 = signaling-server abuse hardening — [REMOTE-011](REMOTE-011-stage-e2-signaling-abuse-hardening.md) (self-contained).
> - E3 = TOFU trusted-device reconnect — [REMOTE-012](REMOTE-012-stage-e3-tofu-trusted-device-reconnect.md).
> - E4 = reconnection/session-resume — [REMOTE-013](REMOTE-013-stage-e4-reconnection-session-resume.md) (on E3).
> - E5 = co-drive concurrency + attribution — [REMOTE-014](REMOTE-014-stage-e5-co-drive-concurrency-attribution.md).
>
> This item stays `in-progress` until Stage E completes and the User Execution Test Scenario evidence
> below is filled.

## Problem / Goal

A user running `agent-cli` locally (coding with the agent) wants to **turn on remote access** with a
`/remote-control` command and then reach and drive that same running session **from an external device**
(another laptop, a phone browser, etc.). The connection must be:

- **Peer-to-peer (WebRTC)** between the local `agent-cli` host and the remote client — no agent traffic
  routed through a vendor-hosted server.
- **Encrypted end-to-end** in transit (WebRTC data channels are DTLS-encrypted by default; evaluate whether an
  additional app-layer auth/encryption is warranted).
- Backed only by a **minimal signaling server** (SDP/ICE exchange + rendezvous), which the project owner is
  willing to host and open-source. No TURN/relay of session content by default (P2P direct; a user-supplied
  TURN is an optional fallback for NAT-restricted networks — call this out as a knob, not a hosted service).

The explicit constraint is open-source friendliness: unlike Claude Code / Codex remote features that lean on
vendor infrastructure, this must work with a tiny self-hostable signaling server + P2P.

## Execution Plan (this backlog is research-first)

This item is **not** ready to implement directly — it must go through the spec gate. Execute in phases:

1. **Research phase (read-only).** Study how existing agent CLIs expose remote control and what maps onto a
   P2P model:
   - Claude Code remote/headless + any "connect from elsewhere" surface (web, mobile), its transport, auth,
     and session-attach model.
   - OpenAI Codex CLI remote/cloud control surface, if any, and its transport/auth model.
   - WebRTC building blocks: `RTCPeerConnection` + `RTCDataChannel`, DTLS, ICE/STUN/TURN, perfect-negotiation
     pattern, and Node-side WebRTC (e.g. `node-datachannel` / `werift` / `wrtc`) viability for the CLI host.
   - The repo's existing transport seam: `packages/agent-transport` + `TRANS-001` (payload-agnostic transport)
     - `agent-interface-transport` contracts — a WebRTC transport should be an adapter behind the existing
       transport port, not a bespoke channel.
       Deliverable: a short findings doc + a recommended architecture, feeding the spec.

2. **Spec phase (gate).** Author a `.agents/spec-docs/draft/REMOTE-*.md` (or package `docs/SPEC.md`) and take it
   through GATE-APPROVAL (proposal-reviewer ENDORSE). Decide: signaling protocol, session-attach + auth model
   (pairing code / token), the remote client surface (web app driving the CLI's TUI/command stream), the
   command/permission model for a remote peer, and the security posture.

3. **Development phase (gated stages).** Build the minimal signaling server, the WebRTC transport adapter on the
   CLI host, the `/remote-control` command (enable/disable/status + pairing), and a remote client, each as
   gated stages with tests.

## Proposed Architecture (to be confirmed in the spec — NOT final)

- **`/remote-control` command** (agent-cli command module): `on`/`off`/`status`, emits a **pairing code / URL**
  and shows connection state. Enabling starts the WebRTC host offer + registers with the signaling server.
- **Signaling server** (new minimal app — `apps/*` or a standalone deployable): rendezvous by pairing code;
  relays SDP offers/answers + ICE candidates ONLY; holds no session content; stateless per pairing;
  authenticates the pairing (short-lived code). Self-hostable; URL configurable by the CLI user.
- **WebRTC transport adapter** (behind the existing transport port): a `RTCDataChannel` carries the same
  payload-agnostic transport frames the TUI/headless paths already speak (reuse `TRANS-001` framing), so the
  remote client drives the session through the SAME contract as a local transport.
- **Remote client**: a web app (WebRTC in the browser) that pairs via the code, opens the P2P data channel, and
  renders/controls the agent session (input + streamed output). Reuse the web-ui/playground surface if it fits.
- **Security**: DTLS transport encryption (inherent); short-lived pairing code + explicit host-side approval
  before a peer can drive commands; the remote peer is subject to the same permission/command gating as any
  transport (no privilege escalation via remoteness); consider an app-layer shared secret derived from the
  pairing code for channel auth.

## Open Questions (resolve in the spec)

- Session-attach semantics: does the remote peer **share** the live local session (mirror + co-drive) or open a
  **separate** session against the same workspace? Co-drive raises input-arbitration + permission questions.
- Auth/pairing: one-time code vs. persistent device pairing; how the host approves a connecting peer.
- NAT traversal: STUN-only P2P vs. optional user-supplied TURN; behavior when direct P2P fails.
- Node WebRTC library choice + its platform/build story (native deps) vs. the CLI's bundling constraints
  (INFRA-028 bundles the whole workspace — a native WebRTC dep needs an external/optional strategy).
- Permission model for a remote peer (can it run tools? approve permissions? only observe?).
- Whether the signaling server is `apps/*` (deployable) and how it stays a _minimal_ SSOT (no session data).

## Test Plan

- Research findings doc reviewed; spec ENDORSED at GATE-APPROVAL before any code.
- Unit: signaling protocol message handling; WebRTC transport adapter framing round-trip against the existing
  transport contract (stubbed peer, no real network); `/remote-control` command state machine (on/off/status,
  pairing lifecycle) with a stubbed signaling client.
- Integration: two in-process peers establish an `RTCDataChannel` (loopback / mock signaling) and exchange
  transport frames end-to-end; permission gating holds for the remote peer.
- Security: pairing-code expiry + containment (a wrong/expired code cannot attach); remote peer cannot
  exceed the local permission policy.
- Harness/build: no new dependency-direction violation; native WebRTC dep handled per the bundling strategy;
  full `harness:scan` + typecheck + build green.

## User Execution Test Scenarios

> To be filled in once the spec fixes the surface. Planned scenario (write concretely before implementation):

1. **Enable + pair + drive from a second device.**
   - Prerequisites: `agent-cli` running locally in a workspace; the self-hosted signaling server reachable at a
     configured URL; a second device with a browser.
   - Steps: in the local `agent-cli`, run `/remote-control on` → note the pairing code/URL; on the second device
     open the remote client, enter the code; approve the peer on the host when prompted; send a prompt from the
     remote client.
   - Expected: the remote client shows the connection as P2P/connected; the prompt reaches the agent and the
     streamed response appears on BOTH the local TUI and the remote client; `/remote-control status` shows the
     connected peer; the data path is direct P2P (no session content through the signaling server — verify via
     server logs showing only SDP/ICE, no payload).
   - Cleanup: `/remote-control off` disconnects the peer; a subsequent connect attempt with the old code fails.
   - Evidence: _(fill after implementation)_

## Notes

- Keep the signaling server strictly minimal and content-free — it is the one piece the owner hosts; everything
  security- and content-sensitive stays on the P2P channel.
- Prefer reusing the existing transport port + web surface over a bespoke remote stack, so remote control is
  "just another transport" rather than a parallel code path.
