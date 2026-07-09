---
status: approved
type: INFRA
tags: [remote-control, webrtc, transport, agent-cli, signaling]
---

# REMOTE-001: WebRTC P2P remote control for agent-cli — design + staging

Backlog: [.agents/backlog/REMOTE-001-webrtc-p2p-remote-control.md](../../backlog/REMOTE-001-webrtc-p2p-remote-control.md).
This is the **design spec** (research complete). It fixes the architecture + security model + build stages;
each stage lands under its own gated implementation spec (like the ARCH-PROVIDER arc).

## Goal

A user running `agent-cli` locally turns on `/remote-control` and then reaches + drives that **same live
session** from an external device (phone/laptop browser), **peer-to-peer over WebRTC**, with **no vendor
infrastructure** — only a minimal self-hostable **signaling** server (SDP/ICE rendezvous, no session content).
This is Claude Code's **co-drive** model (one live local session, viewed/driven from multiple devices) but
**P2P + self-hosted** instead of relay-through-vendor.

## Research findings (feeding this design)

1. **The session↔client protocol is already transport-agnostic.** `packages/agent-transport-ws/src/ws-handler.ts:51`
   `createWsHandler({ session, send })` subscribes to session events → `send(TServerMessage)` and returns
   `onMessage(data)` to drive `session.submit()`/`executeCommand()`/`abort()`. It is documented as working
   "with any WebSocket implementation via send/onMessage callbacks. No dependency on ws." **A WebRTC transport
   reuses this handler verbatim**, wiring `send = (m) => dataChannel.send(JSON.stringify(m))` and
   `dataChannel.onmessage = e => onMessage(e.data)`. The protocol (`ws-protocol.ts` `TClientMessage`/
   `TServerMessage`) is shared.
2. **The transport seam is a one-line registry add.** `ITransportAdapter` (attach/start/stop) +
   `IConfigurableTransport` (`transport-config.ts`); `TransportRegistry.register(...)`; the CLI composition root
   is `packages/agent-cli/src/cli.ts:88` (`registry.register(new WsTransport())`). WebRTC = `registry.register(
new WebRtcTransport(...))`. `agent-transport` core needs **no change** (it only knows the interface).
3. **The browser client already exists.** `packages/agent-web-ui/src/client/ws-session-client.ts` speaks the
   same `TServerMessage`/`TClientMessage` over a native `WebSocket`; the remote WebRTC client is a **peer
   alternative** that swaps `new WebSocket(url)` for an `RTCDataChannel`, reusing the protocol + the
   `IAgentDriver` semantics (`interaction-contracts.ts:71`).
4. **Permission is transport-agnostic BELOW the transport — for TOOLS. Commands are NOT gated (corrected).**
   `permission-enforcer.ts:88` wraps every tool, so a remote `submit`→tool-call inherits the policy and the
   approval prompt lands on the local TUI (`IInteractionChannel`, not in `TServerMessage`) — the remote
   structurally cannot self-approve tool escalations. **But** the `command` verb → `session.executeCommand` runs
   command modules with **no `PermissionEnforcer` gate** (safety/requiresPermission is descriptor metadata, not
   enforced here). Exposed to a remote peer, every command becomes ungated — a Stage-B deliverable, not a free
   inherit (see Security).
5. **Two reused pieces carry a hidden assumption: OS-localhost trust.** `WsTransport` binds `127.0.0.1`; the
   whole `TClientMessage` surface was designed as operator-only local input. WebRTC makes it internet-reachable
   — the surface must be re-audited as untrusted input (Security → trust-boundary reframing).
6. **Signaling precedent.** `apps/agent-server/src/websocket-server.ts:47` `PlaygroundWebSocketServer` already
   does JWT auth + session-keyed peer routing — the natural shape for an SDP/ICE signaling server.
7. **Claude Code / Codex both require vendor-hosted relays** (Anthropic API polling; OpenAI relay/SSH). Their
   **co-drive session model + QR pairing** are the parts worth copying; their infra dependency is exactly what
   P2P + self-hosted signaling avoids.
