---
status: in-progress
type: INFRA
tags: [remote-control, webrtc, turn, ice, hardening]
parent: REMOTE-001
---

# REMOTE-010: Stage E1 — user-supplied TURN fallback

Parent: [REMOTE-001](../todo/REMOTE-001-webrtc-p2p-remote-control-design.md) (ENDORSED). Prior stages DONE:
REMOTE-002..009 — the full user story ships (host `/remote-control` → QR/link → browser pairs + co-drives over
WebRTC). **Stage E (final hardening) is decomposed** (grounding 2026-07-11) into: **E1 = TURN fallback (this)**;
E2 = signaling-server abuse hardening; E3 = TOFU trusted-device reconnect; E4 = reconnection/session-resume (on E3);
E5 = co-drive concurrency + attribution. E1/E2 are the self-contained, protocol-free, hardening-first pieces.

**E1 problem:** host-candidate-only P2P fails behind symmetric NAT / restrictive firewalls — the two peers can never
form a direct connection, so remote control silently never connects. The fix is user-supplied TURN relay servers (the
operator brings their own TURN; we do not host one) threaded to BOTH peers' `RTCPeerConnection`, plus the optional
`forceTurn` privacy hardening (REMOTE-004) that restricts ICE to relay candidates only.

## Problem (grounded)

Both `RTCPeerConnection` sinks already accept ICE config; **nothing threads it from config**:

1. **Host transport — accepts, unwired.** `IWebRtcTransportOptions` already has `iceServers?: readonly {urls:string}[]`
   (`webrtc-transport.ts:18`) + `forceTurn?: boolean` (`:24`), consumed in `start()` (`:74-77`). But the composition
   root `defaultCreateTransport` (`remote-control-controller.ts:171-182`) constructs `new WebRtcTransport({signaling,
secret,onPaired,onPairingFailed})` — **no iceServers/forceTurn**. `IRemoteControlControllerDeps` (`:26-46`) +
   `readWebrtcOption` (`index.ts:20-46`) read only `relayUrl`/`clientUrl`.
2. **Browser client — accepts, unwired.** `IRtcSessionClientOptions.iceServers?: RTCIceServer[]`
   (`rtc-session-client.ts:48`, comment literally "Stage E supplies TURN") is consumed at `:122`. But `useRtcSession`
   (`useWsSession.ts:230`) calls `createRtcSessionClient({relayUrl,rendezvous,secret})` — no iceServers;
   `parseRemoteClientLocation` (`parse-remote-location.ts`) parses no ICE; `RemoteClient` passes `location` straight through.
3. **Config surface — untyped bag.** `transports.webrtc.options` is `Record<string, unknown>` (`agent-framework/src/config/config-types.ts`,
   the `transports?: Record<string,{enabled?;options?:Record<string,unknown>}>` shape). `relayUrl`/`clientUrl` are read
   from it by a **string-only** `readWebrtcOption` (`index.ts:21-31`). `iceServers` is a STRUCTURED value, so it needs a
   NEW validating reader (the string reader cannot be reused).

## Solution (sub-sequenced, each commit green)

1. **Host config → transport (with a validating reader).** Add `readIceServers(): RTCIceServer[] | undefined` +
   `readForceTurn(): boolean` to `IRemoteControlControllerDeps` + `createRemoteControlController`. `readIceServers` is a
   **dedicated validator** that narrows the untyped `transports.webrtc.options.iceServers` (`unknown`) → a well-formed
   `RTCIceServer[]` (each entry has a string/array `urls` with a sane `stun:`/`turn:`/`turns:` scheme; optional
   string `username`/`credential`) — **no `any`, no unchecked cast** (strict-TS); a malformed value **fails closed** (a
   clear error, not a silent partial config). Pass both through `defaultCreateTransport` → `new WebRtcTransport({...,
iceServers, forceTurn})`. Validate: `forceTurn` requires ≥1 `turn:`/`turns:` url in `iceServers` (REMOTE-004
   belt-and-braces — `forceTurn` with no TURN filters ICE to relay-only → zero candidates → a SILENT never-connect;
   turning that into a config-time error is the no-fallback fix, not a privacy regression). Controller unit tests via
   the existing `createTransport` seam. NOTE the read stays in `agent-cli` (the composition root that already depends on
   `agent-transport-webrtc`) because `agent-framework`'s config layer is deliberately **domain-free** — teaching it the
   webrtc option shape would push transport-domain knowledge up a layer (dependency-direction violation). (This is the
   LAYERING reason, not "no schema change".)
