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

Note on `sessionKey`: the pairing layer derives a domain-separated `sessionKey` on accept
(`deriveSessionKey`, `pairing.ts:155`; `IPairingResult`, `handshake.ts:126`), currently discarded at both
gate sites (`pairing-gate.ts:85`, `rtc-responder-gate.ts:62`). Its comment reserves it for "Stage E". With
the asymmetric design below, E3's credential is the **device keypair**, and first-pair enrollment is already
protected by the B3-confirmed channel — so E3 does **not** need `sessionKey`. To avoid merely relocating dead
code, **E3 leaves `sessionKey` unconsumed and explicitly reserves it for E4** (REMOTE-013 session-resume,
which will key the resume stream). There is no persistent notion of a trusted device today: no host store,
no device credential, no reconnect-recognition path.

Goal: **Trust On First Use** — after a first pairing + explicit host accept, the host remembers that device
so a later reconnect from the same device is recognized and (per host policy) proceeds without a full re-pair

- accept, while an **unknown** device still goes through full first-use pairing and a **revoked** device is
  refused fail-closed. Two leak-resistance requirements: (a) a leak of the host's device-trust store must NOT
  let an attacker impersonate a trusted device (host stores device **public** keys only); (b) reconnect must
  stay **mutually** authenticated — the device must re-verify it is talking to the SAME host it first paired
  with, not just prove itself — so an attacker who controls signaling cannot route a reconnect to a rogue host
  and have the device auto-accept and co-drive it. (b) is what B3 first-pair already guarantees mutually;
  reconnect must not silently downgrade it.

## Architecture Review

### Affected Scope

- `packages/agent-remote-pairing/` — new isomorphic (WebCrypto-only) `device-identity.ts`: ECDSA-P256
  keypair generation (used for BOTH a device keypair and a host identity keypair), public-key export/import,
  a stable id (`SHA-256(SPKI)`), and channel-bound challenge sign/verify over `nonceHost ‖ nonceDevice ‖
sortedPair(fingerprints)`. New `reconnect.ts` **mutual** handshake analogous to `handshake.ts`: BOTH sides
  sign a challenge bound to both nonces + the DTLS-fingerprint pair, and each verifies the other against a
  pinned public key before accept — restoring B3's mutual property with pinned keys instead of a shared
  secret. New exports in `index.ts`.
- `packages/agent-transport-webrtc/` — `PairingGate`/`WebRtcTransport`: (i) thread the resolved
  `IPairingResult` into `onAccept?(result)` (`pairing-gate.ts:85`) so the accept can carry enrollment data
  (E3 does not consume `sessionKey`); (ii) at first-pair accept, **exchange identity public keys** over the
  B3-confirmed channel — the device sends its device public key, the host sends its host-identity public
  key — surfacing both to their stores; (iii) a reconnect path that runs the mutual `reconnect.ts` against
  a host-supplied trusted device (host signs with its identity key; verifies the device against the pinned
  device key).
- `packages/agent-cli/src/remote-control/` — (a) a **host identity keypair** persisted once under
  `~/.robota` (a `0600` JWK file — the host's own long-term key, like an SSH host key; the host needs the
  private key to sign, so it is extractable-and-file-persisted, distinct from the device store); (b) a host
  **trusted-device store** (JSON under `~/.robota`, fail-fast on corrupt — mirroring `settings-io.ts`,
  NOT the soft-failing `edit-checkpoint-store.ts`) holding device **public** keys only. Wire
  register-on-accept + lookup-on-reconnect into `remote-control-controller.ts` (`onPaired`,
  `defaultCreateTransport`) via new `IRemoteControlControllerDeps.trustedDeviceStore` + `hostIdentity` seams;
  a `/remote-control` surface to list + revoke devices.
- `packages/agent-web-ui/src/client/` — a browser **credential store** (first browser-local storage in the
  package): the device's non-extractable ECDSA `CryptoKey` **and the pinned host-identity public key**, in
  IndexedDB keyed by `relayOrigin + hostIdentityId` (now well-defined = `SHA-256(host SPKI)`), honoring the
  fragment-only-secret discipline (`parse-remote-location.ts:5-13`). `ResponderGate`/`rtc-session-client.ts`
  enroll the device keypair + pin the host key on first pair, and on reconnect **verify the host** against
  the pinned key before accepting.
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
3. **WebAuthn / passkeys.** The natural "device-bound public key" primitive. Rejected: WebAuthn signs over
   its own `clientDataJSON` (challenge + origin + type) and **cannot carry the DTLS-fingerprint channel
   binding** that is this design's MITM-relay defense; it is browser-only (no Node host/oracle parity for
   the mutual host-side signing); and it needs a stable RP-ID origin the fragment-only SPA does not have.
   Raw WebCrypto ECDSA is preferable precisely because it signs arbitrary channel-binding bytes and is
   isomorphic across the werift host, the Node oracle, and the browser.
