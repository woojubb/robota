---
status: done
type: INFRA
tags: [remote-control, webrtc, security, pairing, crypto]
parent: REMOTE-001
---

# REMOTE-005: Stage B3 — pairing secret + DTLS-fingerprint channel binding (crypto core)

Parent design: [REMOTE-001](../todo/REMOTE-001-webrtc-p2p-remote-control-design.md) (ENDORSED). Prior sub-stages
done: REMOTE-002 (A), REMOTE-003 (B1), REMOTE-004 (B2). This is **B3** — the pairing/authentication crypto that
lets the host prove a connecting remote holds the pairing secret AND binds that proof to the actual DTLS channel
(defeating a MITM signaling relay). **Still NO user-facing enable path** (that is B4); B3 ships the pairing
primitives + handshake, unit- and MITM-tested in isolation.

## Realization decision (owner-deferred research — the crux of this spec)

The ENDORSED parent design specified **SPAKE2** (a balanced PAKE) for pairing. A PAKE exists to stop **offline
brute-force of a LOW-entropy secret** (e.g. a 6-digit PIN a human types). **That premise does not hold here:** the
pairing secret is transferred **machine-to-machine via a QR code / deep link**, so it can be **high-entropy**
(≥128-bit random) — no human types it. With a high-entropy secret, offline brute-force is infeasible and **a PAKE
is unnecessary**. Against that, hand-rolling SPAKE2 (correct M/N nothing-up-my-sleeve points, transcript binding,
key-confirmation) is a well-known security footgun, and there is **no vetted, isomorphic, pure-JS SPAKE2** to adopt
(none in the tree; INFRA-028 needs pure-JS; the browser client in Stage D needs the same code).

**Recommendation (D1): replace SPAKE2 with a high-entropy secret + an HMAC key-confirmation bound to both DTLS
fingerprints, over WebCrypto.** This meets the exact threat model (authenticate the peer + detect a MITM relay)
with standard, audited primitives, is **isomorphic** (WebCrypto runs in Node 22 and browsers — one module reused
by host and the Stage-D browser client), and avoids the PAKE footgun. This **overrides an ENDORSED design
decision**, so it is called out explicitly for GATE-APPROVAL scrutiny; if the reviewer rejects the entropy
argument, the fallback is a vetted PAKE library (not a hand-roll).

**Verified facts grounding this:** werift SDP carries the DTLS fingerprint (`a=fingerprint:sha-256 …` — confirmed
in a generated offer), so each side already has both its local and the peer's fingerprint from the exchanged SDP;
`globalThis.crypto.subtle` (HMAC + HKDF via `deriveBits` + `getRandomValues`) is present in Node 22 and browsers.

**Load-bearing premise (must hold; asserted by test).** The fingerprint binding rests on werift's
`verifyRemoteCertificateFingerprint` (`werift@0.23.0` `webrtc/src/transport/dtls.js:256/269`): DTLS recomputes the
_negotiated_ remote certificate's fingerprint and fails the connection unless it matches the SDP-advertised
fingerprint (RFC 8122). So a MITM relay cannot present peer A a certificate whose fingerprint differs from what it
advertised to A — its advertised fingerprint is therefore necessarily different from the honest peer's, which is
exactly what the confirmation detects. The confirmation MUST be computed over the fingerprint from the SDP werift
actually consumed and verified (not an independent copy, and not before DTLS verifies the cert).

**Consequences of ≥128-bit machine-transfer (fold into the REMOTE-001 update):** (i) the parent design's "QR **or**
short human-typed code" option **collapses to QR / deep-link only** — a low-entropy typed code would reintroduce
the exact case a PAKE existed for and is no longer supported; (ii) the signaling rate-limit apparatus (REMOTE-004)
is **demoted from a load-bearing online-guess bound to defense-in-depth** (128-bit guessing is infeasible
regardless). DTLS already provides forward secrecy (ephemeral (EC)DHE) for session confidentiality, so dropping the
PAKE loses no FS property this model needs; the pairing secret only **authenticates**.

