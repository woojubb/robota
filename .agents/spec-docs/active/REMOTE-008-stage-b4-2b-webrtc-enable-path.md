---
status: in-progress
type: INFRA
tags: [remote-control, transport, webrtc, pairing, enable-path]
parent: REMOTE-001
---

# REMOTE-008: Stage B4-2b — `/remote-control` WebRTC enable path

Parent: [REMOTE-001](../todo/REMOTE-001-webrtc-p2p-remote-control-design.md) (ENDORSED). Prior sub-stages DONE:
REMOTE-002 (plumbing) / 003 / 004 (signaling+relay hardening) / 005 (pairing crypto) / 006 (local==remote) / 007
(transport-neutral permission/ask). This is the **user-facing enable path** that composes the shipped pieces into a
working feature: turn on `/remote-control` locally → get a QR/link → an external device pairs and co-drives the SAME
live session over DTLS-encrypted WebRTC P2P.

Everything REMOTE-008 needs already exists and is unit-tested; **nothing wires it into a session**. `WebRtcTransport`
is never constructed/registered (`defaultEnabled=false`), no relay-URL config exists, no QR dep exists, the
`wireChannel` data-channel is exposed to the session with **no pairing gate**, and commands cannot reach the
transport registry. REMOTE-008 is composition-root wiring + one new command module + the pairing gate. It **consumes
REMOTE-007** so a paired remote owner answers their OWN permission/ask prompts.

## Problem (grounded)

A user cannot enable remote control. Concretely, each seam is present-but-unwired:

1. **No command.** Slash commands are `ISystemCommand` in `ICommandModule`s
   (`agent-framework/src/command-api/contracts.ts:9-30`, `command-module.ts:8-19`); the default list is
   `agent-command/src/default/default-command-modules.ts:86-114`. There is **no** `/remote-control` command.
2. **`WebRtcTransport` never registered.** The registry is built + `WsTransport` registered at `agent-cli/src/cli.ts:86-90`
   (`createDefaultTransportRegistry`); `startAll(session)` runs at `TuiInteractionChannel.ts:238-239`. `WebRtcTransport`
   (`agent-transport-webrtc/src/webrtc-transport.ts`, `defaultEnabled=false` :34) is never constructed or registered.
3. **No signaling client instance.** `WsSignalingClient` (`ws-signaling-client.ts:48`) is production-ready but never
   instantiated; `WebRtcTransport` takes an already-built `ISignalingClient` via options (`webrtc-transport.ts:42`).
4. **No relay-URL config.** `SettingsSchema` (`config-types.ts:127-156`) has `transports: record<{enabled?, options?}>`
   but NO relay/signaling URL field. `apps/remote-signaling` binds ephemeral `127.0.0.1:0` (`server.ts:16-18`) — no
   fixed production relay.
5. **No pairing gate.** `wireChannel` (`webrtc-transport.ts:91-113`) eagerly calls `createWsHandler({session,send})`
   (:99) + subscribes `onMessage` (:110-112) the instant the channel is created — the session is exposed with **no
   pairing/auth**. `startPairingHandshake` (`agent-remote-pairing/handshake.ts:57`) exists but is never called; the
   local/remote DTLS fingerprints (needed for channel-binding) are never captured.
6. **No QR dependency.** No `qrcode`-family dep anywhere (verified across all `package.json`). `toPairingUrl(base, secret)`
   (`agent-remote-pairing/pairing.ts:100`) builds the shareable URL (secret in the fragment, never sent to the relay),
   but nothing renders it.
7. **Commands can't reach the registry.** `ICommandHostAdapters` (`host-adapters.ts:30-35`) exposes only
   `settings/process/permissionMode/plugin` — no transport/enable seam.

## Solution (sub-sequenced, each commit green)

Responsibility split (per round-1 review): the **command** is a declarative trigger (returns an effect); the **TUI
effect handler** only dispatches to an injected callback (like `openTransportTUI`); **all transport construction lives
at the `agent-cli` composition root** (next to `createDefaultTransportRegistry`, `cli.ts:86-90`) — the composition
root is the sanctioned place to decide which concrete transports exist (`cli.ts:62-65`). The **pairing gate** lives in
the transport (`wireChannel`) because only the transport can see the SDP fingerprints and the pre-session channel
frames. **Step 1 (the pairing gate) is a self-contained security milestone**, independently unit-testable with a stub
signaling client + in-memory channel, and is reviewed as such.

