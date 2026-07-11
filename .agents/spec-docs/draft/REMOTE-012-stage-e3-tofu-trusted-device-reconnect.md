---
status: draft
type: SECURITY
tags: [auth, websocket, typescript]
---

# REMOTE-012: Stage E3 — TOFU trusted-device reconnect

## Problem

Every `/remote-control` connection today requires a fresh out-of-band pairing: the host mints a single-use
256-bit secret (`generatePairingSecret`, `pairing.ts:85`), shows it as a QR/link, the client pairs, and the
host operator explicitly accepts. That is correct for a **first** contact, but it forces a **returning,
already-trusted device** (the operator's own phone/laptop) to re-pair from scratch every single time —
scan a new QR and click accept on every reconnect. This is poor UX and it actively degrades security: an
operator trained to approve a pairing prompt on every routine reconnect will approve reflexively, which is
exactly when a real MITM/relay attempt slips through.

The pairing layer already derives, on a successful accept, a domain-separated `sessionKey`
(`deriveSessionKey`, `pairing.ts:155`; returned in `IPairingResult`, `handshake.ts:126`) — whose comment
says its "USE (TOFU bootstrap / app-layer key) is Stage E". **Today that `sessionKey` is discarded** at both
gate sites (`pairing-gate.ts:85`, `rtc-responder-gate.ts:62` — both `result.then(() => this.accept(), …)`
drop the value). There is no persistent notion of a trusted device: no host store, no device credential,
no reconnect-recognition path.

Goal: **Trust On First Use** — after a first pairing + explicit host accept, the host may remember that
device so a later reconnect from the same device is recognized and (per host policy) proceeds without a
full re-pair + accept, while an **unknown** device still goes through full first-use pairing and a
**revoked** device is refused fail-closed. A leak of the host's trust store must NOT let an attacker
impersonate a trusted device.

## Architecture Review

### Affected Scope

- `packages/agent-remote-pairing/` — new isomorphic (WebCrypto-only) `device-identity.ts`: device keypair
  generation, public-key export/import, and a channel-bound reconnect challenge/response
  (sign/verify over `challenge ‖ sortedPair(fingerprints)`). New `reconnect.ts` handshake analogous to
  `handshake.ts` but authenticating a stored device instead of a fresh secret. New exports in `index.ts`.
- `packages/agent-transport-webrtc/` — `PairingGate`/`WebRtcTransport`: (i) stop dropping `sessionKey`
  (`pairing-gate.ts:85`) — thread it into `onAccept?(result)`; (ii) at first-pair accept receive the
  device's public key over the authenticated channel and surface it to the host for storage; (iii) a
  reconnect path that runs the reconnect challenge/response against a host-supplied trusted device.
- `packages/agent-cli/src/remote-control/` — a host **trusted-device store** (JSON under `~/.robota`,
  mirroring `edit-checkpoint-store.ts` / `settings-io.ts`); wire register-on-accept + lookup-on-reconnect
  into `remote-control-controller.ts` (`onPaired`, `defaultCreateTransport`) via a new
  `IRemoteControlControllerDeps.trustedDeviceStore` seam; a `/remote-control` surface to list + revoke.
- `packages/agent-web-ui/src/client/` — a browser **device-credential store** (first browser-local storage
  in the package): a non-extractable ECDSA `CryptoKey` in IndexedDB, honoring the fragment-only-secret
  discipline (`parse-remote-location.ts:5-13`). `ResponderGate`/`rtc-session-client.ts` consume the accept
  `sessionKey`, register the keypair on first pair, and take the reconnect path when a credential exists.
- Tests across all four packages (unit + gate + e2e-oracle + controller + store).

### Alternatives Considered

1. **No TOFU — always re-pair (status quo).** Pro: zero new persistent state; simplest threat model. Con:
   the stated UX + reflexive-approval security problem is unaddressed; `sessionKey` stays dead code.
   Rejected: does not solve the problem.
2. **Symmetric device key** — on first pair, both sides derive `deviceKey = HKDF(sessionKey, "device")`;
   the device stores `deviceKey`, the host stores `deviceKey` (or its hash) keyed by device id; reconnect
   re-runs the existing directional-HMAC handshake with `deviceKey` as the secret. Pro: reuses the proven
   B3 handshake verbatim; small crypto surface. Con: the handshake is **symmetric** — to re-run it the host
   must store a value from which the shared HMAC key is derivable, i.e. a **replayable secret**. A leak of
   the host trust store then lets an attacker impersonate every trusted device (storing only a hash does
   NOT help — the symmetric handshake needs the key itself, not a commitment). Rejected: violates the
   "trust-store leak must not grant impersonation" requirement.
3. **(Chosen) Asymmetric device keypair (TOFU public-key pinning).** On first pair, the device generates a
   non-extractable ECDSA P-256 keypair (WebCrypto, isomorphic — same runtime story as `pairing.ts`), and
   sends its **public** key to the host over the already-authenticated (B3-confirmed) channel. The host
   stores `{ deviceId, publicKey, label, createdAt }` — **public keys only**. On reconnect the device sends
   its `deviceId` in the clear, the host issues a fresh random challenge, and the device signs
   `challenge ‖ sortedPair(localFingerprint, remoteFingerprint)` with its **private** key; the host verifies
   with the stored public key. Pro: a host trust-store leak reveals only public keys — an attacker cannot
   impersonate (no private key); the challenge is channel-bound (reuses B3's DTLS-fingerprint binding) so a
   MITM relay is still detected; the private key is non-extractable in IndexedDB (never in query/history,
   consistent with the fragment-only-secret discipline). Con: a new asymmetric crypto surface (keygen,
   sign/verify) + a distinct reconnect protocol vs. reusing the symmetric handshake. Accepted: it is the
   only option that satisfies the leak-resistance requirement, and WebCrypto ECDSA keeps it isomorphic.

### Decision

Take alternative 3 — **asymmetric device-keypair TOFU with public-key pinning**. First pairing stays exactly
as today (single-use secret + directional-HMAC accept + explicit host accept); on that accept we (a) start
consuming the derived `sessionKey` and (b) enroll the device by pinning its ECDSA public key in the host
trusted-device store. Reconnect authenticates by a fresh, channel-bound challenge signed by the device's
pinned private key — no re-pair, no fresh secret, still MITM-relay-resistant via the same
DTLS-fingerprint binding. Unknown device → fall through to full first-use pairing; revoked/absent public
key → refuse fail-closed. This is a **contract-boundary change** (a new reconnect wire protocol + a new
persistent host store + new browser storage): the design is validated for reachability by both peers
(werift host + browser client both speak WebCrypto ECDSA and the same fingerprint binding), capability
preservation (first-pair path unchanged; reconnect is purely additive), and an adversarial pass (leak,
replay across handshakes via the fresh challenge, cross-device forgery via public-key pinning, MITM via
channel binding, revocation).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the two accept-drop sites are siblings (`pairing-gate.ts:85` host, `rtc-responder-gate.ts:62` browser); BOTH are updated to consume `sessionKey` symmetrically. No third gate exists (verified by the surface map).
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

- **`agent-remote-pairing/device-identity.ts` (isomorphic, WebCrypto only):**
  - `generateDeviceKeyPair(): Promise<CryptoKeyPair>` — non-extractable ECDSA P-256 (browser stores it in
    IndexedDB; Node host never generates one — it only verifies).
  - `exportDevicePublicKey(key): Promise<string>` / `importDevicePublicKey(spki): Promise<CryptoKey>` —
    base64url SPKI, the value pinned by the host.
  - `deriveDeviceId(publicKeySpki): Promise<string>` — a stable id = base64url SHA-256 of the SPKI (a
    non-secret commitment; also what the client sends in the clear on reconnect).
  - `signReconnectChallenge(privateKey, { challenge, localFingerprint, remoteFingerprint }): Promise<string>`
    and `verifyReconnectChallenge(publicKey, signature, { challenge, localFingerprint, remoteFingerprint })`
    — sign/verify over `challenge ‖ sortedPair(fp,fp)` (reusing the B3 sorted-pair binding). `challenge` is a
    fresh 128-bit host nonce per reconnect.
- **`agent-remote-pairing/reconnect.ts`:** a small controller (mirroring `handshake.ts`) driving the
  reconnect frames `{ t:'rc-hello', deviceId }` → `{ t:'rc-challenge', nonce }` → `{ t:'rc-proof', sig }`,
  resolving accept only after `verifyReconnectChallenge` passes (host side) / after signing (device side),
  fail-closed on timeout/mismatch/unknown device.
- **Host gate + transport:** thread the resolved `IPairingResult`/`sessionKey` through `onAccept(result)`
  (`pairing-gate.ts:85`) → `WebRtcTransport` `onPaired(enrollment)` where `enrollment` carries the device's
  public key (received over the confirmed channel on first pair) or the reconnect outcome. Add a reconnect
  branch that, when the client opens with `rc-hello`, looks up the pinned device via an injected resolver
  and runs `reconnect.ts` instead of the fresh-secret handshake.
- **Host trusted-device store (`agent-cli/src/remote-control/trusted-device-store.ts`):** JSON file under
  `~/.robota` (via `getUserSettingsPath`/`userPaths` from `@robota-sdk/agent-framework`), keyed by
  `deviceId`, holding `{ publicKey, label, createdAt, lastSeenAt }`. API: `list()`, `get(id)`,
  `upsert(record)`, `revoke(id)`. Fail-closed: corrupt store throws (fail-fast, mirroring
  `SettingsParseError`); an unknown/revoked id yields no record → reconnect refused → client re-pairs.
  Wired via `IRemoteControlControllerDeps.trustedDeviceStore`; `/remote-control` gains `devices` (list) +
  `revoke <id>` verbs. Host policy: **enroll requires explicit accept** (unchanged first-pair accept);
  reconnect of a pinned device is auto-admitted unless policy requires re-accept (config flag, default
  auto — the trust decision was already made at first pair).
- **Browser device-credential store (`agent-web-ui/src/client/device-credential-store.ts`):** stores the
  non-extractable `CryptoKeyPair` in IndexedDB keyed by relay origin + host identity; never serializes the
  private key. On connect: if a credential exists for this host, take the reconnect path; else first-pair
  and enroll (persist the new keypair). `sessionKey` is consumed at `rtc-session-client.ts:96` accept.

## Affected Files

- `packages/agent-remote-pairing/src/device-identity.ts` (new)
- `packages/agent-remote-pairing/src/reconnect.ts` (new)
- `packages/agent-remote-pairing/src/index.ts`
- `packages/agent-remote-pairing/docs/SPEC.md`
- `packages/agent-transport-webrtc/src/pairing-gate.ts`
- `packages/agent-transport-webrtc/src/webrtc-transport.ts`
- `packages/agent-transport-webrtc/docs/SPEC.md`
- `packages/agent-cli/src/remote-control/trusted-device-store.ts` (new)
- `packages/agent-cli/src/remote-control/remote-control-controller.ts`
- `packages/agent-cli/src/remote-control/index.ts`
- `packages/agent-web-ui/src/client/device-credential-store.ts` (new)
- `packages/agent-web-ui/src/client/rtc-responder-gate.ts`
- `packages/agent-web-ui/src/client/rtc-session-client.ts`
- Tests in each package (see Test Plan).

## Completion Criteria

- [ ] TC-01: `signReconnectChallenge` + `verifyReconnectChallenge` round-trip: a signature over
      `{challenge, fpA, fpB}` verifies with the matching public key and FAILS for a different challenge, a
      different fingerprint pair, or a different keypair (isomorphic WebCrypto unit).
- [ ] TC-02: `deriveDeviceId` is stable for a given public key and differs across keypairs; `exportDevicePublicKey`→`importDevicePublicKey` round-trips.
- [ ] TC-03: `reconnect.ts` controller resolves accept only when the device signs a challenge verifiable by
      the pinned public key; it rejects (fail-closed) on timeout, a wrong signature, or an unknown deviceId.
- [ ] TC-04: Host trusted-device store: `upsert` then `get`/`list` returns the record; `revoke` removes it;
      a corrupt file throws (fail-fast); an absent id returns undefined. Round-trips through a temp `~/.robota`.
- [ ] TC-05: Host gate/transport: on first-pair accept the device public key is enrolled (store `upsert`
      called with a stable deviceId); on a subsequent `rc-hello` for that deviceId the reconnect path admits
      WITHOUT a fresh pairing accept; on `rc-hello` for an unknown/revoked id the reconnect is refused
      fail-closed (no session exposed).
- [ ] TC-06: Browser credential store: a generated keypair persists (IndexedDB fake) and is reloaded so the
      client takes the reconnect path on the second connect; the private key is non-extractable (export
      rejects); no secret/key value is ever placed in `location.search`/history.
- [ ] TC-07: End-to-end (Node responder oracle ↔ host gate): first pair enrolls; reconnect with the pinned
      keypair establishes a session with no re-accept; a tampered fingerprint (simulated MITM) fails the
      channel-bound challenge → reconnect refused.
- [ ] TC-08: `/remote-control devices` lists enrolled devices and `revoke <id>` removes one; a revoked
      device must re-pair. `pnpm harness:scan` + `pnpm typecheck` + affected package tests green.

## Test Plan

| TC-ID | Test Type            | Tool / Approach                                                                                   | Notes                                         |
| ----- | -------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| TC-01 | Unit (crypto)        | vitest — WebCrypto sign/verify round-trip + negative cases (challenge/fp/keypair mismatch)        | Isomorphic; runs under Node WebCrypto         |
| TC-02 | Unit (crypto)        | vitest — deviceId stability + SPKI export/import round-trip                                       |                                               |
| TC-03 | Unit (protocol)      | vitest — drive `reconnect.ts` frames with fakes; accept + fail-closed (timeout/bad-sig/unknown)   | Mirrors handshake.test.ts                     |
| TC-04 | Unit (store)         | vitest — temp HOME; upsert/get/list/revoke + corrupt-file throw + absent-id undefined             | Mirrors settings-io.test.ts / edit-checkpoint |
| TC-05 | Integration (gate)   | vitest — host gate with injected store: enroll-on-accept + reconnect-admit + unknown/revoked deny | Extends pairing-gate.test.ts                  |
| TC-06 | Unit (browser store) | vitest — fake IndexedDB; persist+reload keypair, non-extractable assertion, no-secret-in-search   | First agent-web-ui browser-local store        |
| TC-07 | E2E (oracle)         | vitest — Node responder as oracle vs host gate: first-pair→reconnect no-reaccept + MITM fp deny   | Extends pairing-e2e.test.ts                   |
| TC-08 | Integration + smoke  | vitest controller `devices`/`revoke`; `pnpm harness:scan` exit 0 + `pnpm typecheck`               | spec-public-surface + controller behavior     |

## Tasks

- [ ] `.agents/tasks/REMOTE-012.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
