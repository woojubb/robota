---
status: done
type: INFRA
tags: [remote-control, webrtc, transport, signaling]
parent: REMOTE-001
---

# REMOTE-002: Stage A — extract `agent-transport-protocol` + `agent-transport-webrtc` skeleton + signaling server

Parent design: [REMOTE-001](./REMOTE-001-webrtc-p2p-remote-control-design.md) (ENDORSED). This is **Stage A**:
the transport/protocol plumbing, loopback-verified, **with NO user-facing enable path and NO auth** (that lands
in Stage B). It must not expose a network-reachable unauthenticated channel.

## Problem

To carry the session over WebRTC (parent design), three plumbing pieces must exist and be proven in isolation
before any pairing/auth or `/remote-control` command is built:

1. The transport-neutral session bridge + protocol currently lives inside `agent-transport-ws`
   (`ws-handler.ts`, `ws-protocol.ts`, `ws-background-messages.ts` — verified zero `ws`/`node:` imports). A
   WebRTC transport must reuse it **without** a `webrtc → ws` package edge.
2. There is no WebRTC transport that implements `IConfigurableTransport` over an `RTCDataChannel`.
3. There is no signaling rendezvous for the two NAT'd peers to exchange SDP/ICE.

## Solution (sub-sequenced, each commit green)

1. **Extract `@robota-sdk/agent-transport-protocol`** (new package; deps: `@robota-sdk/agent-interface-transport`
   — confirm `agent-core` is unneeded per the round-2 note). `git mv` `ws-handler.ts`, `ws-protocol.ts`,
   `ws-background-messages.ts` (+ `__tests__/ws-handler.test.ts`) into it; export `createWsHandler`,
   `IWsHandlerOptions`, `TClientMessage`, `TServerMessage` (keep names — the WS wire protocol is unchanged).
   Repoint:
   - `agent-transport-ws` internals (`ws-transport.ts`, `ws-transport-configurable.ts`, `index.ts`) to import
     the handler/protocol from `agent-transport-protocol`; add it as a dep; drop the moved files. To avoid a
     prohibited pass-through re-export, `agent-transport-ws/index.ts` **stops** re-exporting the protocol
     types — consumers import them from `agent-transport-protocol`.
   - External consumers of the moved **protocol types** (corrected — `agent-cli/src/cli.ts` is NOT one: it
     imports `WsTransport`, which STAYS in `-ws`, and references no protocol type): only `agent-web-ui` —
     `packages/agent-web-ui/src/client/ws-session-client.ts` (its `import type { TServerMessage, TClientMessage }`
     from `-ws`; it keeps its own local re-export of them — a legitimate use-and-re-export, not a bare
     pass-through) and `packages/agent-web-ui/src/hooks/useWsSession.ts` (its `TServerMessage` import) →
     repoint to `@robota-sdk/agent-transport-protocol`; the transitively-affected
     `packages/agent-web-ui/src/client/__tests__/ws-session-client.test.ts` rides the web-ui-local re-export.
   - **Moved-ownership SPEC updates:** `packages/agent-transport-ws/docs/SPEC.md` and
     `packages/agent-web-ui/docs/SPEC.md` currently declare `-ws` owns
     `TClientMessage`/`TServerMessage`/`createWsHandler` → update them to name `agent-transport-protocol` as the
     owner (spec-public-surface will otherwise flag the moved surface).
2. **New `@robota-sdk/agent-transport-webrtc`** (mirrors `agent-transport-ws` package shape; deps:
   `agent-interface-transport` + `agent-transport-protocol`; the werift dep is **external/lazy**, see step 4):
   - `WebRtcTransport implements IConfigurableTransport` (`name='webrtc'`, `defaultEnabled: false`,
     `optionsSchema`, `validateOptions`). `attach(session)` stores it; `start()` opens an `RTCPeerConnection`
     (werift), negotiates via an injected **signaling client**, and on `RTCDataChannel` open wires
     `createWsHandler({ session, send: m => channel.send(JSON.stringify(m)) })` +
     `channel.onmessage = e => onMessage(String(e.data))`; `stop()` closes the channel/peer.
   - A `ISignalingClient` port (send/receive SDP+ICE by rendezvous id) so the transport is testable with an
     in-memory/mock signaling client (no server, no network) in Stage A.
3. **Minimal signaling server** `apps/remote-signaling` (new deployable): a tiny WS server that pairs two
   outbound peers by rendezvous id and relays **only** SDP offers/answers + ICE candidates (opaque blobs).
   Stateless per rendezvous; holds no session content; **no auth trust** (rate-limiting hooks stubbed, wired in
   Stage B). Shaped like `PlaygroundWebSocketServer` (session-keyed routing) but WITHOUT its JWT-as-trust model.