8. **INFRA-028 native-dep constraint (the key friction).** `agent-cli` bundles ALL `@robota-sdk/*` code; only
   third-party npm deps stay external. A native WebRTC lib (`node-datachannel`, `wrtc`) ships N-API binaries
   that are **not bundleable** and need per-OS/arch/ABI prebuilds — breaking the self-contained model.
   **Recommendation: use `werift` (pure-TypeScript WebRTC) as the host-side impl** so there is no native
   binary; lazy-load it behind a `try/require` like `loadReplayProvider` (`cli.ts:73-84`) so a missing/absent
   WebRTC dep degrades gracefully instead of crashing the CLI. (Open question: werift maturity vs. a native
   lib — evaluate in Stage A.)

## Architecture (target)

```
 external device (browser)                         local machine (agent-cli host)
 ┌───────────────────────────┐                     ┌───────────────────────────────────┐
 │ remote client (web)       │                     │ agent-cli TUI  ── same live session │
 │  - IAgentDriver over       │                     │        │                           │
 │    RTCDataChannel          │                     │  createWsHandler({session,send})    │
 │  - reuses TClient/TServer  │◄─── DTLS P2P ──────►│  WebRtcTransport (werift)            │
 │    protocol                │   RTCDataChannel    │   (IConfigurableTransport)          │
 └─────────┬─────────────────┘                     └──────────────┬────────────────────┘
           │  SDP/ICE + PAKE only (no session content)            │
           └──────────────►  minimal signaling server  ◄──────────┘
                            (self-hosted; rendezvous by pairing-derived id; untrusted)
```

- **`@robota-sdk/agent-transport-protocol`** (NEW minimal package — extraction target). The transport-neutral
  session bridge + protocol (`createWsHandler`, `ws-protocol.ts` `TClientMessage`/`TServerMessage`,
  `ws-background-messages`) is moved here, verified to have **zero `ws`/`node:` imports** (deps: `agent-core` +
  `agent-interface-transport` only). Both `agent-transport-ws` and the new `agent-transport-webrtc` depend
  **down** on it. This avoids a `webrtc → ws` package edge (which would pull the `ws` npm dep purely to reach a
  ws-free handler) AND avoids routing through `agent-transport` core (which depends on `agent-framework`, whose
  footprint the ws transport must not inherit). It cannot live in `agent-interface-transport` (runtime logic
  banned there).
- **`@robota-sdk/agent-transport-webrtc`** (new, mirrors `agent-transport-ws`): a `WebRtcTransport implements
IConfigurableTransport` that owns an `RTCPeerConnection` (werift), a signaling client, and the pairing/PAKE
  handshake; on data-channel open it wires the shared handler.
- **Signaling server** (new minimal deployable — `apps/*`): **untrusted** rendezvous by a pairing-derived id;
  relays SDP offers/answers + ICE candidates ONLY; holds **no** session content; **rate-limits** rendezvous +
  PAKE attempts (the online-guess bound for a short pairing secret); stateless per pairing; self-hostable, URL
  configured by the CLI user. It is the shape of `PlaygroundWebSocketServer` (session-keyed routing) but MUST
  NOT copy its JWT-as-trust model — any auth here is anti-abuse only, never a confidentiality boundary. Optional
  user-supplied **TURN** for NAT-restricted networks (relays encrypted DTLS only — content-blind).
- **`/remote-control` command** (`ICommandModule`): `on` / `off` / `status`. `on` starts the transport via
  **composition-root dependency injection** of the `TransportRegistry` (workflows-deps pattern — NOT a new
  `ICommandHostContext` accessor, to keep `agent-framework` domain-free) and prints the pairing QR/code. The
  command itself is permission-gated (`safety`/`requiresPermission`) so enabling remote access is an audited
  action.
- **Remote web client = a generic, fragment-injected static page (or desktop shell).** A single thin WebRTC
  page hosted anywhere (CDN / the signaling host / GitHub Pages) serves ALL users/sessions — it holds no
  server-side state and knows no specific session. The pairing link carries `signaling-URL + rendezvous-id +
secret` in the **URL fragment** (`#…`), which never leaves the browser, so the page's own host sees nothing.
  The page reuses `agent-web-ui`'s protocol client, swapping `new WebSocket(url)` for an `RTCDataChannel`, and
  persists the TOFU trusted-device key in `localStorage` for silent reconnect at the same page URL.

