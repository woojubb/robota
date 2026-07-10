# @robota-sdk/agent-remote-pairing

Isomorphic pairing + DTLS-fingerprint **channel binding** for Robota P2P remote-control (REMOTE-001, Stage B3).

A host proves a connecting remote holds a single-use pairing secret and binds that proof to the actual DTLS
channel each peer observes — defeating a MITM signaling relay. **WebCrypto only**, zero workspace deps, no `node:`
imports — the same module runs on the Node host and the Stage-D browser remote client.

> No user-facing enable path here (that is Stage B4). This package ships the pairing primitives + handshake.

## Why not SPAKE2?

The parent design specified SPAKE2. A PAKE exists to protect a **low-entropy** secret (a typed PIN) from
brute-force. The pairing secret here is transferred **machine-to-machine via QR / deep link**, so it is
**high-entropy (256-bit)** — a PAKE is unnecessary. Instead, a **directional, nonce-bound HMAC key-confirmation
bound to the DTLS fingerprints** authenticates the peer and detects a MITM relay, using only audited WebCrypto
primitives (no hand-rolled curve math).

## Usage

```ts
import {
  generatePairingSecret,
  toPairingUrl,
  startPairingHandshake,
  extractDtlsFingerprint,
} from '@robota-sdk/agent-remote-pairing';

// Host: create the secret + a pairing link (secret lives in the URL fragment, never sent to a server).
const pairing = generatePairingSecret();
const link = toPairingUrl('https://remote.example/app', pairing);

// After the WebRTC data channel is open, both peers run the handshake (initiator ≡ WebRTC offerer):
const handshake = startPairingHandshake({
  secret: pairing.secret,
  role: 'initiator',
  localFingerprint: extractDtlsFingerprint(localSdp),
  remoteFingerprint: extractDtlsFingerprint(remoteSdp), // the SDP werift verified
  send: (frame) => channel.send(JSON.stringify(frame)),
});
channel.onMessage((raw) => handshake.onFrame(JSON.parse(raw)));

const { sessionKey } = await handshake.result; // throws on MITM / mismatch / timeout — do NOT expose the session unless this resolves
```

See [`SPEC.md`](./SPEC.md) for the full contract + security model.
