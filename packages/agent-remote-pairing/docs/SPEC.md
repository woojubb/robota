# agent-remote-pairing Specification

## Scope

Isomorphic pairing + DTLS-fingerprint **channel binding** for REMOTE-001 P2P remote-control (Stage B3). Lets a
host prove that a connecting remote holds a single-use pairing secret AND binds that proof to the **actual** DTLS
channel each peer observes — defeating a MITM signaling relay. WebCrypto only; the same module runs on the Node
host (`agent-cli`) and the Stage-D browser remote client.

## Boundaries

- Does NOT open or own the WebRTC connection or signaling — it consumes DTLS fingerprints (from SDP) + a data
  channel `send`, supplied by the caller (`agent-transport-webrtc` on the host; the browser client in Stage D).
- Does NOT wire an enable path — no `/remote-control`, no session exposure. That is Stage B4.
- **Zero workspace dependencies; no `node:` imports; no werift.** Uses only `globalThis.crypto` + standard web
  APIs so it is reusable unchanged in a browser.

## Security model

A **high-entropy (256-bit) single-use** pairing secret is transferred machine-to-machine (QR / deep link). Because
it is high-entropy, a PAKE (SPAKE2) — which exists only to protect a LOW-entropy secret from brute-force — is
unnecessary (this **overrides** the parent design's SPAKE2 choice; see REMOTE-005). Authentication + MITM-relay
detection is a **directional, nonce-bound HMAC key-confirmation** bound to both DTLS fingerprints:

- `k = HKDF(secret, salt="robota-remote-pairing/v1", info="confirm")`; a distinct `info="session"` derives a
  Stage-E session key (domain-separated).
- Each peer sends `HMAC(k, LABEL[selfRole] ‖ nonceInitiator ‖ nonceResponder ‖ sortedPair(localFp, remoteFp))`
  and expects the value under `LABEL[peerRole]` (`initiator ≡ WebRTC offerer`, `LABEL_INITIATOR ≠ LABEL_RESPONDER`).
- **Reflection-safe:** sent ≠ expected, so a secretless relay cannot echo a peer its own confirmation.
- **Replay-safe:** fresh nonces are folded into every transcript.
- **MITM-detecting:** werift's `verifyRemoteCertificateFingerprint` forces a relay's advertised fingerprint to
  match its own cert, so the two honest peers observe different `sortedPair`s → the confirmation fails → abort.

## Public API Surface

| Export                      | Kind     | Description                                                                                           |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `generatePairingSecret`     | function | Fresh 256-bit secret + 128-bit rendezvous (base64url).                                                |
| `generateNonce`             | function | Fresh per-handshake nonce.                                                                            |
| `toPairingUrl`              | function | Encode `{ rendezvous, secret }` into a URL **fragment**.                                              |
| `parsePairingUrl`           | function | Read `{ rendezvous, secret }` from a pairing URL fragment.                                            |
| `extractDtlsFingerprint`    | function | Parse the `a=fingerprint` value from an SDP (throws if absent).                                       |
| `deriveSessionKey`          | function | HKDF a domain-separated session key (Stage-E use).                                                    |
| `computeConfirmations`      | function | This peer's outgoing + expected-peer directional confirmations.                                       |
| `verifyPeerConfirmation`    | function | Isomorphic timing-safe (double-HMAC) equality of two confirmations.                                   |
| `startPairingHandshake`     | function | Drive the confirmation exchange; resolves accept-with-session-key, hard-rejects on mismatch/timeout.  |
| `generateIdentityKeyPair`   | function | ECDSA-P256 identity keypair (REMOTE-012 E3); `extractable:false` for the device, `true` for the host. |
| `exportPublicKey`           | function | Export a public key as base64url SPKI — the value the counterpart pins.                               |
| `importPublicKey`           | function | Import a base64url SPKI public key for verify.                                                        |
| `exportKeyPairJwk`          | function | Host-only: export an extractable keypair to JWKs (0600 on-disk file).                                 |
| `importKeyPairJwk`          | function | Host-only: reload a keypair from persisted JWKs.                                                      |
| `deriveIdentityId`          | function | Stable non-secret id = base64url `SHA-256(SPKI)` (deviceId / hostIdentityId).                         |
| `signChallenge`             | function | Sign the channel-bound reconnect transcript (E3).                                                     |
| `verifyChallenge`           | function | Verify a counterpart's reconnect signature against its pinned public key (fail-closed).               |
| `startDeviceReconnect`      | function | Device-side mutual reconnect controller; verifies the host before accept.                             |
| `startHostReconnect`        | function | Host-side mutual reconnect controller; verifies the device before accept.                             |
| `deriveReconnectSeed`       | function | HKDF a per-device reconnect seed from the pairing `sessionKey` (REMOTE-013 E4).                       |
| `deriveReconnectRendezvous` | function | HKDF a fresh reconnect rendezvous id from `(seed, counter)` — single-use room per reconnect (E4).     |
| `generateUserRootKeyPair`   | function | SEC-011: the USER's root ECDSA keypair — one per person, not per machine.                             |
| `deriveUserId`              | function | SEC-011: stable `SHA-256(SPKI)` id of a user root.                                                    |
| `issueDeviceCertificate`    | function | SEC-011: sign a device key into this user's set. Same root ⇒ same user.                               |
| `verifyDeviceCertificate`   | function | SEC-011: check a certificate against an expected user, now — signature first, then the signed fields. |
| `verifyDevicePossession`    | function | SEC-011: confirm the presenter HOLDS the device key its certificate names.                            |
| `issueHandoffGrant`         | function | SEC-011: authorize ONE transfer, to ONE destination, over ONE channel.                                |
| `verifyHandoffGrant`        | function | SEC-011: verify a grant against this destination, transfer and channel.                               |

### SEC-011 — same USER, across two computers (#1812)

`device-identity.ts` proves possession of a **machine's** key; `ITrustedDeviceRecord` records that a
machine was enrolled somewhere; a completed WebRTC connection proves two endpoints negotiated a
channel. None says **whose** machine, and a hand-off must not move a session to someone else's
device.

**Why the proof travels with the destination.** Transitive trust — "the source has both devices in
its store, so they are one user" — inverts the direction of the proof: the list lives on the machine
making the claim, so a mistaken or compromised source can assert any destination is its user's while
the destination presents nothing. That is an authorization list wearing an authentication's clothes.

So the user holds one **root keypair** that signs each device's identity key. A device proves
same-user by presenting that certificate AND demonstrating possession of the device private key —
two separate calls, because a certificate is a public document and proves nothing about who is
holding it.

**The grant binds one transfer.** A same-user proof reused for a second transfer is the failure
#1812 names, so every binding is INSIDE the signature: user, source and destination device ids,
hand-off id, session id, nonce, channel fingerprint, and expiry. A signature over a subset would
leave the omitted field attacker-editable while still verifying.

**Signaling stays a rendezvous.** The grant is minted by the source and verified by the destination
end to end, so a signaling server that reads every byte still cannot authorize a transfer.

**Trust levels stay distinct.** `same-user-different-host` must never satisfy a check that wanted
SEC-010's `same-user-same-host`, or a local admission could authorize a cross-device transfer.

### `/local` subpath — SEC-010 local-peer admission (node-only)

A SEPARATE entry point, not part of the surface above. The main entry is isomorphic (WebCrypto, no
Node built-ins) and runs in the browser remote client; this needs the filesystem, and a browser has
no local peers and no directory permissions to judge.

| Export                    | Kind     | Purpose                                                                                                  |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `admitLocalPeerDirectory` | function | Establish that a rendezvous directory is user-owned and mode 0700 — the evidence the kernel enforces.    |
| `admitLocalPeerSocket`    | function | The same, plus the socket path resolving INSIDE that directory.                                          |
| `refuseLocalPeer`         | function | Build a refusal in one place, so no call site can construct an admitted-looking result without evidence. |
| `RendezvousGrantLedger`   | class    | The single-use, time-bounded, revocable grants that carry the rendezvous proof onto the channel.         |
| `DEFAULT_GRANT_TTL_MS`    | const    | How long a grant stays admissible (30s — a channel handshake, not a session).                            |

**What this proves, and what it does not.** Reaching a socket inside a 0700 user-owned directory
means the peer is on this machine as this user, because the kernel refuses the traversal to anyone
else — the evidence is not an artifact the peer supplies, so there is nothing to copy. It does NOT
distinguish two processes of the same user; the boundary is the account.

**Why the grant ledger is part of the proof rather than a convenience.** The directory check
establishes the environment at the RENDEZVOUS, but the session's messages travel over a different
carrier. Without a binding, a peer could pass the kernel's check at the socket and then hand the
channel to somebody else, and the admission would still read `same-user-same-host` — the environment
proof would be true and useless. The ledger issues a nonce at the rendezvous that the channel's
pairing confirmation must present back.

Its lifetime rules are the security properties, not bookkeeping:

- **Single use.** A nonce honoured twice has become a copyable credential — the exact failure SEC-010
  exists to prevent. A presentation spends the value even when the presentation is then refused,
  so probing does not preserve it for a later real attempt.
- **Bounded window.** Admission expires, so a value left in a log or a crashed process is not a
  standing invitation.
- **Revocation is the entry.** `revokeRendezvous` ends admissibility for everything a departing
  session handed out.
- **Deterministic under concurrency.** Two peers presenting one nonce cannot both win; the loser is
  refused rather than queued, because a race resolved by timing is a decision nobody made.

A replay is reported as `replayed` rather than folded into `unknown`. The usual argument for merging
them — not telling a prober which values once existed — does not apply at this boundary: the only
party who can reach this rendezvous already passed the kernel's check as this user, and could read
the process's memory outright. An operator who cannot distinguish a replay from a slow peer cannot
act on either.

`SO_PEERCRED` would have been the more direct reading, and it is unavailable: Node exposes no
peer-credential accessor on a connected socket handle (measured). Building on it would have produced
a mechanism that compiles, passes a mocked test, and refuses every real peer.

## Type Ownership

| Type                                                                                                              | Location                 | Purpose                              |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------ |
| `IPairingSecret`, `IConfirmationInput`, `TPairingRole`                                                            | `src/pairing.ts`         | Pairing crypto contracts.            |
| `IPairingHandshakeOptions`, `IPairingResult`, `TPairingFrame`                                                     | `src/handshake.ts`       | Handshake protocol contracts.        |
| `IIdentityKeyPairJwk`, `IReconnectChallenge`                                                                      | `src/device-identity.ts` | E3 identity + challenge contracts.   |
| `IReconnectController`, `IReconnectResult`, `IDeviceReconnectOptions`, `IHostReconnectOptions`, `TReconnectFrame` | `src/reconnect.ts`       | Mutual reconnect protocol contracts. |

## Extension Points

The handshake is transport-agnostic (`send` + `onFrame`); Stage B4 wires it to the WebRTC data channel and
enforces accept-before-session-exposure. The `deriveSessionKey` output is the Stage-E TOFU/app-key seam.

## Error Taxonomy

Fail-closed: `extractDtlsFingerprint` throws on a missing fingerprint; the handshake **rejects** on
confirmation mismatch (`channel-confirmation mismatch (possible MITM relay)`) or timeout — never a silent pass.

## Test Strategy

`src/__tests__/pairing.test.ts`: secret entropy, fragment-only URL round-trip, fingerprint extraction (werift SDP
fixture), no-MITM accept, fingerprint-substitution MITM reject, **reflection-adversary reject**, wrong-secret
reject, replay reject, session-key domain separation. `src/__tests__/handshake.test.ts`: full handshake accept +
MITM/reflection/wrong-secret/timeout rejects over a relay harness. `src/__tests__/isomorphic.test.ts`: no `node:`
imports / no `timingSafeEqual` in shipped source. (The werift binding invariant — TC-09 — is asserted in
`agent-transport-webrtc` where werift is available.)