## Problem

There is no pairing/authentication. A malicious signaling relay can MITM the connection by substituting its own
DTLS fingerprint in the relayed SDP, terminating DTLS with each peer separately. Before the enable path (B4)
exposes a live session over the data channel, the two peers MUST (a) prove they share the pairing secret and (b)
bind that proof to the **actual** DTLS channel each observes, so a fingerprint substitution is detected and the
connection aborted. No such primitive exists today (grep: no SPAKE2/PAKE/pairing crypto anywhere).

## Solution (sub-sequenced, each commit green)

1. **New isomorphic package `@robota-sdk/agent-remote-pairing`** (WebCrypto only; no `node:`-only imports, no
   werift, no workspace deps beyond types — so both the Node host and the Stage-D browser client import it):
   - `generatePairingSecret(): { rendezvous: string; secret: string }` — `crypto.getRandomValues` → a ≥128-bit
     `secret` and a separate random `rendezvous` id, both URL-safe (base64url).
   - `toPairingUrl(baseUrl, { rendezvous, secret }): string` / `parsePairingUrl(url): { rendezvous, secret }` — the
     secret is carried in the **URL fragment** (`#…`), which is **never sent to the server** hosting the static
     remote page (only the rendezvous may be needed server-side); round-trippable.
   - `extractDtlsFingerprint(sdp: string): string` — parse the `a=fingerprint:<hash> <value>` line (pure string).
   - **Directional, nonce-bound confirmation (D2 — fixes the reflection break).** `k = HKDF(secret, salt,
info=DOMAIN_LABEL)`. Each peer has a role — **initiator** vs **responder** — agreed unambiguously (the
     WebRTC offerer is the initiator). Both peers exchange a fresh `getRandomValues` nonce (`nonceI`, `nonceR`)
     before/with the confirmation. Each peer **sends** `HMAC(k, LABEL[self.role] ‖ nonceI ‖ nonceR ‖
sortedPair(fpLocal, fpRemote))` and **expects** the value computed with `LABEL[peer.role]`, where
     `LABEL_INITIATOR ≠ LABEL_RESPONDER`. Because the value a peer expects to receive differs from the value it
     sends, **reflecting a peer's own confirmation fails**, and a relay without `k` cannot compute the
     counter-direction value. The nonces make confirmations non-replayable across handshakes even if a DTLS cert
     is ever reused. Sorting `fpLocal/fpRemote` keeps both honest peers' transcripts identical iff they observe
     the same channel; a MITM's substituted fingerprint makes the pairs differ → mismatch.
   - `verifyPeerConfirmation(expected, received): Promise<boolean>` — **isomorphic timing-safe** compare via
     double-HMAC (MAC both operands under a fresh ephemeral key with `subtle.sign`, compare results) or
     `subtle.verify` — NOT the `node:`-only `crypto.timingSafeEqual`.
2. **Pairing handshake helper** (also in the package; transport-agnostic) with an **API-enforced ordering
   contract** so B4 cannot expose a session before authentication: it returns a promise that resolves **accept**
   only after a valid counter-direction confirmation is verified, and **hard-rejects** (caller must close the
   channel) on mismatch/timeout — never a silent pass (no-fallback). The confirmation is bound to the
   **werift-verified** remote fingerprint (see Load-bearing premise), so the caller passes the fingerprint from
   the SDP werift consumed, after DTLS has verified the cert.
3. **NO enable path / NO wiring.** B3 does NOT wire the handshake into `WebRtcTransport`'s session exposure or add
   `/remote-control`; that is B4. B3 is exercised only by tests, including **(a)** a fingerprint-substitution MITM
   and **(b)** a **reflection/relay adversary that forwards each side's confirmation unchanged** — both MUST be
   rejected.
4. **Stage-D forward requirements (B3 owns the URL scheme; record for D4/D):** the browser page must
   `history.replaceState` to strip the secret fragment immediately after reading it, must be dependency-clean (no
   third-party script that can read `location.hash`), and `crypto.subtle` requires a **secure context**
   (HTTPS/localhost) — the static page must be HTTPS-hosted.
