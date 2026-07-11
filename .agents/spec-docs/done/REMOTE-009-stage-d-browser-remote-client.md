---
status: done
type: INFRA
tags: [remote-control, webrtc, browser, pairing, web-ui]
parent: REMOTE-001
---

# REMOTE-009: Stage D — browser remote client

Parent: [REMOTE-001](../todo/REMOTE-001-webrtc-p2p-remote-control-design.md) (ENDORSED). Prior sub-stages DONE:
REMOTE-002..008 — the HOST enable path ships (`/remote-control` → QR/link → pairing-gated WebRTC). Stage D is the
**other peer**: the browser page a user opens from the QR/link that pairs and co-drives the SAME live session over
`RTCDataChannel`. Design doc: "a generic fragment-injected static page reusing the protocol + IAgentDriver, swapping
WebSocket for RTCDataChannel; pairing UX (open link/scan → pairing → connected)."

Under **local == remote** (REMOTE-006), the paired browser is the session OWNER — it must reach parity with the local
TUI: observe the stream AND answer the owner's own permission/ask prompts (the REMOTE-007 render+answer the design doc
deferred to this stage).

## Problem (grounded)

Everything the browser needs on the wire exists; **no browser peer speaks it**:

1. **No browser answerer.** The host is the offerer (`webrtc-transport.ts` creates the data channel + offer). No
   browser code answers an offer over a native `RTCPeerConnection` (the host uses werift; the browser must use the
   platform `RTCPeerConnection` — `agent-transport-webrtc` is node/werift-only, not reusable in-browser).
2. **No browser signaling client.** `WsSignalingClient` (`agent-transport-webrtc/src/ws-signaling-client.ts:13`) imports
   `ws` (npm) + uses node `.on(...)` — **node-only** (its own header says the browser implements `ISignalingClient` on
   native `WebSocket`, Stage D). The relay frames are join/joined/signal/error (`apps/remote-signaling/src/relay.ts`).
3. **No browser pairing-responder wiring.** `agent-remote-pairing` is fully isomorphic (WebCrypto; `parsePairingUrl`,
   `startPairingHandshake({role:'responder'})`, `extractDtlsFingerprint`, confirmations all browser-safe —
   `isomorphic.test.ts`), but nothing runs the responder side over a browser data channel. The exact algorithm is
   already proven in Node in `agent-transport-webrtc/src/__tests__/pairing-e2e.test.ts:45-105` — Stage D is the browser
   version (phase-separate pairing vs. session frames; expose the session only post-accept).
4. **Connection abstraction is WebSocket-bound.** `agent-web-ui`'s `ws-session-client.ts:52` does `new WebSocket(url)`
   and exposes `{onMessage, onStatusChange, send}`; `useWsSession.ts` reconstructs conversation state from
   `TServerMessage`. This is the reuse target — the single swap point is the socket → an `RTCDataChannel`.