2. **Browser TURN threading (with a validating decoder).** Extend `IRemoteClientLocation` + `parseRemoteClientLocation`
   to read an optional `ice` query param (a base64url-encoded JSON `RTCIceServer[]`) and a `forceTurn` flag, thread
   through `RemoteClient` → `useRtcSession` → `createRtcSessionClient({..., iceServers, forceTurn})`. The `ice` param is
   **attacker-influenceable input** (anyone who crafts a pairing link controls it), so the decoder MUST validate the
   decoded value into a well-formed `RTCIceServer[]` (sane URL schemes) and **fail closed** on malformed input — no
   loose cast into `RTCConfiguration`. The operator bakes their TURN into `clientUrl`'s query (like `relay`), which
   `toPairingUrl` preserves. **Security honesty:** unlike the secret (which lives ONLY in the `#` fragment, hidden from
   the page's HTTP host), the `ice` query param reaches the page's HTTP host (access logs / referrer) AND appears in the
   QR, URL bar, and browser history — it is NOT secret material and never goes to the RELAY, but it is NOT
   fragment-protected. Acceptable for user-supplied TURN shared with a trusted device; long-lived TURN credentials
   should use short-lived TURN REST tokens. (A page-deployment-config home — meta tag / same-origin fetch — is the
   cleaner place for STATIC long-lived credentials; deferred as a later-E nicety, out of E1 scope.) Absent ⇒
   host-candidate-only (unchanged behavior). Parser + client unit tests, incl. a malformed-`ice` fail-closed case.
3. **Docs + verify.** Document `transports.webrtc.options.iceServers`/`forceTurn` (host) and the `ice`/`forceTurn` query
   params (browser page) in the webrtc + web-ui SPECs. harness:scan + full typecheck + changeset.

## Affected Files

- `agent-cli/src/remote-control/index.ts` (read iceServers/forceTurn) + `remote-control-controller.ts`
  (`IRemoteControlControllerDeps` + `defaultCreateTransport` pass-through + forceTurn-needs-TURN validation) + tests
- `agent-web-ui/src/client/parse-remote-location.ts` (`ice`/`forceTurn` query) + `rtc-session-client.ts` (thread
  `forceTurn`) + `hooks/useWsSession.ts` (`useRtcSession` threads ice) + `components/RemoteClient.tsx` + tests
- `agent-transport-webrtc/docs/SPEC.md` + `agent-web-ui/docs/SPEC.md`
- changeset

## Decisions (resolved at GATE-APPROVAL round 1)

- **D1 — browser TURN via the pairing-URL `ice` query param** (consistent with the existing `relay=`; `toPairingUrl`
  provably preserves the query). **Security honesty:** the `ice` param reaches the page's HTTP host (logs/referrer) +
  the QR/URL/history — it is NOT fragment-protected like the secret, and NOT sent to the relay. OK for user-supplied
  TURN shared with a trusted device; long-lived creds → short-lived TURN REST tokens. Static-credential page-config
  (meta tag / same-origin fetch) is the cleaner home for long-lived creds — deferred (out of E1).
- **D2 — read `iceServers`/`forceTurn` in `agent-cli` (the composition root)** with a NEW **validating reader** that
  narrows the untyped `options.iceServers` (`unknown`) → a well-formed `RTCIceServer[]`, no `any`/cast, fail-closed on
  malformed input. The string-only `readWebrtcOption` cannot be reused for a structured value. **Rationale = LAYERING**
  (not "no schema change"): `agent-framework`'s config layer is deliberately domain-free; teaching it the webrtc option
  shape would push transport-domain knowledge up a layer (dependency-direction violation). The composition root already
  depends on `agent-transport-webrtc`, so it is the right owner.
- **D3 — fail closed on `forceTurn` without a TURN url**, at BOTH the host root and the browser client. Correct on the
  REMOTE-004 contract (`forceTurn` "requires a TURN server") AND the no-fallback rule: `forceTurn` + no relay candidate
  → zero ICE candidates → a SILENT never-connect; a config-time error surfaces it. Not a privacy regression (werift does
  not silently fall back to host candidates under `forceTurn`).
- **D4 — E1 = TURN only** (protocol-free, session-free, cleanest self-contained unit). E2 (signaling abuse) is an
  orthogonal sibling sub-spec. Stage-E decomposition E1(TURN)/E2(abuse)/E3(TOFU)/E4(reconnect, on E3)/E5(co-drive
  attribution) is sound + correctly sequenced.

**Threat model note (unchanged by E1):** the parent design already treats signaling AND TURN as fully untrusted,
content-blind relays carrying only DTLS-encrypted traffic; REMOTE-005's DTLS-fingerprint channel binding still detects
a MITM. An attacker who could inject a malicious `ice=` already controls the rendezvous+secret in the same link (they
already own the pairing). The only genuinely new surface is parsing attacker-influenced JSON → covered by the D2/step-2
fail-closed validators.

## Test Plan

RED→GREEN. **Host:** the controller passes configured `iceServers`/`forceTurn` into the transport (via the
`createTransport` seam); `forceTurn` with no TURN url fails closed. **Host validator fail-closed (D2):**
`readIceServers` rejects a malformed `transports.webrtc.options.iceServers` (wrong shape, or a bad/unsupported URL
scheme) with a clear error — no silent partial config, no cast. **Browser:** `parseRemoteClientLocation` reads the
`ice`/`forceTurn` query (round-trip a `toPairingUrl` link); `createRtcSessionClient`/`useRtcSession` thread `iceServers`
into the peer (fake `createPeer` asserts the config); `forceTurn` with no TURN fails closed. **Browser decoder
fail-closed (D1/step-2):** `parseRemoteClientLocation` fails closed on a malformed / bad-scheme decoded `ice` param —
the exact attacker-influenced surface, never a loose cast into `RTCConfiguration`. Absent ICE ⇒ unchanged
(host-candidate) behavior. harness:scan + full typecheck + changeset.

## Evidence Log

- 2026-07-11 GATE-DRAFT — authored from the Stage-E grounding Explore. Verified: both `RTCPeerConnection` sinks already
  accept + consume `iceServers`/`forceTurn` (`webrtc-transport.ts:18,24,74-77`; `rtc-session-client.ts:48,122`); only
  the config-read + threading layers are missing on both peers; `transports.webrtc.options` is an untyped bag read the
  same way for `relayUrl`/`clientUrl` (no schema change needed); no TURN/iceServers tests exist yet; existing
  injection-seam harnesses (`createTransport` controller seam, `createPeer` browser-client seam) are the natural test
  homes. E1 is protocol-free + session-free — the cleanest first Stage-E piece. Pending proposal-reviewer ENDORSE.
- 2026-07-11 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction correct + well-grounded; all 4
  recommendations APPROVED as D1–D4; every premise TRUE against source). Two required refinements folded in: **D2** —
  re-grounded the config-read placement on LAYERING (agent-framework config must stay domain-free), NOT "no schema
  change" (a discounted diff-size argument), AND committed to a dedicated **validating reader** that narrows
  `unknown`→`RTCIceServer[]` (no `any`/cast, fail-closed) since `iceServers` is structured and the string-only reader
  cannot be reused; **D1/step-2** — sharpened the security honesty (the `ice` query reaches the page host/QR/logs,
  unlike the fragment-protected secret) + required the browser `ice`-param decoder to validate attacker-influenced input
  and fail closed. Confirmed threading TURN weakens no REMOTE-005 channel-binding / REMOTE-004 forceTurn property
  (signaling+TURN already untrusted in the threat model). Re-review → round 2.
