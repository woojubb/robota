# @robota-sdk/agent-remote-pairing

Pairing and DTLS-fingerprint channel binding for Robota's peer-to-peer remote control, plus the identity
primitives that let one user's devices recognise each other. A host uses it to prove that a connecting
peer holds a single-use pairing secret, and binds that proof to the actual DTLS channel each side
observes, so a signaling relay sitting in the middle is detected and the connection refused.

The main entry point uses only WebCrypto and standard web APIs, with no `node:` imports and no WebRTC
dependency, so the same code runs on the Node host and in the browser client. It never opens a
connection itself: the caller supplies the DTLS fingerprints and a way to send frames.

## Installation

```bash
npm install @robota-sdk/agent-remote-pairing
```

Requires Node.js 22.12 or later, or a browser with WebCrypto.

| Import path                              | Environment      | What it contains                                                                                         |
| ---------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-remote-pairing`       | browser and Node | Pairing secrets and links, the pairing handshake, reconnect, device identity, enrollment, frame decoders |
| `@robota-sdk/agent-remote-pairing/local` | Node only        | Local-peer admission: proving a peer is this user on this machine (needs the filesystem)                 |

## Usage

```ts
import {
  decodePairingFrame,
  extractDtlsFingerprint,
  generatePairingSecret,
  startPairingHandshake,
  toPairingUrl,
} from '@robota-sdk/agent-remote-pairing';

declare const localSdp: string; // this peer's SDP
declare const remoteSdp: string; // the SDP whose certificate the DTLS layer verified
declare const channel: {
  send(text: string): void;
  onMessage(handler: (raw: string) => void): void;
};

// Host: create the secret and a pairing link. The secret lives in the URL fragment, which a browser
// never sends to a server.
const pairing = generatePairingSecret();
const link = toPairingUrl('https://remote.example/app', pairing);

// Once the data channel is open, both peers run the handshake (the initiator is the WebRTC offerer).
const handshake = startPairingHandshake({
  secret: pairing.secret,
  role: 'initiator',
  localFingerprint: extractDtlsFingerprint(localSdp),
  remoteFingerprint: extractDtlsFingerprint(remoteSdp),
  send: (frame) => channel.send(JSON.stringify(frame)),
});

// Decode every inbound frame with this package's decoder and drop anything it refuses.
channel.onMessage((raw) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const decoded = decodePairingFrame(parsed);
  if (decoded.ok) handshake.onFrame(decoded.frame);
});

// Rejects on a relay in the middle, a wrong secret or a timeout. Expose the session only if it resolves.
const { sessionKey } = await handshake.result;
```

In practice you rarely call this directly: `WebRtcTransport` in
[`@robota-sdk/agent-transport-webrtc`](../agent-transport-webrtc/README.md) runs the host side when you
give it a `secret`, and the browser client in `@robota-sdk/agent-transport-webrtc-web` runs the
responder side.

### Why a keyed confirmation and not a PAKE

The pairing secret is 256 bits of randomness carried machine to machine (QR code or deep link), not a
PIN a person types. A PAKE such as SPAKE2 exists to protect a low-entropy secret from brute force, so it
is unnecessary here. Instead each side sends a directional, nonce-bound HMAC confirmation over both DTLS
fingerprints, using only standard WebCrypto primitives. A relay that terminated DTLS separately with each
peer makes the two sides see different fingerprint pairs, so the confirmations fail. An SDP must
advertise exactly one fingerprint, because a DTLS stack accepts a certificate matching any advertised
one.

## Other exports

- **Reconnect:** `generateIdentityKeyPair` and the related key helpers give each device a long-lived key.
  `startHostReconnect` / `startDeviceReconnect` let a previously paired device and host reconnect without
  a new pairing secret, each verifying the other's signature against the key it pinned; every reconnect
  meets at a fresh rendezvous from `deriveReconnectRendezvous`.
- **Same-user identity:** a chain of three keys. A master key derived from a recovery phrase
  (`generateRecoveryPhrase`, `deriveMasterKey`) certifies short-lived signing keys (`certifySigningKey`),
  which certify devices (`certifyDevice`) and issue signed device rosters and revocation lists.
  `verifyDeviceChain` checks a device against that chain.
- **Device handshake:** `startDeviceHandshake` admits two of one user's devices to each other over a
  channel bound to its DTLS fingerprints; `derivePairwiseSecret` and `derivePairRendezvous` give each
  pair of devices a private meeting point.
- **Enrollment:** `generateEnrollmentCode`, `startEnrollmentProof` and the related helpers add a new
  device with a one-time code, confirmed by both operators with a short string both devices show
  (`enrollmentSas`).
- **Hand-off grants:** `issueHandoffGrant` / `verifyHandoffGrant` authorize moving one session to one
  device of the same user.
- **Frame decoders:** `decodePairingFrame`, `decodeReconnectFrame`, `decodeEnrollFrame`,
  `decodeEnrollmentFrame`, `decodeDeviceHandshakeFrame`. Every frame received before authentication is
  decoded by one of these; each returns a result with a reason instead of throwing.

### `./local` (Node only)

`admitLocalPeerDirectory` and `admitLocalPeerSocket` admit a peer that reached a socket inside an
owner-only (mode `0700`) directory created with `ensureGuardedDirectory`: the operating system already
proved it is this user on this machine. `RendezvousGrantLedger` issues single-use, short-lived nonces at
that rendezvous, which the channel's pairing must present back, so the admission cannot be handed to
another connection.

## Related

- [devices and remote access guide](../../content/guide/devices-and-remote.md) — remote control and
  connecting your own devices from the Robota CLI.
- [docs/SPEC.md](docs/SPEC.md) — the security model, the identity chain and the pre-auth wire contract.