1. **Pairing gate in `wireChannel` (SECURITY milestone; self-contained).** Interpose so the data channel is
   phase-separated: pre-accept it carries ONLY `TPairingFrame`s, post-accept ONLY session messages. Because werift
   drops inbound frames received before `onMessage` is subscribed (`webrtc-transport.ts:92-98`), keep the **single
   eager `onMessage` subscription** and switch ROUTING on accept (NOT a deferred subscription): route inbound to
   `controller.onFrame` pre-accept and to the `createWsHandler` `onMessage` post-accept; **drop any non-pairing frame
   that arrives pre-accept** (fail-closed against a misbehaving peer). Capture `localFingerprint` from
   `peer.localDescription.sdp` (after `setLocalDescription`). Because the data channel cannot open (DTLS) until the
   answer is processed, the pairing controller is created in/after the async `signalChain` answer branch
   (`webrtc-transport.ts:71-81`) — where `remoteFingerprint` becomes available via `extractDtlsFingerprint` — and the
   eager `onMessage` subscription routes to it (NOT a call-time parameter into the current `wireChannel` invocation,
   which runs before the answer exists). Drive `startPairingHandshake({ secret, role:'initiator', localFingerprint,
remoteFingerprint, send: (f) => channel.send(JSON.stringify(f)) })` (host=offerer≡initiator; `JSON.parse` inbound
   before `controller.onFrame`), and **await `controller.result`**. On ACCEPT → build `createWsHandler` + start
   routing session messages (expose the session). On REJECT/timeout (10s default) → close the channel, expose nothing
   (fail-closed; werift's DTLS fingerprint-verify from REMOTE-005 TC-09 is the MITM backstop). New transport option
   carries the pairing `secret`. Both peers gate, so pairing and session frames are phase-separated, not multiplexed —
   no per-message framing tag needed. Introduces the edge `agent-transport-webrtc → agent-remote-pairing` (a zero-dep
   isomorphic leaf — no cycle; documented in project-structure.md).
2. **Relay-URL config (no schema change).** Read the relay URL from `transports.webrtc.options.relayUrl` (the generic
   `options` record is already schema-valid, `config-types.ts:127-130`). Absent ⇒ `/remote-control` reports "no relay
   configured" and does nothing (fail-closed; NO silent default to a public relay). A dedicated top-level config key is
   deferred — reuse the transport-options record now.
3. **`remote-control-enable-requested` effect + `/remote-control` command module.** New `TCommandEffect` variant (SSOT
   `agent-interface-transport/command-contracts.ts:107`). New `createRemoteControlCommandModule()` (template:
   settings/provider command modules) added to `default-command-modules.ts`. `execute` returns the enable effect;
   `status` reads state via a new `ICommandHostAdapters.remoteControl.getStatus()` query adapter (mirrors the
   `permissionMode` query-adapter precedent — the command otherwise cannot observe pairing state); `stop` requests
   teardown (effect). User-invocable only (not model-invocable).
4. **Composition-root enable wiring (`agent-cli`).** The TUI effect handler dispatches
   `remote-control-enable-requested` to an injected `deps.enableRemoteControl?.()` (mirrors `openTransportTUI`,
   `command-effect-handler.ts:10-21`). The **implementation lives at `agent-cli`**: read the relay URL, call
   `generatePairingSecret()` → `{secret, rendezvous}`, construct `new WsSignalingClient({ url: relayUrl, rendezvous })`
   and `new WebRtcTransport({ signaling, secret })`, `registry.register(...)` + `setEnabled('webrtc', true)` +
   `startAll` (creates the offer), then render the QR + `toPairingUrl(base, { secret, rendezvous })`. Teardown on
   `stop`, session shutdown, and pairing failure. The `getStatus` adapter is implemented here too.
5. **QR dependency + terminal render (`agent-cli`).** Add the QR dep to **`agent-cli`** (the product shell — exempt
   from library-leanness; NOT `agent-command` or any interface package). Render the QR + link to the terminal.
6. **REMOTE-007 consumption (already free).** Because the WebRTC data channel reuses `createWsHandler`, the
   transport-neutral permission/ask events flow over it automatically — the paired remote owner answers their own
   prompts. No extra work; assert it end-to-end (a paired peer drives a tool needing approval and answers over WebRTC).

**Accepted residual (REMOTE-005 model):** anyone who learns the rendezvous id can force a _failed_ pairing attempt
(single-use-rendezvous DoS) but cannot gain session access without the high-entropy secret (which lives only in the
QR/link fragment, never sent to the relay).

## Tasks

- [x] Step 1 (SECURITY milestone) — pairing gate in `wireChannel` (`PairingGate`): controller created in the answer
      branch, eager `onMessage` routing switch (pre-accept `onFrame` / drop non-pairing; post-accept session), `send`
      serialization, local/remote fp capture, opt-in `secret` transport option, fail-closed on reject/timeout + close
      channel. 7 unit tests (stub signaling + in-memory channel). + `agent-remote-pairing` dep + `project-structure.md`
      edge doc + webrtc SPEC.md. **DONE (commit 92bf33eb9).**
- [x] Step 2 — `remote-control-enable-requested`/`-stop-requested` `TCommandEffect` variants (SSOT
      agent-interface-transport) + `ICommandHostAdapters.remoteControl.getStatus()` (`TRemoteControlStatus`). Relay-URL
      config read deferred to Step 4 (consumed at the composition root). **DONE (commit 343075970).**
- [x] Step 3 — `/remote-control [enable|stop|status]` command module (trigger only; reads status via the adapter) +
      registered in default modules; TUI effect handler dispatches to injected `enableRemoteControl`/`stopRemoteControl`.
      7 command unit tests. **DONE (commit 343075970).**
- [x] Step 4 — agent-cli composition root **DONE** (commit 0da6db6f7): `RemoteControlController` + `createRemoteControlController`
      (construct `WsSignalingClient` + pairing-gated `WebRtcTransport`, register + attach+start directly, relay/client URL
      from `transports.webrtc.options`, QR via `qrcode` + `toPairingUrl` rendered through effect-deps `addEntry`, `getStatus`
      over a shared holder, teardown); enable/stop threaded `IRenderOptions→App→useSideEffects`; webrtc+pairing devDeps +
      qrcode+werift runtime; 8 controller tests. Superseded detail: + `WebRtcTransport`, register + **attach+start directly** (NOT `startAll` — `defaultEnabled:false`, and the registry
      has no start-one method), `generatePairingSecret`, read `settings.transports.webrtc.options.relayUrl` (absent →
      `{state:'no-relay'}`), QR/link render of `toPairingUrl` via the effect deps `addEntry` (Ink owns stdout after
      renderApp), `getStatus` impl over a SHARED MUTABLE HOLDER (the adapter is built in command-setup before the
      transport exists), teardown (`webrtc.stop()` + `signaling.close()`). Thread `enableRemoteControl`/`stopRemoteControl`
      through `IRenderOptions → App prop → useSideEffects option → deps`. Add `agent-transport-webrtc` +
      `agent-remote-pairing` as agent-cli **devDependencies** (self-contained bundle convention) + a QR dep + `werift`
      runtime dep (or accept lazy-unavailable). Live channel/session reachable via `onChannelReady`/`setLiveChannel`
      (cli.ts:337).
- [x] Step 5 — **DONE** (commit 44393bedd): paired E2E over real werift (matching → pair + session round-trip;
      mismatched → fail closed, session never exposed); tampered-fp already REMOTE-005 TC-09; permission-over-WebRTC
      transitive (paired channel reuses `createWsHandler`, forwarding tested in REMOTE-007) + enable-path changeset.
- [x] Step 6 — **DONE**: harness:scan 49/49 + full-repo `pnpm typecheck` 0 + changesets present.
- [x] GATE-REVIEW (implementation) — proposal-reviewer **REVISE→fixed** (commit 863b527d0). Security-critical pairing
      gate + fail-closed session-exposure ENDORSED unreservedly. Fixed 3 conformance gaps vs the approved spec: (1)
      `'paired'` status was unreachable; (2) "teardown on pairing failure" was unimplemented (peer/signaling leak +
      stale `awaiting-pairing`); (3) `werift`-absent `start()` failure rethrown into a detached promise + swallowed.
      Wired a lifecycle seam `PairingGate.onAccept/onReject → WebRtcTransport.onPaired/onPairingFailed →
  RemoteControlController` (status `paired` on accept; teardown→`off` on failure; `start()` errors surfaced via an
      injected `reportError` to the live channel history). +4 tests. Full typecheck 0, cli 177, webrtc 23, scans 49/49.

## Affected Files

- `agent-transport-webrtc/src/webrtc-transport.ts` (Step 1: pairing gate in `wireChannel`; capture local fp + thread
  answer fp; routing switch; `send` serialization; new `secret` option) + `docs/SPEC.md` + `package.json` (add
  `agent-remote-pairing` dep)
- `.agents/project-structure.md` (line ~26: record the new `agent-transport-webrtc → agent-remote-pairing` edge + why —
  the gate must live where the SDP fingerprints and channel frames are visible)
- `agent-interface-transport/src/command-contracts.ts` (new `remote-control-enable-requested` / `-stop` `TCommandEffect`
  variant) — SSOT; `agent-framework` effects re-export unchanged (no pass-through added)
- `agent-framework/src/command-api/host-adapters.ts` (new `remoteControl?: { getStatus(): ... }` query adapter)
- `agent-command/src/remote-control/**` (NEW command module — trigger only, no transport construction) +
  `default/default-command-modules.ts` (register)
- `agent-transport-tui/src/**` (effect handler dispatches to an injected `enableRemoteControl` callback — NO transport
  construction here)
- `agent-cli/src/cli.ts` / `startup/command-setup.ts` (composition root: construct `WsSignalingClient` + `WebRtcTransport`,
  register+enable+start, `generatePairingSecret`, relay-config read, QR render, `getStatus` impl, teardown) +
  `package.json` (add the QR dep here)
- changeset

## Decisions (resolved at GATE-APPROVAL round 1)

- **D1 — enable seam = effect for the TRIGGER + composition-root for the WIRING.** The `/remote-control` command
  returns a `remote-control-enable-requested` `TCommandEffect`; the TUI effect handler only dispatches to an injected
  `enableRemoteControl` callback (mirrors `openTransportTUI`, `command-effect-handler.ts:10-21`); ALL transport
  construction lives at the `agent-cli` composition root (`cli.ts:62-65,86-90`). Commands never touch transports, and
  no transport package becomes a composition root for a sibling transport.
- **D2 — pairing gate INSIDE `wireChannel`** (only the transport sees SDP fingerprints + pre-session frames; a host
  wrapper is impossible). Accept the new `agent-transport-webrtc → agent-remote-pairing` edge (zero-dep isomorphic
  leaf; no cycle; not a mechanized dep violation) and **record it in `project-structure.md`**. Use one eager
  `onMessage` subscription with a routing switch (pre-accept → `onFrame`, post-accept → session), drop non-pairing
  frames pre-accept, serialize `TPairingFrame` over `channel.send`, and thread the answer-SDP fingerprint from the
  signal branch into the gate.
- **D3 — status read seam = `ICommandHostAdapters.remoteControl.getStatus()`** (mirrors the `permissionMode` query
  adapter). Implemented at the composition root. Without it the `status` subcommand cannot observe pairing state.
- **D4 — QR dep in `agent-cli`** (the product shell — exempt from library-leanness), NOT `agent-command` or any
  interface package. `qrcode` or `qrcode-terminal` both acceptable; the browser PEER only parses the URL
  (`parsePairingUrl`), so a data-URL is reusable only by a future browser HOST — not asserted as a deciding factor.
- **D5 — one spec, sub-sequenced; Step 1 (pairing gate) is the self-contained SECURITY milestone** (independently
  unit-testable with stub signaling + in-memory channel), reviewed as such before the enable-path UX composes it.

## Test Plan

RED→GREEN. Step-1 unit (the security milestone, stub signaling + in-memory channel): the gate exposes the session ONLY
after `controller.result` accepts; pre-accept, inbound `TPairingFrame`s route to `controller.onFrame` and any
NON-pairing frame is DROPPED (never reaches a session handler); on reject/timeout the channel closes and nothing is
exposed; the single `onMessage` subscription is never deferred (werift constraint). Command/effect unit: `/remote-control`
returns the enable effect; `status` reflects `getStatus()`; `stop` requests teardown.
Integration: a real-relay (`apps/remote-signaling`) two-peer RTCDataChannel handshake that pairs, then drives a session
message end-to-end; and a REMOTE-007 assertion that a permission prompt raised by a remotely-driven tool is answerable
over the WebRTC channel. Negative: tampered fingerprint (reuses REMOTE-005 TC-09) and wrong-secret both fail closed and
expose nothing. `harness:scan` + full `pnpm typecheck` 0 + changeset.

## Evidence Log

- 2026-07-11 GATE-DRAFT — authored from the REMOTE-007 completion + an 8-seam read-only Explore of the enable path.
  Grounding verified: `WebRtcTransport` never registered (`cli.ts:86-90`), `defaultEnabled=false` (`webrtc-transport.ts:34`);
  `wireChannel` (:91-113) exposes the session with no pairing gate; `WsSignalingClient` (:48) never instantiated in prod;
  no relay-URL config (`config-types.ts:127-156`); no QR dep anywhere; `ICommandHostAdapters` (`host-adapters.ts:30-35`)
  has no transport seam; `startPairingHandshake`/`toPairingUrl`/`extractDtlsFingerprint` all present and unit-tested.
  Pending proposal-reviewer ENDORSE.
- 2026-07-11 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction correct + well-grounded; every premise
  verified TRUE against source). Folded in: **D1** transport CONSTRUCTION moves to the `agent-cli` composition root
  (the TUI effect handler only dispatches to an injected callback — building `WsSignalingClient`/`WebRtcTransport`
  inside `agent-transport-tui` would break the injected-callback effect pattern and contradict the composition-root
  principle at `cli.ts:62-65`, turning one transport package into a composition root for siblings); **D2** accept +
  document the `agent-transport-webrtc → agent-remote-pairing` edge in `project-structure.md` (verified not a
  mechanized dep-direction violation: pairing is a zero-dep leaf, no cycle), routing-switch not deferred subscription
  (werift drops unbuffered inbound), `send` serialization + drop-non-pairing-pre-accept, thread answer fp from the
  signal branch; **D3** add `ICommandHostAdapters.remoteControl.getStatus()` (the command otherwise cannot observe
  pairing state); **D4** QR dep in `agent-cli` (product shell), not agent-command/interface; **D5** keep one spec with
  the pairing gate as the self-contained Step-1 security milestone. Also stated the single-use-rendezvous DoS residual
  (no session access without the secret). Re-review → round 2.