5. **No fragment entry.** The SPA (`agent-web-ui/spa/main.tsx`) reads a `ws://` URL from a `<meta>` tag (server-injected)
   — there is NO `parsePairingUrl(window.location.href)` / hash read anywhere. The pairing secret lives in the URL
   **fragment** (never sent to the page's host) and must be read client-side.
6. **Web UI can't answer prompts.** `useWsSession.ts` handles `messages/text_delta/tool_*/complete/...` but NOT the
   REMOTE-007 `permission_request`/`ask_request`/`prompt_resolved` server messages — the deferred permission render.
7. **`clientUrl` is a placeholder.** `remote-control-controller.ts` defaults `DEFAULT_CLIENT_URL = 'robota-remote://pair'`
   (a non-existent scheme). Stage D IS the page `transports.webrtc.options.clientUrl` should point at.

## Solution (sub-sequenced, each commit green)

The browser WebRTC/signaling/pairing/session-client code lives in **`agent-web-ui`** (the browser home — it already
owns the Vite SPA, the ws client, the React reducer, and `SessionMonitor`). It gains one new dep: the isomorphic
zero-dep `agent-remote-pairing` leaf. It does NOT depend on `agent-transport-webrtc` (node/werift). All new browser
transport code uses the platform `RTCPeerConnection`/`WebSocket`.

1. **Browser signaling client (`ISignalingClient` over native `WebSocket`).** Mirror `WsSignalingClient` but drop the
   `ws` import and node `.on()` API — use `socket.onopen/onmessage/onerror/onclose`; same join/joined/signal/error frames
   - pre-open outbox buffering. Unit-testable with a fake `WebSocket`.
2. **Browser answerer + pairing responder + data-channel session client (`createRtcSessionClient`).** A new client with
   the SAME `{ onMessage(TServerMessage), onStatusChange, send(TClientMessage) }` contract as `createWsSessionClient`,
   backed by a native `RTCPeerConnection` (answerer): on `offer` → setRemoteDescription → createAnswer → setLocalDescription
   → send answer; capture the host fingerprint from the offer SDP and the local from the answer SDP (`extractDtlsFingerprint`);
   the data channel arrives via `ondatachannel`. Run `startPairingHandshake({ secret, role:'responder', localFingerprint,
remoteFingerprint, send })` over the channel, **phase-separated**: pre-accept route inbound to `controller.onFrame`
   (drop non-pairing), and only on `controller.result` accept switch routing to `onMessage(TServerMessage)` and allow
   `send(TClientMessage)` (mirrors the host gate + the Node responder). Reject/timeout → status `failed`, expose nothing.
3. **Fragment-injected SPA entry + pairing UX.** A new SPA entry that calls `parsePairingUrl(window.location.href)` →
   `{ rendezvous, secret }`, builds the signaling client + `createRtcSessionClient`, and renders the pairing-UX states
   (reading link → connecting/pairing → connected → failed). Feed the existing `useWsSession` reducer + `SessionMonitor`
   from the RTC client (the reducer is transport-agnostic — `TServerMessage` in). Static, no server state; hostable anywhere.
4. **REMOTE-007 permission/ask render+answer (deferred item, now home).** Extend `useWsSession` to handle
   `permission_request`/`ask_request` (render a prompt) and `prompt_resolved` (dismiss), and send `permission-response`/
   `ask-response` `TClientMessage`s — so the paired browser owner answers their OWN prompts (local == remote). This
   works over BOTH the WS client (agent-web-ui's existing localhost path) and the new RTC client (same `TServerMessage`s).
5. **`clientUrl` fail-closed (remove the fabricated default) + verify.** DELETE `DEFAULT_CLIENT_URL = 'robota-remote://pair'`
   (`remote-control-controller.ts:27,113`) — a live no-fallback violation REMOTE-008 shipped that mints a link going
   nowhere. When `transports.webrtc.options.clientUrl` is unset, `enable()` returns a surfaced error ("set clientUrl to
   your hosted Stage-D page") and does NOT construct/start the transport — an early return like the existing "no active
   session yet" path (`:77`), leaving `status` untouched (no new status-enum variant). Document setting `clientUrl` to
   the hosted Stage-D page. Wire the SPA build + a smoke E2E.

## Affected Files

- `agent-web-ui/src/client/**` (NEW: `rtc-signaling-client.ts` browser `ISignalingClient`; `rtc-session-client.ts`
  `createRtcSessionClient` = answerer + pairing responder + data-channel session client) + `package.json` (add
  `agent-remote-pairing` dep)
- `agent-web-ui/src/hooks/useWsSession.ts` (handle `permission_request`/`ask_request`/`prompt_resolved`; send
  `permission-response`/`ask-response`) + a prompt component in `components/`
- `agent-web-ui/spa/**` (NEW fragment-injected entry + pairing-UX shell) + `vite.spa.config.ts`/build wiring
- `agent-web-ui/docs/SPEC.md`
- `agent-cli/src/remote-control/remote-control-controller.ts` (DELETE `DEFAULT_CLIENT_URL`; when `clientUrl` unset,
  `enable()` returns a surfaced error string and does NOT construct/start the transport — exactly like the existing
  "no active session yet" early-return at `:77`, leaving `status` untouched; NO new status-enum variant, so no
  `agent-framework` enum / `agent-command` renderer churn) + controller tests
- `agent-web-ui/src/__tests__/**` (fingerprint-parity gate: `extractDtlsFingerprint` over a real native-browser answer
  SDP fixture == the host-verified value; reuse the werift offer fixture)
- changeset

## Decisions (resolved at GATE-APPROVAL round 1)

- **D1 — placement in `agent-web-ui`** (adds only the zero-dep `agent-remote-pairing` leaf; no cycle). The browser
  session client is contract-coupled to the React reducer + WS client already there; `./client` browser subpath is the
  home. **HARD: no `agent-transport-webrtc`/werift edge** — the browser uses the platform `RTCPeerConnection`.
- **D2 — mirror `createWsSessionClient`'s `{onMessage,onStatusChange,send}` contract** (single honest swap point socket →
  data channel), NOT the node `IAgentDriver` (a node/test contract the web UI doesn't consume).
- **D3 — include the REMOTE-007 permission/ask render+answer in Stage D** — a CORRECTNESS requirement, not convenience:
  under local == remote the paired browser is the OWNER; an owner that can't answer its own prompts deadlocks a gated
  tool. Landing it in the shared `TServerMessage` reducer serves BOTH the WS and RTC clients at once.
- **D4 — jsdom + fake `RTCPeerConnection`/`WebSocket`**, pairing crypto UNMOCKED (`agent-remote-pairing` real), Node
  responder (`pairing-e2e.test.ts`) as the oracle. No headed-browser E2E.
- **D5 — remove the fabricated `DEFAULT_CLIENT_URL` (no-fallback fix).** DELETE `robota-remote://pair`
  (`remote-control-controller.ts:27,113`); when `clientUrl` is unset, `enable()` returns a surfaced error string and
  does NOT construct/start the transport — an early return like the existing "no active session yet" path (`:77`),
  leaving `status` untouched. **No new status-enum variant** (reviewer option A — avoids `agent-framework` enum SSOT +
  `agent-command` renderer churn; a static config error is surfaced at enable time, not a persistent queryable state).
  Closes a live no-fallback violation REMOTE-008 shipped: never mint a dead `robota-remote://pair` link.
- **D6 — fingerprint parity is a GATING security test (not an open question).** `extractDtlsFingerprint` takes the first
  `a=fingerprint` + uppercases; native browser SDP may carry session- + media-level lines / lowercase. A RED test
  asserts extraction over a **real native-browser answer SDP fixture** yields the host-verified value (cross-checked vs
  werift's advertised fp / the existing `packages/agent-remote-pairing/src/__tests__/fixtures/werift-offer.sdp`). The channel binding only holds if these
  match. (TOFU reconnect is Stage E, out of scope.)

## Test Plan

RED→GREEN. Unit: the browser signaling client (fake `WebSocket`: join → buffered outbox → signal round-trip);
`createRtcSessionClient` pairing wiring (fake `RTCPeerConnection`/channel + real `agent-remote-pairing`: answer the
offer, run the responder handshake, expose the session ONLY post-accept, drop pre-accept non-pairing frames, `failed` on
reject) — using the Node responder in `pairing-e2e.test.ts` as the algorithm oracle. **Fingerprint-parity gate (D6):**
`extractDtlsFingerprint` over a real native-browser answer SDP fixture equals the host-verified value. `useWsSession`
reducer: a `permission_request` renders a prompt and answering sends `permission-response`; `prompt_resolved` dismisses.
Controller: unset `clientUrl` fails closed (no dead link). Build: the new SPA entry compiles + `parsePairingUrl` reads
the fragment. harness:scan + full typecheck + changeset.

## Evidence Log

- 2026-07-11 GATE-DRAFT — authored from an 8-point read-only Explore. Grounding: `agent-remote-pairing` fully isomorphic
  (browser-ready); `agent-web-ui` is the reuse target (`ws-session-client.ts:52` `new WebSocket(url)` is the swap point,
  `useWsSession.ts` is the transport-agnostic `TServerMessage` reducer, Vite SPA build exists); `WsSignalingClient` is
  node-only (`ws` import); no browser answerer/signaling/pairing/fragment-entry exists; `useWsSession` doesn't yet handle
  the REMOTE-007 prompt messages; `agent-remote-client` (despite the name) is a node HTTP `IExecutor` — NOT a Stage-D
  target. The Node responder in `pairing-e2e.test.ts:45-105` is the exact browser algorithm. Pending proposal-reviewer ENDORSE.
- 2026-07-11 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction correct; all 6 recommendations verified +
  adopted as D1–D6; every premise TRUE against source, incl. `agent-remote-pairing` zero-dep isomorphic, `agent-web-ui`
  the reuse target, `WsSignalingClient` node-only, `useWsSession` missing the 3 prompt messages, the Node responder as
  oracle). Two required changes folded in: **D5** — the spec now commits to DELETING the fabricated
  `DEFAULT_CLIENT_URL='robota-remote://pair'` and failing closed on unset `clientUrl` (a live no-fallback violation
  REMOTE-008 shipped, not to be carried forward); **D6** — fingerprint-parity reclassified from open question to a
  gating security test (real native-browser answer SDP fixture == host-verified fp). Security design ENDORSED
  (directional binding, expose-only-post-accept, phase separation, secret in fragment). Re-review → round 2.
- 2026-07-11 GATE-APPROVAL round 2 — proposal-reviewer **REVISE**. Confirmed both round-1 fixes landed (D5 delete +
  fail-closed; D6 gating fingerprint test; `DEFAULT_CLIENT_URL='robota-remote://pair'` verified live at
  `remote-control-controller.ts:27,113`; `werift-offer.sdp` fixture exists). ONE new inconsistency my round-2 edit
  introduced: a half-committed "new `no-client` status/message" phrase in Affected Files would need the
  `TRemoteControlStatus` enum SSOT (`agent-framework/command-api/host-adapters.ts`) + the `formatStatus` renderer
  (`agent-command/.../remote-control-command.ts`, which else silently falls to "unknown") — neither in scope. Adopted
  reviewer **option A**: unset `clientUrl` → `enable()` returns a surfaced error + does NOT enable (early return like the
  existing "no active session yet" path at `:77`), leaving `status` untouched — NO new enum variant, no
  agent-framework/agent-command churn. Aligned D5, Solution step 5, Affected Files, Test Plan. Fixed the
  `werift-offer.sdp` fixture path. Re-review → round 3.
- 2026-07-11 GATE-APPROVAL round 3 — proposal-reviewer **ENDORSE**. Option A verified consistently applied across D5,
  Solution step 5, Affected Files, Test Plan (delete `DEFAULT_CLIENT_URL`; unset `clientUrl` → error string + no
  construct/start, early return like `:77`, status untouched, no new enum variant, no agent-framework/agent-command
  churn); the `:77` "no active session yet" early-return + the `:27,113` default + the `werift-offer.sdp` fixture all
  verified TRUE; D1–D4/D6 coherent; no remaining contradiction. Note: the `clientUrl` check must move ahead of the
  current `:113` read to before transport construction (the spec's "early return" captures this). **GATE-APPROVAL
  cleared** → status in-progress, spec to active, implement on an `origin/develop`-based branch, Step 1 first.

## Tasks

- [x] Step 1 — browser signaling client `rtc-signaling-client.ts` (`ISignalingClient` over native `WebSocket`;
      join/joined/signal/error + pre-open outbox buffering). Unit tests with a fake `WebSocket`.
- [x] Step 2 — `createRtcSessionClient` (native `RTCPeerConnection` answerer + `startPairingHandshake('responder')` over
      the data channel; phase-separated routing switch, expose session ONLY post-accept, drop pre-accept non-pairing,
      `failed` on reject; `{onMessage,onStatusChange,send}` contract mirroring `createWsSessionClient`) + the D6
      fingerprint-parity gating test (native-answer SDP fixture == host-verified fp). Unit tests (fake RTCPeerConnection,
      real agent-remote-pairing, Node responder oracle). + `agent-remote-pairing` dep.
- [x] Step 3 — fragment-injected SPA entry + pairing-UX shell (`parsePairingUrl(window.location.href)` → connecting →
      pairing → connected → failed) feeding the existing `useWsSession` reducer + `SessionMonitor`. Vite build wiring.
- [x] Step 4 — REMOTE-007 render+answer in `useWsSession`: handle `permission_request`/`ask_request`/`prompt_resolved`,
      send `permission-response`/`ask-response` + a prompt component. Reducer unit tests (works for WS + RTC clients).
- [x] Step 5 — D5 fail-closed: delete `DEFAULT_CLIENT_URL`, unset `clientUrl` → error string early-return (no
      construct/start) + controller test. `agent-web-ui/docs/SPEC.md` + `clientUrl` guidance.
- [x] Step 6 — verify: harness:scan + full typecheck + changeset.
- 2026-07-11 GATE-BUILD — implemented on `feat/remote-009-browser-remote-client` (off origin/develop), all 6 steps
  committed. Step 1 `createRtcSignalingClient` (native WebSocket, 8 tests); Step 2 `ResponderGate` (client dual of the
  host PairingGate — fail-closed routing switch, 8 tests) + `createRtcSessionClient` (answerer glue, 2 tests) + D6
  fingerprint-parity gate (werift session-level uppercase == native media-level lowercase → identical canonical fp, 4
  tests); Step 4 `useWsSession` permission/ask render+answer via a pure `prompt-state` module (6 tests) — REMOTE-007's
  deferred web render, shared by WS + RTC; Step 5 deleted `DEFAULT_CLIENT_URL`, unset `clientUrl` fails closed (early
  return, status untouched; +controller test); Step 3 hook generalized to `useSessionClient(makeClient)` +
  `useWsSession`/`useRtcSession` wrappers, `parseRemoteClientLocation` (4 tests), `RemoteClient`/`PermissionPrompt`,
  `spa/remote.html` fragment entry (both SPA entries build). No `agent-transport-webrtc`/werift edge (only the zero-dep
  `agent-remote-pairing` leaf added). Verify: agent-web-ui 36, agent-cli 178, harness:scan 49/49, full-repo typecheck 0,
  changeset present, agent-web-ui SPEC public-API table updated. Ready for implementation review + merge-verifier.
- 2026-07-11 GATE-REVIEW (implementation) — proposal-reviewer **ENDORSE**. Security-critical core verified: no path
  delivers a `TServerMessage` to the reducer (or sends a `TClientMessage`) before a genuine channel-bound
  confirmation; `accept()` reachable only via the crypto `result`; fail-closed on reject/timeout/missing-fingerprint;
  directional binding correct (host fp←offer, local fp←answer); D6 cross-dialect fingerprint parity real; secret only
  in the fragment (never query/relay); dependency direction clean (only agent-remote-pairing added, no werift edge);
  D5 fail-closed early-return before any construction. 3 non-blocking notes: fixed the stale `clientUrl` JSDoc; the
  post-accept `TServerMessage` cast is safe (host cryptographically authenticated + reducer ignores unknown types);
  the responder-nonce send starts synchronously in `ondatachannel` (safe — answerer's channel is open when the event
  fires; fails closed via timeout if not) — flagged for a Stage-E headed-browser check. Ready for merge feature→develop→main.
- GATE-COMPLETE — merged to main via PR #1111 (feature→develop) → PR #1112 (develop→main), both merge-verifier PASS
  (REMOTE-009-only, D5 deletion confirmed, no lessons drift, CI green incl. release-grade + compat-node18). Spec moved
  active→done, status done. **REMOTE-001's full user story now ships:** `/remote-control` on the host → QR/link → the
  browser pairs + co-drives the SAME session over WebRTC. Remaining: Stage E (TOFU trusted-device reconnect + optional
  TURN fallback + co-drive UX polish) — the last hardening stage. Follow-up backlog: `TransportRegistry.unregister`;
  a headed-browser E2E for the responder-nonce send timing (impl-review note 3).