4. **werift viability spike + INFRA-028 lazy-load.** Add `werift` (pure-TS) as the WebRTC impl; confirm
   `RTCPeerConnection` + `RTCDataChannel` establish + round-trip in a Node↔Node loopback. Load it behind a
   `try/require` (mirroring `loadReplayProvider`, `cli.ts:73-84`): if werift is absent, surface an **explicit
   "WebRTC transport unavailable — install werift" error at point-of-use** (a throw, exactly like
   `loadReplayProvider`) — **never a silent no-op or a wrong-path degrade** (no-fallback rule). The
   werift-vs-native choice is a **recorded design decision** gated by the loopback spike, NOT a runtime
   fallback; if werift proves inadequate (data-channel bugs/perf), switch to native `node-datachannel` and
   record it — but then it is a runtime `dependencies` external of the eventual CLI, not bundled (INFRA-028).
5. **NO enable path.** Do **not** register `WebRtcTransport` in `cli.ts`'s default registry in Stage A, and do
   not add `/remote-control`. Stage A is exercised only by tests. (This guard is a completion criterion.)

## Affected Files

- `packages/agent-transport-protocol/**` (new: package.json, tsconfig(s), tsdown, moved `ws-handler`/`ws-protocol`/`ws-background-messages` + test, docs/SPEC.md)
- `packages/agent-transport-ws/src/{ws-transport.ts,ws-transport-configurable.ts,index.ts}` + `package.json` (dep on protocol; drop moved files)
- `packages/agent-web-ui/src/{client/ws-session-client.ts,hooks/useWsSession.ts}` (repoint protocol-type imports; `agent-cli/src/cli.ts` is NOT affected — it imports `WsTransport`, which stays)
- `packages/agent-transport-ws/docs/SPEC.md`, `packages/agent-web-ui/docs/SPEC.md` (moved-ownership: name `agent-transport-protocol` as protocol-type owner)
- `packages/agent-transport-webrtc/**` (new: package + `WebRtcTransport` + `ISignalingClient` port + tests + SPEC)
- `apps/remote-signaling/**` (new minimal signaling server + tests)
- changeset

## Completion Criteria

- [x] TC-01: `@robota-sdk/agent-transport-protocol` exports `createWsHandler`/`IWsHandlerOptions`/
      `TClientMessage`/`TServerMessage`; the moved `ws-handler.test.ts` passes there (28 tests); the package
      `dependencies` are **`@robota-sdk/agent-interface-transport` ONLY** — asserted by inspection +
      dep-direction + build green. (Step 1, committed.)
- [x] TC-02: `agent-transport-ws` imports the handler/protocol from `agent-transport-protocol`, no longer
      contains the moved files, and its full suite passes unchanged (5 tests); `agent-transport-ws/index.ts` no
      longer re-exports the protocol types (no pass-through). `agent-web-ui` typechecks + its suite passes
      (4 tests); `agent-cli` typechecks **unchanged** (imports `WsTransport`, not the protocol types — no
      cli.ts edit). (Step 1, committed.)
- [x] TC-03: `WebRtcTransport` implements `IConfigurableTransport` (`name='webrtc'`, `defaultEnabled:false`);
      a **loopback / in-memory-signaling** integration test opens an `RTCPeerConnection`+`RTCDataChannel`
      between two in-process peers and round-trips a `TClientMessage` (`get-messages`)→session→`TServerMessage`
      (`messages`) through the reused handler (stubbed session; no real provider). 3 tests green.
- [x] TC-04: the signaling server (`apps/remote-signaling`) pairs two peers by rendezvous id and relays SDP/ICE
      only (unit test asserts it never forwards a non-signaling payload nor an unknown signal kind); holds no
      session state (no-state-after-leave asserted). 6 tests green.
- [x] TC-05: werift viability confirmed by TC-03 (werift retained; no switch to `node-datachannel`); the WebRTC
      dep is lazy-loaded via `loadWerift` and its **absence surfaces an explicit "WebRTC transport unavailable"
      error at point-of-use (a throw, like `loadReplayProvider`) — never a silent no-op or degraded path**,
      asserted by `werift-loader.test.ts` (injected throwing resolver). 2 tests green.
- [x] TC-06: **NO enable path** — `WebRtcTransport` is not registered in `cli.ts`; there is no `/remote-control`
      command (grep-asserted, zero matches); AND the signaling server binds **loopback/ephemeral (`127.0.0.1:0`)
      in tests** and is **not wired into any default runnable / publish / deploy path** (`remote-signaling` is
      `private`, no deploy config references it). Stage A ships no network-reachable unauthenticated channel.