- 2026-07-11 GATE-APPROVAL round 2 — proposal-reviewer **REVISE**. Confirmed both round-1 refinements landed in prose
  (D2 LAYERING re-grounding + validating reader, no `any`/cast; D1/step-2 query-vs-fragment security honesty + validate
  attacker-influenced `ice`; the "no schema change" diff-size framing is disowned in D2 + step 1). One remaining
  Solution↔Test-Plan inconsistency: the new fail-closed VALIDATORS (host `readIceServers`, browser `ice`-decoder) — the
  exact new attacker-facing surface — were promised in the Solution but not in the canonical Test Plan. Added both to
  the Test Plan: host `readIceServers` rejects a malformed/bad-scheme value fail-closed; browser
  `parseRemoteClientLocation` fails closed on a malformed/bad-scheme decoded `ice` param (+ browser
  `forceTurn`-without-TURN fail-closed). Re-review → round 3.
- 2026-07-11 GATE-APPROVAL round 3 — proposal-reviewer **ENDORSE**. Both round-2 Test-Plan additions verified present
  (host `readIceServers` malformed/bad-scheme fail-closed; browser `parseRemoteClientLocation` malformed/bad-scheme
  `ice` fail-closed) + both `forceTurn`-without-TURN cases; no symbol drift, uniform no-cast/fail-closed language across
  D1/D2/Solution/Test-Plan, "no schema change" stays disowned, threat-model note now covers a tested surface.
  **GATE-APPROVAL cleared** → status in-progress, spec to active, implement on an `origin/develop`-based branch, Step 1
  (host validating reader → transport) first.