5. **Update the REMOTE-001 design** Stage B / security-model sections to record the SPAKE2→high-entropy-HMAC
   override (D1) with its rationale, so the design and the implementation agree.

## Affected Files

- `packages/agent-remote-pairing/**` (new isomorphic package: `pairing.ts` + handshake + `index.ts` + configs + `docs/SPEC.md` + `README.md`)
- `.agents/project-structure.md` + `scripts/harness/check-capability-placement.mjs` (register the new package)
- `.agents/spec-docs/todo/REMOTE-001-…` design (record the SPAKE2 override + updated security model)
- changeset

## Completion Criteria

- [x] TC-01: `generatePairingSecret` yields a ≥128-bit URL-safe secret + a distinct rendezvous id; two calls differ.
- [x] TC-02: `toPairingUrl`/`parsePairingUrl` round-trip; the secret is in the **fragment** (asserted: absent from
      path + query — it never reaches the page's server).
- [x] TC-03: `extractDtlsFingerprint` returns the `a=fingerprint` value from a real werift-generated SDP (fixture).
- [x] TC-04: no-MITM — both peers observe matching fingerprints; each verifies the peer's **counter-direction**
      confirmation (initiator accepts responder's, and vice versa) → accept.
- [x] TC-05: **fingerprint-substitution MITM** — one side's observed remote fingerprint is tampered (relay
      substitution) → the sorted pairs differ → the counter-direction confirmation fails → reject.
- [x] TC-06: **reflection/relay adversary (the round-1 break)** — an adversary WITHOUT the secret forwards each
      peer's own confirmation back to it unchanged; because sent ≠ expected (directional labels), **both peers
      reject**. (This is the test the round-1 symmetric construction would have failed.)
- [x] TC-07: wrong secret → different `k` → confirmations fail → reject.
- [x] TC-08: **replay** — a confirmation captured from one handshake is rejected in another (fresh nonces).
- [x] TC-09: **werift binding premise** — a Node↔Node DTLS connect with a **mismatched** advertised fingerprint is
      **failed by werift** (`verifyRemoteCertificateFingerprint`), confirming the binding rests on an enforced
      invariant, not an assumption.
- [x] TC-10: **isomorphic + timing-safe** — the module imports only WebCrypto/standard APIs (grep-assert: no
      `node:` imports; no `crypto.timingSafeEqual`), runs under `globalThis.crypto`, and the compare is double-HMAC
      / `subtle.verify`.
- [x] TC-11: **NO enable path** — no `/remote-control`, no pairing wired into `cli.ts` or `WebRtcTransport` session
      exposure (grep-asserted).
- [x] TC-12: `pnpm harness:scan` (+ capability-placement for the new package, deps, spec-public-surface) + the new
      suite + full-repo `pnpm typecheck` 0; changeset present.
- [x] TC-13: **session-key domain separation (D6)** — the HKDF-derived session key is length-correct and
      **byte-distinct** from the confirmation key `k` for the same secret (proves the distinct `info` is applied,
      not assumed).

## Test Plan

RED→GREEN. Pure crypto is deterministic given inputs: the MITM property is proven by computing both peers'
confirmations over their respective (matching vs tampered) fingerprint pairs and asserting accept/reject — no
werift/network needed. `extractDtlsFingerprint` uses a captured werift SDP fixture. harness
`capability-placement`/`deps`/`spec-public-surface`/`entry-point-only` green; changeset.

## Decisions (resolved at GATE-APPROVAL round 1)

- **D1 — SPAKE2 → high-entropy-secret + HMAC channel-binding: ENDORSED as sound.** The entropy argument holds (a
  PAKE only buys low-entropy-secret protection, which a ≥128-bit machine-transferred secret does not need); no
  residual PAKE property (FS, augmented/server-compromise, online-guess) is needed here. Fallback if ever
  reopened: a **vetted PAKE library**, never a hand-roll.
- **D2 — directional + nonce-bound confirmation (fixes the round-1 reflection break).** Initiator = WebRTC
  offerer; `LABEL_INITIATOR ≠ LABEL_RESPONDER`; both nonces folded into the HMAC transcript. Sent ≠ expected, so
  reflection fails and confirmations are non-replayable.
- **D3 — timing-safe compare is isomorphic** (double-HMAC / `subtle.verify`), NOT node-only `timingSafeEqual`.
- **D4 — standalone isomorphic package `@robota-sdk/agent-remote-pairing`** (zero workspace deps, WebCrypto only) —
  the Stage-D browser client must reuse it without dragging werift/node in (a subpath of `agent-transport-webrtc`
  would risk that). Mirrors the `agent-transport-protocol` extraction precedent.
- **D5 — bind to the werift-verified fingerprint** (from the SDP werift consumed, post-DTLS-verify); asserted by
  TC-09.
- **D6 — derive + expose a session key via HKDF** (distinct `info` from the confirmation key) but leave its USE to
  Stage E (TOFU bootstrap); B3 scope is pairing + channel-binding only.
- **D7 — secret = 256-bit** `getRandomValues`, base64url (comfortably ≥128-bit; rendezvous a separate 128-bit id).
- **D8 — HKDF salt + info pinned (interop determinism).** Fixed non-secret salt constant
  `"robota-remote-pairing/v1"` (bytes); `info = "confirm"` for the confirmation key `k`, `info = "session"` for the
  Stage-E session key — distinct `info` gives domain separation (TC-13). Host and browser MUST use the identical
  salt/info to derive matching keys.

## Open Questions (for GATE-APPROVAL)

None — all round-1 questions resolved into D1–D7 above.

## Tasks

- [x] Step 1 — new isomorphic `agent-remote-pairing` package: secret/rendezvous gen (256-bit), URL encode/parse (fragment secret), `extractDtlsFingerprint`, HKDF-derived confirmation + session keys, directional+nonce confirmation, double-HMAC timing-safe verify.
- [x] Step 2 — pairing handshake helper with API-enforced accept-before-expose ordering; hard-reject on mismatch/timeout (no silent pass); bind to werift-verified fingerprint.
- [x] Step 3 — tests: no-MITM (D2 directional), fingerprint-substitution MITM, **reflection adversary**, wrong-secret, replay, werift fingerprint-mismatch-fails-connect (TC-09), isomorphic+timing-safe, fragment-only-secret; werift SDP fixture.
- [x] Step 4 — register the package (project-structure + capability-placement allowlist); record the SPAKE2 override + short-code-retired + rate-limit-demoted in the REMOTE-001 design; changeset.
- [x] Step 5 — verify: no enable path (TC-11); harness:scan + typecheck + changeset.

## Evidence Log

- 2026-07-11 GATE-DRAFT — authored from the REMOTE-001 Stage B decomposition (B3), resolving the owner-deferred
  PAKE-realization research. Grounding verified: werift SDP carries `a=fingerprint:sha-256 …`; `crypto.subtle`
  (HMAC/HKDF/getRandomValues) is present in Node 22 + browsers; no SPAKE2/PAKE lib in the tree;
  `packages/agent-remote-client` is an unrelated HTTP/SSE proxy (not the pairing home). Recommends replacing SPAKE2
  with high-entropy-secret + HMAC DTLS-fingerprint binding (D1) — an explicit override of the ENDORSED design,
  flagged for scrutiny. Pending proposal-reviewer ENDORSE.
- 2026-07-11 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (D1 direction **verified cryptographically
  sound**: entropy argument correct, no residual PAKE property needed, DTLS provides FS; werift's
  `verifyRemoteCertificateFingerprint` confirmed as the enforced binding invariant). One **BLOCKING** flaw caught +
  fixed: the round-1 **symmetric** confirmation (both peers send the identical value) is **broken by a reflection
  attack** — a secretless relay echoes each peer's own confirmation back and both accept. Fixes folded in: (D2)
  **directional** confirmation (initiator=offerer, `LABEL_INITIATOR≠LABEL_RESPONDER`) + **fresh nonces** (anti-
  replay); (D3) **isomorphic** timing-safe compare (double-HMAC/`subtle.verify`, not node-only `timingSafeEqual`);
  (D5) bind to the **werift-verified** fingerprint + TC-09 asserting werift fails a mismatched connect; added a
  **reflection-adversary test** (TC-06) that the broken form would fail; (D6/D7) HKDF a session key for Stage E +
  256-bit secret; recorded that ≥128-bit machine-transfer **retires the short-typed-code option** and **demotes
  signaling rate-limiting to defense-in-depth**; Stage-D forward reqs (fragment-strip via `history.replaceState`,
  secure context, no third-party scripts). Re-review → round 2.
- 2026-07-11 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. The directional+nonce construction verified
  cryptographically sound against reflection (echo fails: expected≠sent), replay (fresh nonces in transcript),
  role-confusion (initiator≡offerer fixed by signaling; a two-leg relay is offerer-to-B/answerer-to-A, preserving
  honest roles), adaptive-nonce (no forgery without `k`), and two-leg fingerprint-substitution MITM (werift
  `verifyRemoteCertificateFingerprint` at `dtls.js:256/269/296/302` hard-fails a mismatched connect → sorted pairs
  differ). All premises code-verified; D1–D7 ↔ steps ↔ TCs consistent; Open Questions empty. Two non-blocking
  notes adopted: **D8** pins the HKDF salt (`"robota-remote-pairing/v1"`) + `info` (`"confirm"`/`"session"`) for
  host/browser interop, and **TC-13** enforces session-key domain separation (byte-distinct from `k`). Design
  APPROVED → implement. Spec → active.
- 2026-07-11 GATE-IMPLEMENT — B3 built per D1–D8. New isomorphic `@robota-sdk/agent-remote-pairing` (WebCrypto
  only, zero workspace deps): `pairing.ts` (secret/nonce/URL, `extractDtlsFingerprint`, HKDF confirm+session keys,
  directional+nonce `computeConfirmations`, double-HMAC `verifyPeerConfirmation`) + `handshake.ts`
  (`startPairingHandshake`, fail-closed accept-before-expose). Registered in project-structure +
  capability-placement; REMOTE-001 design security-model updated (SPAKE2 SUPERSEDED; short-code retired;
  rate-limit demoted). `forceTurn`-style byte handling uses an `ArrayBuffer` normalizer for TS-5.9 WebCrypto typing.
  - **Verification:** agent-remote-pairing **16** (pairing 9 incl. no-MITM/substitution-MITM/**reflection**/wrong-
    secret/replay/session-domain-sep + handshake 5 incl. MITM/reflection/timeout + isomorphic 2), and
    **TC-09** in agent-transport-webrtc (werift **fails a tampered-fingerprint connect** — the binding invariant;
    webrtc suite 12). `harness:scan` **49/49** (capability-placement scan-test 5); no enable path (TC-11 grep);
    full-repo `pnpm typecheck` 0; changeset added; lint 0 errors. → GATE-VERIFY.
- 2026-07-11 GATE-COMPLETE — PR #1091 CI fully green → merged to **develop** (`4c424109a`), then promoted
  **develop→main** via PR #1092 (`4eed9d927`). Both hops independently confirmed by the merge-verifier
  (PASS/PASS): all B3 paths present on `origin/main`, SPAKE2-SUPERSEDED note in the design, no unrelated code
  drift (22 files), CI green incl. `security audit`. B3 shipped. Spec `active → done` (`status: done`). Next:
  REMOTE-001 Stage B4 — the `/remote-control` command + registry wiring that FIRST exposes the enable path,
  which must (a) wire the B3 pairing handshake so no session is exposed pre-confirmation, (b) gate remote-origin
  commands using the B1 policy, and (c) close the B1-logged model-invocation submit side-channel via the
  untrusted-`TClientMessage`-surface audit. Then Stage D (remote browser client, reusing agent-remote-pairing) +
  Stage E (TOFU reconnect + TURN + co-drive).