- [x] TC-07: full `pnpm harness:scan` **49/49** + affected `pnpm test` + full-repo `pnpm typecheck` **0
      errors**; the moved-ownership SPEC edits (`agent-transport-ws`, `agent-web-ui`) keep spec-public-surface
      green; affected suites green (agent-transport-protocol 28, -ws 5, -webrtc 5, agent-web-ui 4,
      apps/remote-signaling 6, capability-placement scan-test 5); changeset present.

## Test Plan

RED→GREEN per step. The protocol extraction is a move + repoint (its test rides along). The WebRTC transport is
proven by a Node↔Node loopback data-channel round-trip through the shared handler with a stubbed session (no
real provider — common-mistakes #76). The signaling server is unit-tested for SDP/ICE-only relay + rendezvous
pairing + no-content. Harness `deps`/`entry-point-only`/`spec-public-surface` green; the new packages carry a
`docs/SPEC.md`. Full `harness:scan` + `harness:test` + typecheck + changeset (TC-07).

## Open Questions (for GATE-APPROVAL)

1. **`agent-transport-protocol` name/scope** — is a `-protocol` suffix the right name, or `agent-transport-core`
   (avoid confusion with the `agent-transport` package)? Confirm deps = `agent-interface-transport` only.
2. **werift vs node-datachannel** — proceed werift-first with the loopback spike as the gate (design decision);
   confirm the loopback test is a fair viability bar.
3. **Signaling server home/name** — `apps/remote-signaling`; confirm minimal + content-free shape and that it
   does not import agent runtime packages (it is a dumb relay).
4. **Repoint vs. thin re-export** — the spec repoints external consumers off `agent-transport-ws` for the
   protocol types (no pass-through). Confirm this is preferred over a (prohibited) re-export.

## Tasks

- [x] Step 1 — extract `agent-transport-protocol` (move 3 files + test; repoint -ws internals + agent-web-ui; drop -ws protocol re-exports; SPEC ownership updates). Committed.
- [x] Step 2 — new `agent-transport-webrtc` (WebRtcTransport + ISignalingClient port; werift; reuse handler).
- [x] Step 3 — minimal `apps/remote-signaling` (SDP/ICE relay by rendezvous id, content-blind).
- [x] Step 4 — werift viability spike (Node loopback data-channel round-trip) + throw-on-absence lazy-load.
- [x] Step 5 — verify: no enable path (TC-06); harness:scan + harness:test + typecheck + changeset.

## Evidence Log

- 2026-07-10 GATE-DRAFT — authored from REMOTE-001 Stage A. Extraction surface verified:
  `agent-transport-ws` exports `createWsHandler`/`IWsHandlerOptions`/`TClientMessage`/`TServerMessage` from the
  three ws-free files; external protocol-type importers = `agent-cli/cli.ts`,
  `agent-web-ui/{client/ws-session-client.ts,hooks/useWsSession.ts}`. Stage A is loopback/mock only, no enable
  path (TC-06). Pending proposal-reviewer ENDORSE.
- 2026-07-10 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction endorsed; all architectural
  premises TRUE — clean cycle-free extraction, `-protocol` deps = agent-interface-transport only, no
  `webrtc→ws` edge, signaling-in-Stage-A safe because it is a content/session-blind relay never wired to a
  session). 4 corrections folded in: (1) **importer premise corrected** — `agent-cli/cli.ts` imports
  `WsTransport` (stays), NOT the protocol types; the real repoint set is `agent-web-ui` (ws-session-client.ts +
  useWsSession.ts) + its local test; TC-02 wording fixed. (2) **werift lazy-load** must THROW an explicit
  "unavailable" error on absence (like `loadReplayProvider`), never silently degrade (no-fallback); the
  werift-vs-native choice is a recorded decision, not a runtime fallback. (3) **TC-06 strengthened** — the
  signaling server binds loopback/ephemeral in tests + is not wired into any runnable/publish/deploy path. (4)
  **moved-ownership SPEC updates** added (`agent-transport-ws`/`agent-web-ui` docs/SPEC → name
  `agent-transport-protocol` owner) + TC-01 dep-set clause. Re-review → round 2.
- 2026-07-10 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. All four round-1 corrections verified
  present + code-accurate + internally consistent (agent-cli imports WsTransport not protocol types → no
  repoint; werift throw-on-absence like loadReplayProvider; TC-06 covers the signaling server loopback/no-wire;
  moved-ownership SPEC edits + TC-01 dep clause). Design APPROVED → implement. Spec → active.
- 2026-07-10 GATE-IMPLEMENT Step 1 — `agent-transport-protocol` extracted (git mv 3 files + test; -ws/-web-ui
  repointed; -ws protocol re-exports dropped; moved-ownership SPECs updated). Committed `4dacb1578`;
  harness:scan 49/49 at that point (TC-01/TC-02 green).