- 2026-07-11 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. All five round-1 fixes verified landed against
  source: the injected-callback effect pattern is real (`command-effect-handler.ts` — `settings-tui-requested →
deps.openTransportTUI()`), so D1's composition-root placement is faithful; the `agent-transport-webrtc →
agent-remote-pairing` edge trips no mechanized rule in `check-dependency-direction.mjs` (pairing is a zero-dep sink →
  no cycle) and the spec commits to recording it at `project-structure.md:26`; D3's `getStatus` closes over the same
  lifecycle state the committed teardown already requires; the Step-1 gate is consistent with the werift no-buffer
  constraint (eager subscription + routing switch; fingerprints available before first `onFrame` since the channel
  can't open pre-answer; role initiator≡offerer; JSON send/parse); no new cross-artifact contradiction. Only nit — a
  loose "into wireChannel" phrasing — corrected to "controller created in the answer branch; eager subscription routes
  to it". **GATE-APPROVAL cleared** → status in-progress, spec moved to active, implementation begins on an
  `origin/develop`-based branch, Step 1 (security milestone) first.
- 2026-07-11 GATE-BUILD — implemented on `feat/remote-008-webrtc-enable-path` (off `origin/develop`). \*\*Steps 1-3 DONE
  - committed** (92bf33eb9 gate; 343075970 command/effects). Step 1: `PairingGate` (`agent-transport-webrtc/src/pairing-gate.ts`,
    7 tests) + `secret` option + fingerprint capture in `webrtc-transport.ts` + `agent-remote-pairing` dep +
    `project-structure.md` edge + SPEC.md; full webrtc suite 19/19, dep-direction clean, harness:scan 49/49. Steps 2-3:
    effect variants + `remoteControl` adapter + `/remote-control` command (7 tests) + default-modules registration
    (count 24→25) + TUI effect dispatch; agent-framework 1080, agent-command 227, tui 418, interface-transport 10 all
    green. **Step 4 grounded (agent-cli composition-root Explore)** — precise anchors for continuation:
    `createDefaultTransportRegistry` cli.ts:86-90 (hoist to a var, also register webrtc); effect deps assembled in
    `agent-transport-tui/src/hooks/useSideEffects.ts:43-61` (add `enableRemoteControl`/`stopRemoteControl`, thread via
    `side-effects-types.ts` → `App.tsx:191-202` ← `IRenderOptions`); command host adapters built in
    `agent-cli/src/startup/command-setup.ts:80-86` (add `remoteControl.getStatus` over a shared mutable holder, since it
    runs before the transport exists); live channel via `onChannelReady`/`setLiveChannel` cli.ts:337 →
    `channel.getSession()` (TuiInteractionChannel.ts:269); relay URL from `readSettings(getUserSettingsPath()).transports?.webrtc?.options?.relayUrl`
    (no merged-config object); `startAll` at channel start will NOT auto-start webrtc (`defaultEnabled:false`, no
    start-one method) → the enable callback `attach(session)`+`start()` the `WebRtcTransport` DIRECTLY (still
    `registry.register` for the transport-TUI panel + `stopAll` teardown); QR via effect-deps `addEntry` (Ink owns stdout
    after `renderApp`); add `agent-transport-webrtc`+`agent-remote-pairing` as agent-cli **devDependencies\*\* (self-contained
    bundle) + a QR dep + `werift` (lazy peer → runtime need when enabled). Steps 4-6 remain; REMOTE-008 lands as ONE PR
    once the enable path is usable (Steps 1-3 alone leave `/remote-control` returning an inert effect).