4. **(Chosen) Asymmetric keypairs on BOTH sides (mutual TOFU public-key pinning).** On first pair, over the
   already-authenticated (B3-confirmed) channel, the device sends its ECDSA-P256 **public** key to the host
   and the host sends its **host-identity public** key to the device; each pins the other. The host stores
   `{ deviceId, publicKey, label, createdAt, lastSeenAt }` — device **public keys only**; the device stores
   its own non-extractable keypair + the pinned host public key. On reconnect BOTH sides sign a fresh
   challenge `nonceHost ‖ nonceDevice ‖ sortedPair(localFp, remoteFp)` and verify the other against the
   pinned key before accept (mutual, exactly as B3 is mutual). Pro: a host device-store leak reveals only
   public keys → no device impersonation; **mutual** auth means the device won't co-drive a rogue host
   (closes the host→device downgrade); the challenge is channel-bound (reuses B3's fingerprint binding) so a
   MITM relay is still detected; fresh per-side nonces prevent cross-handshake replay; the device private key
   is non-extractable in IndexedDB (never in query/history — fragment-only-secret discipline preserved). Con:
   an asymmetric crypto surface on both sides + a distinct mutual reconnect protocol; the host must persist
   its own identity private key on disk (a `0600` JWK, like an SSH host key). Accepted: the only option that
   satisfies BOTH the trust-store-leak requirement and the mutual-authentication requirement while staying
   isomorphic.

### Decision

Take alternative 4 — **mutual asymmetric TOFU with public-key pinning on both sides**. First pairing stays
exactly as today (single-use secret + directional-HMAC accept + explicit host accept); on that accept, over
the B3-confirmed channel, the device and host exchange and pin each other's identity public keys (E3 does
not consume the pairing `sessionKey` — reserved for E4). Reconnect authenticates **mutually** by fresh,
channel-bound challenges — the host verifies the device against the pinned device key AND the device
verifies the host against the pinned host key, each before exposing/accepting a session — no re-pair, no
fresh secret, still MITM-relay-resistant via the same DTLS-fingerprint binding. Unknown device → fall
through to full first-use pairing; revoked/absent key → refuse fail-closed. Device theft is the standard
TOFU residual risk; the compensating control is **revocation** (`/remote-control revoke <id>`) plus an
optional re-accept-on-reconnect policy flag. This is a **contract-boundary change** (a new mutual reconnect
wire protocol + two persistent host artifacts + new browser storage): validated for reachability by both
peers (werift host + browser client both speak WebCrypto ECDSA + the same fingerprint binding), capability
preservation (first-pair path unchanged; reconnect is additive), and an adversarial pass (device-store leak
→ public keys only; cross-handshake replay → fresh both-side nonces; cross-device forgery → per-device
pinned key; MITM relay → fingerprint binding; **rogue host → device verifies pinned host key, fail-closed**;
revocation; downgrade reconnect→first-pair grants nothing since first-pair still needs the QR secret +
explicit accept).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the two accept sites are siblings (`pairing-gate.ts:85` host, `rtc-responder-gate.ts:62` browser); BOTH are updated symmetrically to thread `IPairingResult` into `onAccept(result)` and to enroll/pin over the confirmed channel. No third gate exists (verified by the surface map).
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

- **`agent-remote-pairing/device-identity.ts` (isomorphic, WebCrypto only):**
  - `generateIdentityKeyPair(extractable): Promise<CryptoKeyPair>` — ECDSA P-256. The browser device calls it
    with `extractable:false` (IndexedDB, never exportable); the Node host calls it with `extractable:true`
    ONCE to persist its identity JWK to a `0600` file (a host must reload its own key across restarts, like
    an SSH host key).
  - `exportPublicKey(key): Promise<string>` / `importPublicKey(spki): Promise<CryptoKey>` — base64url SPKI,
    the value each side pins for the other.
  - `deriveIdentityId(publicKeySpki): Promise<string>` — stable id = base64url `SHA-256(SPKI)` (a non-secret
    commitment; the `deviceId` a client sends in the clear on reconnect, and the `hostIdentityId` the browser
    store keys on).
  - `signChallenge(privateKey, { nonceHost, nonceDevice, localFingerprint, remoteFingerprint })` and
    `verifyChallenge(publicKey, signature, { … })` — sign/verify over
    `nonceHost ‖ nonceDevice ‖ sortedPair(localFingerprint, remoteFingerprint)` (reusing the B3 sorted-pair
    binding). Both nonces are fresh 128-bit values, one issued by each side, so neither side's signature can
    be replayed across handshakes.