**Discovery/connection flow (NAT-friendly, no inbound ports).** Both host and remote are behind NAT; the
signaling server is the only publicly-reachable rendezvous, reached **outbound** by both: (1) host `/remote-
control on` → outbound-connects the signaling server, registers under rendezvous id `R`, shows QR/URL
(`sig-URL + R + secret`); (2) remote opens that page/app → reads `R`+secret from the URL fragment → outbound-
connects the signaling server, asks for `R` → server pairs the two outbound sockets; (3) PAKE over the secret +
MAC-verified SDP/ICE exchange → ICE/STUN hole-punch to a **direct** P2P path; (4) DTLS data channel opens; the
signaling server leaves the path (TURN only if direct P2P fails). Neither peer opens an inbound port (same
"outbound-only" property Claude Code advertises, but the rendezvous is the user's own tiny server).

## Security model (no central auth; only untrusted signaling/relays)

**Discovery = capability, not search.** `on` generates a random **rendezvous id** (registered with the
signaling server for SDP/ICE relay) + a high-entropy **pairing secret**, shown as a **QR/short code** on the
host terminal and carried out-of-band to the remote device. There is no directory/enumeration — knowing the key
is the address.

**Authentication = possession of the pairing secret (real SPAKE2), bound to the P2P channel.**

- The remote runs **SPAKE2** (a balanced PAKE) with the host over the pairing secret — concrete construction,
  NOT "SPAKE2-style": correct M/N seed points + an explicit **key-confirmation MAC** (transcript MAC) round,
  built on vetted `node:crypto` primitives (no hand-rolled crypto — mandatory because werift's DTLS is JS).
  Yields a mutually-authenticated key; an attacker without the secret **fails here**.
- The authenticated key **MAC-binds the WebRTC DTLS certificate fingerprints** carried in the SDP (verify the
  `a=fingerprint` under the PAKE key), so a **malicious signaling/TURN server cannot MITM** — a swapped
  fingerprint fails MAC-verify. Signaling/TURN servers are therefore **fully untrusted**: relay or deny, never
  impersonate or read.
- **Online-guess bound (load-bearing backing assumption).** PAKE gives ONE online guess per run, so the secret
  must be **single-use** (consumed on first successful PAKE) + **short-TTL** (~60s) + the signaling server
  **rate-limits** rendezvous/PAKE attempts. Without these a short code is online-brute-forceable.
- **No host-side accept OR enrollment confirmation (owner decision, 2026-07-10).** Passing SPAKE2 grants the
  connection immediately — no per-connection accept and no first-pairing confirmation prompt. **Documented
  residual risk:** a QR photographed/shoulder-surfed within its ~60s window, where the attacker beats the owner
  to the (single-use) PAKE, yields a silent connection to a tool-capable session. The single-use + short-TTL +
  rate-limit mitigations shrink but do not eliminate this window; the owner has explicitly accepted this
  trade-off in favor of zero connection friction. (An optional one-time enrollment confirmation was considered
  and declined.)

**Reconnect = TOFU trusted-device keys.** The first pairing (secret → SPAKE2) bootstraps a stored long-term
keypair on both sides (host identity key + remote device pubkey, SSH `authorized_keys`-style; remote stores its
key in `localStorage`). Subsequent connects authenticate via those keys — no re-scan, no code, no prompt.
**Revocation** = `/remote-control off` (drops the current peer) + a device-revoke that forgets the stored key.

**Permission — TWO gates, one already-strong, one that must be BUILT.**

- **Tools (already gated, transport-agnostically):** `PermissionEnforcer` (`permission-enforcer.ts:88`) wraps
  every tool below the transport, so a remote `submit` that triggers tools inherits the exact policy. The
  approval prompt rides the `IInteractionChannel` (TUI `TActionRequest`/`TActionResponse`), which is NOT in
  `TServerMessage` — so it lands on the **local operator's TUI** and the remote peer **structurally cannot
  self-approve**. Default = operator-approves (stronger than Claude Code's remote-approves); any Stage-B
  "remote-approves" option must itself be an operator-gated opt-in (and would require adding
  `TActionRequest`/`TActionResponse` to the protocol).
- **Commands (NOT gated today — must be fixed in Stage B).** The `command` verb → `session.executeCommand` runs
  command modules with **no `PermissionEnforcer` gate** (the `safety`/`requiresPermission` taxonomy is used for
  descriptors/metadata, not enforced on this path). Harmless while the protocol is `127.0.0.1`-only; exposed to
  a remote peer, **every command module becomes remotely invokable, ungated** (config mutation, `/remote-control
off`, etc.). Stage B MUST gate remote-origin `command` messages — an **allowlist of remote-invocable commands**
  and/or enforcing the `requiresPermission`/`safety` taxonomy at the protocol boundary (routing gated commands
  through operator approval). Until then the "remote cannot escalate" property is FALSE via commands.

**Trust-boundary reframing (own it).** Every reused component (`ws-handler`, the whole `TClientMessage` surface
— submit, command, abort, cancel-queue, all background-task control) was built under **OS-localhost trust**
(`WsTransport` binds `127.0.0.1`). WebRTC makes this protocol **internet-reachable for the first time**: the
entire `TClientMessage` surface becomes attacker-controlled input and is audited as such in Stage B before any
user-facing enable path ships.

## Build stages (each = its own gated implementation spec)

- **Stage A — Transport + protocol extraction + signaling skeleton (NO shippable enable path).** Extract the
  neutral handler/protocol into `agent-transport-protocol`; new `agent-transport-webrtc` reusing it over a
  werift `RTCDataChannel`; a minimal signaling server (SDP/ICE rendezvous). Host↔host **loopback / mock-
  signaling** integration test establishing a data channel and round-tripping `TClient/TServer` frames. Confirm
  the werift-vs-native decision + the INFRA-028 lazy-load story. **Explicitly no auth and no wired
  `/remote-control on`** — Stage A must not expose a network-reachable unauthenticated channel; it is
  loopback/mock only.
- **Stage B — `/remote-control` command + SPAKE2 pairing + UNTRUSTED-SURFACE HARDENING (gates the enable path).**
  `ICommandModule` (`on/off/status`, composition-root DI of the registry, itself permission-gated); QR/code
  generation; concrete SPAKE2 + key-confirmation on `node:crypto`; single-use + short-TTL secret + signaling
  rate-limiting; DTLS-fingerprint MAC binding. **Audit the full `TClientMessage` surface as untrusted input**
  and **gate remote-origin `command` messages** (allowlist and/or enforce `requiresPermission`/`safety` at the
  protocol boundary). Add a **"waiting-for-operator-approval" server message** so a remote peer whose work
  stalls on a local TUI permission prompt sees a state, not a hang. This is where the user-facing enable path
  first ships — after the hardening, not before.
- **Stage D — Remote web client.** A generic fragment-injected static page (+ optional desktop shell) reusing
  the protocol + `IAgentDriver`, swapping WebSocket for `RTCDataChannel`; pairing UX (open link/scan → SPAKE2 →
  connected); `localStorage` TOFU key. (There is no Stage "C": a per-connection/enrollment manual-accept step is
  intentionally **absent** per the owner decision; the browser client is Stage D.)
- **Stage E — Hardening + co-drive UX.** TOFU trusted-device reconnect; optional user-supplied TURN fallback;
  reconnection/session-resume; **co-drive concurrency + attribution** (remote `abort`/`cancel-queue` vs. the
  operator's in-flight work — arbitration + who-did-what signalling); signaling-server abuse handling; docs.

## Resolved decisions (GATE-APPROVAL round 1)

1. **WebRTC impl** — RESOLVED: `werift` (pure-TS, bundleable) primary; a Stage-A gate confirms data-channel
   maturity/perf, with native `node-datachannel` as the labeled fallback if werift is inadequate.
2. **Handler reuse edge** — RESOLVED: extract into a NEW minimal `agent-transport-protocol` (deps: agent-core +
   agent-interface-transport only), not `agent-transport` core (avoids widening `-ws`'s footprint to
   agent-framework) and not `agent-transport-ws` (`webrtc → ws` edge). Both transports depend down on it.
3. **`/remote-control` → registry** — RESOLVED: composition-root DI (workflows-deps pattern), not a new
   `ICommandHostContext` accessor.
4. **Permission policy** — RESOLVED: operator-approves default (the architecture enforces it for tools for
   free); commands must be gated in Stage B; remote-approves is at most an operator-gated Stage-B opt-in.
5. **First-pairing confirmation** — RESOLVED (owner): NO host-side accept/enrollment prompt; rely on single-use
   - short-TTL + rate-limited secret; residual leaked-QR-window risk explicitly accepted.
6. **Session model** — co-drive the SAME session; the multi-writer concurrency/attribution UX is a Stage-E
   deliverable (execution is serialized by the session, so no data race — the hazard is UX/attribution, plus the
   "waiting-for-operator-approval" signal in Stage B).

## Open Questions (still for the reviewer)

- **Signaling server home**: `apps/*` (deployable) — confirm it stays minimal + content-free and does NOT
  inherit `PlaygroundWebSocketServer`'s JWT-as-trust model (any auth = anti-abuse only).
- **Werift SPAKE2 interop**: confirm a browser-side SPAKE2 implementation interoperates with the `node:crypto`
  host side (curve/hash/seed-point agreement) — a Stage-A/B spike.

## Test Plan (design-level)

This design spec's "tests" are the GATE-APPROVAL review verdicts (proposal-reviewer soundness on the
architecture + security model). Each build stage carries its own RED→GREEN tests: transport frame round-trip
against the shared protocol (stubbed peer, no real network); PAKE handshake + fingerprint-pinning unit tests
(a wrong/expired secret cannot attach; a tampered fingerprint is rejected); permission-gating over the WebRTC
inbound path; a signaling-server unit suite (relays SDP/ICE only, no payload); and the User Execution Test
Scenario from the backlog (enable → scan → drive from a second device; verify session content never transits
the signaling server).

## Evidence Log

- 2026-07-10 GATE-DRAFT — authored after the research phase. Repo findings verified via architecture map:
  `ws-handler.ts:51` transport-agnostic session bridge; `cli.ts:88` one-line registry add;
  `permission-enforcer.ts:38` transport-below permission seam; `agent-web-ui/.../ws-session-client.ts` reusable
  protocol client; `PlaygroundWebSocketServer` signaling precedent; INFRA-028 native-dep constraint →
  werift recommendation. Claude Code/Codex both require vendor relays (co-drive + QR pairing worth copying).
  Security model: capability discovery + PAKE (secret possession) + DTLS-fingerprint pinning (untrusted relays)
  - TOFU reconnect; **manual accept step removed per owner decision** (PAKE success = authenticated). Pending
    proposal-reviewer ENDORSE on the architecture + security model before Stage A.
- 2026-07-10 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (architecture endorsed + all repo premises
  verified TRUE; security contract completed). Folded in: (1) **corrected the false premise** that `command`
  inherits permission — `session.executeCommand` is UNGATED; Stage B must gate remote-origin commands +
  audit the whole `TClientMessage` surface as untrusted (localhost→internet reframing). (2) **crypto pinned** —
  real SPAKE2 (M/N + key-confirmation MAC) on `node:crypto`, single-use + short-TTL secret + signaling
  rate-limit as the online-guess bound; DTLS-fingerprint MAC binding kept. (3) **no accept/enrollment prompt**
  (owner reaffirmed) — residual leaked-QR-window risk documented + accepted. (4) **extraction home** = new
  minimal `agent-transport-protocol` (not core, not `webrtc→ws`). (5) `/remote-control` via composition-root DI.
  (6) **staging guards** — Stage A loopback/mock with no enable path; command-gating + untrusted audit + a
  "waiting-for-operator-approval" signal in Stage B (not E); co-drive concurrency/attribution in Stage E.
  Re-review → round 2.
- 2026-07-10 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. All six round-1 corrections verified
  complete + internally consistent; #2 presents the residual leaked-QR risk honestly (accepted, not eliminated);
  the new `agent-transport-protocol` dep set is achievable + cycle-free (the extracted `ws-handler`/`ws-protocol`/
  `ws-background-messages` import only `agent-interface-transport` — in fact `agent-core` is likely unnecessary,
  a Stage-A refinement); staging exposes an enable path only in Stage B after the untrusted-surface hardening +
  command-gating land. **Design APPROVED.** Proceed to per-stage implementation specs (Stage A first). Spec →
  todo/ (approved design; stages carry their own gated specs).