## Tasks

- [x] Step 1 — host: `readIceServers` (validating `unknown`→`RTCIceServer[]`, no cast, fail-closed) + `readForceTurn` in
      `agent-cli/src/remote-control/index.ts` + `IRemoteControlControllerDeps`; `defaultCreateTransport` passes
      `iceServers`/`forceTurn`; `forceTurn`-needs-TURN validation fails closed. Controller + reader unit tests
      (incl. malformed-value + forceTurn-without-TURN fail-closed).
- [x] Step 2 — browser: extend `IRemoteClientLocation` + `parseRemoteClientLocation` with a validating `ice` decoder
      (base64url JSON → `RTCIceServer[]`, fail-closed) + `forceTurn`; thread through `RemoteClient` → `useRtcSession` →
      `createRtcSessionClient`. Parser + client unit tests (incl. malformed-`ice` + forceTurn-without-TURN fail-closed).
- [x] Step 3 — docs (webrtc + web-ui SPECs) + changeset + verify (harness:scan + full typecheck).
- 2026-07-11 GATE-BUILD — implemented on `feat/remote-010-turn-fallback` (off origin/develop), all 3 steps. Step 1
  (host): `parseIceServers` validator (unknown→IIceServer[], no cast, fail-closed on malformed/bad-scheme) + hasTurnServer
  in agent-cli; readIceServers/readForceTurn deps + defaultCreateTransport pass-through + forceTurn⇒TURN fail-closed;
  widened IWebRtcTransportOptions.iceServers (+werift loader) for TURN username/credential + array urls. Step 2
  (browser): parse-ice-servers.ts browser decoder (base64url→JSON→validate, fail-closed) + parseRemoteClientLocation
  reads ice/forceTurn query + createRtcSessionClient forceTurn→iceTransportPolicy:'relay' + useRtcSession threads them.
  Step 3: SPECs + changeset. Verify: agent-web-ui 48, agent-cli 190, agent-transport-webrtc 23; harness:scan 49/49;
  full-repo typecheck 0. Both fail-closed validators tested (host malformed + browser malformed/bad-scheme +
  forceTurn-without-TURN on both peers). Ready for implementation review + merge-verifier.
- 2026-07-11 GATE-REVIEW (implementation) — proposal-reviewer **REVISE→fixed** (browser side ENDORSED; 2 host
  fail-OPEN defects at the werift boundary, both empirically confirmed + fixed). **Defect 1 (privacy):** werift's ICE
  gatherer derives relay-only from `iceTransportPolicy === 'relay'` and IGNORES a top-level `forceTurn` — so the host
  `forceTurn` was a silent no-op (host candidates still leak). Fixed: map `forceTurn` → `peerConfig.iceTransportPolicy =
'relay'`; werift-loader config type corrected (`iceTransportPolicy?:'all'|'relay'`, dropped the ignored `forceTurn`).
  **Defect 2 (silent drop):** werift's `parseIceServers` consumes only a single-string `turn:`/`stun:` url and silently
  drops array `urls` + `turns:`/`stuns:` — the host validator accepted them → TURN configured-but-discarded → silent
  never-connect. Fixed: narrowed `IIceServer.urls` to a single string and the host `parseIceServers` REJECTS (fail-closed)
  array urls + `turns:`/`stuns:` (with a clear werift-limitation error); the browser decoder stays wider (native
  RTCPeerConnection supports those). Added a werift-level regression test (fake-werift seam captures the config:
  forceTurn→iceTransportPolicy:'relay', no top-level forceTurn emitted). Also fixed a non-blocking nit (browser base64url
  decoder now proper UTF-8 for non-ASCII creds). Verify: webrtc 24, cli 192, web-ui 48; harness:scan 49/49; full
  typecheck 0. Ready for re-review + merge.