- **`agent-remote-pairing/reconnect.ts` — MUTUAL controller** (mirroring `handshake.ts`, fail-closed):
  - Frames: device→host `{ t:'rc-hello', deviceId, nonceDevice }`; host→device
    `{ t:'rc-host', nonceHost, sig }` (host's signature over the transcript, verifiable by the pinned host
    key); device→host `{ t:'rc-device', sig }` (device's signature over the same transcript).
  - Host resolves accept ONLY after `verifyChallenge(pinnedDeviceKey, deviceSig, …)` passes; the device
    resolves accept ONLY after `verifyChallenge(pinnedHostKey, hostSig, …)` passes. Either side rejects
    (fail-closed, channel closed) on timeout, signature mismatch, unknown deviceId, or an absent pinned host
    key. This is the mutual dual of B3 — same guarantee, pinned keys instead of a shared secret.
- **Host gate + transport:** thread the resolved `IPairingResult` through `onAccept(result)`
  (`pairing-gate.ts:85`) → `WebRtcTransport` `onPaired(enrollment)`. First-pair: after B3 accept, exchange
  identity public keys over the confirmed channel (device pubkey → host; host pubkey → device) and surface
  both. Reconnect: when the client opens with `rc-hello`, look up the pinned device via an injected resolver
  and run the mutual `reconnect.ts` (host signs with its identity key; verifies the device) instead of the
  fresh-secret handshake — exposing the session only on mutual accept. (E3 does not read `sessionKey`.)
- **Host identity keypair (`agent-cli/src/remote-control/host-identity.ts`):** load-or-create the host's
  ECDSA identity keypair as a `0600` JWK under `~/.robota` (via `userPaths`); generated once, reused across
  restarts; the host signs reconnect challenges with it and advertises its public key at first pair. Losing
  it forces trusted devices to re-pair (acceptable; equivalent to rotating an SSH host key).
- **Host trusted-device store (`agent-cli/src/remote-control/trusted-device-store.ts`):** JSON file under
  `~/.robota`, keyed by `deviceId`, holding `{ publicKey, label, createdAt, lastSeenAt }` — device **public
  keys only, no private material**. API: `list()`, `get(id)`, `upsert(record)`, `revoke(id)`. Fail-closed:
  corrupt store **throws** (fail-fast, mirroring `settings-io.ts` `SettingsParseError` — NOT the soft-failing
  checkpoint store; a truncated trust store must surface, never silently read as an empty allow-list). An
  unknown/revoked id yields no record → reconnect refused → client re-pairs. Wired via
  `IRemoteControlControllerDeps.trustedDeviceStore` + `hostIdentity`; `/remote-control` gains `devices`
  (list) + `revoke <id>` verbs. Policy: enroll requires the unchanged explicit first-pair accept; a pinned
  device's reconnect is auto-admitted (the trust decision was made at first pair) unless a
  `reacceptOnReconnect` policy flag is set.
- **Browser credential store (`agent-web-ui/src/client/device-credential-store.ts`):** IndexedDB keyed by
  `relayOrigin + hostIdentityId`, storing the device's non-extractable `CryptoKeyPair` **and the pinned host
  public key**; never serializes the private key (structured-clone of the non-extractable `CryptoKey`). On
  connect: if a credential exists for this host, take the mutual reconnect path and verify the host against
  the pinned key before accepting; else first-pair, then enroll (persist the new device keypair + pin the
  host key). Honors the fragment-only-secret discipline — no key value ever enters `location.search`/history.

## Affected Files

- `packages/agent-remote-pairing/src/device-identity.ts` (new)
- `packages/agent-remote-pairing/src/reconnect.ts` (new)
- `packages/agent-remote-pairing/src/index.ts`
- `packages/agent-remote-pairing/docs/SPEC.md`
- `packages/agent-transport-webrtc/src/pairing-gate.ts`
- `packages/agent-transport-webrtc/src/webrtc-transport.ts`
- `packages/agent-transport-webrtc/docs/SPEC.md`
- `packages/agent-cli/src/remote-control/host-identity.ts` (new)
- `packages/agent-cli/src/remote-control/trusted-device-store.ts` (new)
- `packages/agent-cli/src/remote-control/remote-control-controller.ts`
- `packages/agent-cli/src/remote-control/index.ts`
- `packages/agent-web-ui/src/client/device-credential-store.ts` (new)
- `packages/agent-web-ui/src/client/rtc-responder-gate.ts`
- `packages/agent-web-ui/src/client/rtc-session-client.ts`
- Tests in each package (see Test Plan).

## Completion Criteria

- [ ] TC-01: `signChallenge` + `verifyChallenge` round-trip: a signature over
      `{nonceHost, nonceDevice, fpA, fpB}` verifies with the matching public key and FAILS for a different
      nonce (either), a different fingerprint pair, or a different keypair (isomorphic WebCrypto unit).
- [ ] TC-02: `deriveIdentityId` is stable for a given public key and differs across keypairs;
      `exportPublicKey`→`importPublicKey` round-trips; a `SHA-256(SPKI)` id is second-preimage stable.
- [ ] TC-03: `reconnect.ts` MUTUAL controller resolves accept on each side ONLY after it verifies the
      counterpart's signature against the pinned key; it rejects (fail-closed) on timeout, a wrong device
      signature, a wrong/absent HOST signature (rogue host), or an unknown deviceId.
- [ ] TC-04: Host trusted-device store: `upsert` then `get`/`list` returns the record; `revoke` removes it;
      a corrupt file **throws** (fail-fast); an absent id returns undefined; the persisted JSON contains
      **only public keys — no private key material** (negative assertion). Round-trips through a temp
      `~/.robota`. Host identity keypair: load-or-create persists a `0600` JWK and reloads the same key.
- [ ] TC-05: Host gate/transport: on first-pair accept the device public key is enrolled (store `upsert`
      with a stable deviceId) AND the host advertises its identity public key; on a subsequent `rc-hello`
      for that deviceId the mutual reconnect admits WITHOUT a fresh pairing accept; on `rc-hello` for an
      unknown/revoked id the reconnect is refused fail-closed (no session exposed).
- [ ] TC-06: Browser credential store: a generated device keypair + pinned host key persist (IndexedDB fake)
      and reload so the client takes the reconnect path on the second connect and **verifies the host**; the
      private key is non-extractable (export rejects); no secret/key value is ever placed in
      `location.search`/history.
- [ ] TC-07: End-to-end (Node responder oracle ↔ host gate): first pair enrolls both keys; reconnect with
      the pinned keypairs establishes a session with no re-accept; a **rogue host** (wrong host identity key)
      makes the DEVICE refuse fail-closed; a tampered fingerprint (simulated MITM) fails the channel-bound
      challenge → reconnect refused; a captured `rc-device` proof replayed against a fresh challenge → reject.
- [ ] TC-08: `/remote-control devices` lists enrolled devices and `revoke <id>` removes one; a revoked
      device must re-pair. `pnpm harness:scan` + `pnpm typecheck` + affected package tests green.

## Test Plan

| TC-ID | Test Type            | Tool / Approach                                                                                                                | Notes                                     |
| ----- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| TC-01 | Unit (crypto)        | vitest — WebCrypto sign/verify round-trip + negatives (either-nonce / fp-pair / keypair mismatch)                              | Isomorphic; runs under Node WebCrypto     |
| TC-02 | Unit (crypto)        | vitest — identityId stability + SPKI export/import round-trip                                                                  |                                           |
| TC-03 | Unit (protocol)      | vitest — drive mutual `reconnect.ts` frames; both-side accept + fail-closed (timeout/bad device sig/rogue host sig/unknown)    | Mirrors handshake.test.ts                 |
| TC-04 | Unit (store)         | vitest — temp HOME; upsert/get/list/revoke + corrupt-throw + absent-undefined + no-private-material; host-identity load/reload | Mirrors settings-io.test.ts               |
| TC-05 | Integration (gate)   | vitest — host gate + injected store: enroll-on-accept (device+host keys) + reconnect-admit + unknown/revoked deny              | Extends pairing-gate.test.ts              |
| TC-06 | Unit (browser store) | vitest — fake IndexedDB; persist+reload device keypair + pinned host key, non-extractable, no-secret-in-search                 | First agent-web-ui local store            |
| TC-07 | E2E (oracle)         | vitest — Node oracle ↔ host gate: first-pair→reconnect no-reaccept; rogue-host deny; MITM-fp deny; proof-replay reject         | Extends pairing-e2e.test.ts               |
| TC-08 | Integration + smoke  | vitest controller `devices`/`revoke`; `pnpm harness:scan` exit 0 + `pnpm typecheck`                                            | spec-public-surface + controller behavior |

## Tasks

- [ ] `.agents/tasks/REMOTE-012.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