- 2026-07-10 GATE-IMPLEMENT Steps 2–5 — `agent-transport-webrtc` (`WebRtcTransport` + `ISignalingClient` port +
  in-memory pair + `loadWerift`) and `apps/remote-signaling` (content-blind `SignalingRelay` + `ws` binding)
  built; werift retained.
  - **werift viability CONFIRMED (TC-05).** A Node↔Node loopback (scratchpad spike, then the TC-03 integration
    test) establishes `RTCPeerConnection`+`RTCDataChannel` and round-trips `get-messages`→session→`messages`
    through the reused `createWsHandler`. Two werift-specific ordering facts were discovered and encoded in the
    transport: (a) werift does **not** buffer trickle ICE candidates that arrive before `setRemoteDescription`,
    so inbound answer/ICE signals are processed on a **serialized chain** (setRemoteDescription always precedes
    addIceCandidate); (b) werift does **not** buffer inbound data-channel frames received before a subscription
    exists, and the answerer can open + send its first frame before the offerer's `open` fires — so the handler
    is built and `onMessage` subscribed **eagerly at channel creation**, not on `open`, and outbound `send` runs
    under try/catch (werift buffers sends while `connecting`; only `closing`/`closed` throws). werift retained;
    no switch to `node-datachannel`.
  - **Throw-on-absence (TC-05).** `loadWerift` gained an injectable resolver seam; `werift-loader.test.ts`
    asserts it throws the explicit "WebRTC transport unavailable — install … werift" error when resolution
    fails (never a silent no-op).
  - **No enable path (TC-06)** grep-verified: no `WebRtcTransport`/`agent-transport-webrtc`/`remote-control`
    reference in `agent-cli`; `remote-signaling` is `private`, binds `127.0.0.1:0` in tests, wired into no
    runnable/publish/deploy path.
  - **Verification (TC-07):** harness:scan **49/49** (added `apps/remote-signaling` to project-structure + the
    capability-placement allowlist; authored webrtc & remote-signaling `docs/{SPEC,README}.md`); full-repo
    `pnpm typecheck` **0 errors**; suites green — agent-transport-protocol 28, -ws 5, -webrtc 5, agent-web-ui 4,
    apps/remote-signaling 6, capability-placement scan-test 5. Changeset added. Stage A complete → GATE-VERIFY.
- 2026-07-10 GATE-VERIFY — PR #1079 (feature→develop). CI green EXCEPT `security audit`, which flagged a **high**
  advisory introduced by werift: **CVE-2024-29415 / GHSA-2p57-rm9w-gvfp** — `ip` SSRF (`isPublic`
  miscategorization) via `werift@0.23.0 → {ip, werift-ice → ip}@2.0.1`. **Upstream is unfixable**: `ip` has no
  patched release (advisory "patched: <0.0.0"), and werift@0.23.0 is the latest and still depends directly on
  `ip@^2.0.1` — a werift bump does not remove it. **Decision:** added `CVE-2024-29415` to root
  `pnpm.auditConfig.ignoreCves` (the repo's established mechanism for unfixable transitive advisories; 5 already
  listed). Justified for Stage A because werift is an **optional peer dependency**, lazy-loaded, and **not wired
  into any runnable/publish/deploy path** (TC-06) — the `ip` code path is unreachable in Stage A (loopback tests
  only), so there is **no production SSRF surface** here.
  - **SECURITY FOLLOW-UP (Stage B — mandatory before the enable path ships):** Stage B makes ICE candidate
    gathering reachable, at which point `ip.isPublic`/`isPrivate` miscategorization becomes security-relevant
    (SSRF-filter bypass on the P2P path). Before REMOTE-001 Stage B ships, RE-EVALUATE this: either (a) our own
    ICE candidate policy (restricted STUN/TURN + candidate-type allowlist) fully neutralizes the miscategorization,
    (b) override `ip` to a maintained fork, or (c) re-accept with a documented, reviewed rationale. This must NOT
    be silently inherited — recorded here + carried into the REMOTE-001 design's Stage B security section.
- 2026-07-10 GATE-COMPLETE — after the `ignoreCves` fix, PR #1079 CI fully green (security audit pass) →
  merged to **develop** (`ad2006b38`), then promoted **develop→main** via PR #1080 (`402555dab`). Both hops
  independently confirmed by the merge-verifier (PASS/PASS): all REMOTE-002 Stage A paths present on
  `origin/main`, no unrelated drift, CI green on both PRs. Stage A shipped. Spec `active → done`
  (`status: done`). Next: REMOTE-001 Stage B (the enable path) — must first discharge the CVE-2024-29415
  security follow-up above.
