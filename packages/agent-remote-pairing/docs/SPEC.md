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

| Export                                        | Kind     | Description                                                                                           |
| --------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `generatePairingSecret`                       | function | Fresh 256-bit secret + 128-bit rendezvous (base64url).                                                |
| `generateNonce`                               | function | Fresh per-handshake nonce.                                                                            |
| `toPairingUrl`                                | function | Encode `{ rendezvous, secret }` into a URL **fragment**.                                              |
| `parsePairingUrl`                             | function | Read `{ rendezvous, secret }` from a pairing URL fragment.                                            |
| `extractDtlsFingerprint`                      | function | Parse the `a=fingerprint` value from an SDP (throws if absent).                                       |
| `deriveSessionKey`                            | function | HKDF a domain-separated session key (Stage-E use).                                                    |
| `computeConfirmations`                        | function | This peer's outgoing + expected-peer directional confirmations.                                       |
| `verifyPeerConfirmation`                      | function | Isomorphic timing-safe (double-HMAC) equality of two confirmations.                                   |
| `startPairingHandshake`                       | function | Drive the confirmation exchange; resolves accept-with-session-key, hard-rejects on mismatch/timeout.  |
| `generateIdentityKeyPair`                     | function | ECDSA-P256 identity keypair (REMOTE-012 E3); `extractable:false` for the device, `true` for the host. |
| `exportPublicKey` / `importPublicKey`         | function | Base64url SPKI export/import — the value each side pins for the other.                                |
| `exportKeyPairJwk` / `importKeyPairJwk`       | function | Host-only JWK export/import for persisting its extractable identity key.                              |
| `deriveIdentityId`                            | function | Stable non-secret id = base64url `SHA-256(SPKI)` (deviceId / hostIdentityId).                         |
| `signChallenge` / `verifyChallenge`           | function | Sign/verify the channel-bound reconnect transcript (E3).                                              |
| `startDeviceReconnect` / `startHostReconnect` | function | Mutual reconnect controllers; each verifies the counterpart's pinned key before accept.               |

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
