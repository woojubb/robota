# @robota-sdk/agent-transport/webrtc

WebRTC peer-to-peer transport for the Robota SDK (Node.js). `WebRtcTransport` carries an agent runtime
session over an `RTCDataChannel`, so a remote client can drive a live session directly, peer to
peer, without session content passing through a server. It reuses the transport-neutral session
bridge and wire protocol from `@robota-sdk/agent-transport`, the same ones the WebSocket transport
uses. The package also contains the building blocks for connecting one user's devices to each other
(the device mesh): peer discovery and signaling, device enrollment and a TURN relay.

## Installation

```bash
npm install @robota-sdk/agent-transport @robota-sdk/agent-remote-pairing ws bittorrent-dht multicast-dns nostr-tools node-datachannel
```

Requires Node.js 22.12 or later. The WebRTC implementation, `node-datachannel` (libdatachannel, a
native module), is an optional peer dependency loaded lazily. If it is not installed or has no
prebuilt binary for the platform, `start()` fails with an explicit `WebRTC transport unavailable`
error; there is no fallback implementation. The other libraries, `ws`, `bittorrent-dht`,
`multicast-dns` and `nostr-tools`, and `@robota-sdk/agent-remote-pairing` are optional peer dependencies
of the package, installed for this subpath only. `@robota-sdk/agent-transport` provides the
`IProtocolSession` type used below.

## Usage

```typescript
import { WebRtcTransport, WsSignalingClient } from '@robota-sdk/agent-transport/webrtc';
import { createIdentityContext } from '@robota-sdk/agent-remote-pairing';
import type { IProtocolSession } from '@robota-sdk/agent-transport';

declare const session: IProtocolSession; // e.g. a live interactive session
declare const pairingSecret: string; // shared with the remote client out of band

const signaling = new WsSignalingClient({
  url: 'wss://signaling.example.com',
  rendezvous: 'my-rendezvous-id',
  onError: (error) => console.error(error),
});

const transport = new WebRtcTransport({
  cryptoContext: createIdentityContext('my-product'), // the namespace the remote client also uses
  signaling,
  secret: pairingSecret,
  onPaired: () => console.log('remote client paired'),
  onPairingFailed: () => console.log('pairing failed; channel closed'),
});

transport.attach(session);
await transport.start(); // the host is the offerer: creates the peer and data channel, sends the offer
// ...
await transport.stop();
```

Admission is decided at construction. With `secret`, the data channel carries only pairing frames
until the pairing handshake from `@robota-sdk/agent-remote-pairing` accepts, bound to the DTLS
fingerprints of the connection; only then is the session exposed, and a mismatch or timeout closes
the channel. To run without pairing (for example over loopback in tests), pass
`{ open: true, openReason: '<why this is safe>' }` instead. The constructor throws when neither is
given, or when both are.

Signaling is an injected port (`ISignalingClient`) that only carries SDP offers/answers and ICE
candidates, never session content. `createInMemorySignalingPair()` wires two in-process clients
together for tests; `WsSignalingClient` joins a rendezvous on a WebSocket signaling relay.

## `WebRtcTransport` options

| Option                                                                   | Type                             | Description                                                                                                                       |
| ------------------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `cryptoContext`                                                          | `IIdentityContext`               | Required. The namespace both peers derive their pairing keys under (`createIdentityContext` from `agent-remote-pairing`).         |
| `signaling`                                                              | `ISignalingClient`               | Required. Exchanges SDP/ICE with the remote peer.                                                                                 |
| `secret`                                                                 | `string`                         | Pairing secret; gates the data channel until the pairing handshake accepts.                                                       |
| `open` / `openReason`                                                    | `boolean` / `string`             | Runs without a pairing gate; `openReason` must say why.                                                                           |
| `iceServers`                                                             | `readonly IIceServer[]`          | STUN/TURN servers. Omitted: host candidates only.                                                                                 |
| `forceTurn`                                                              | `boolean`                        | Restricts ICE to relay (TURN) candidates; needs a TURN server in `iceServers`.                                                    |
| `onPaired` / `onPairingFailed`                                           | callbacks                        | Called when pairing accepts (session exposed) or rejects/times out (channel closed).                                              |
| `reconnect`                                                              | `IHostReconnectConfig`           | With `secret`: admits either a first pairing (with device enrollment) or a pinned-device reconnect.                               |
| `connectionApproval`                                                     | `IConnectionApproval`            | With `secret`: asks an operator to approve each connection before it reaches the session.                                         |
| `localPeer`                                                              | `ILocalPeerProof`                | With `secret`: also requires a nonce issued at a guarded local rendezvous.                                                        |
| `resumeBridge` / `onDropped`                                             | `SessionResumeBridge` / callback | With `secret`: `resumeBridge` carries the paired session across channel drops; `onDropped` is called when a paired channel drops. |
| `role`                                                                   | `'drive'` / `'observe'`          | Most the connection may do. Default `drive`; contradictory with `resumeBridge`, which carries the role its host gave it.          |
| `onDeliveryError`                                                        | callback                         | Observes an outbound delivery failure before the channel is dropped.                                                              |
| `personalUsageReporter` / `usageReporter` / `storedSessionUsageReporter` | reporters                        | Host-owned usage read models, available to the peer only after admission.                                                         |

`start()` before `attach()` throws; `stop()` is safe to call more than once, and starting again
requires attaching again.

## Other exports

- Peers: `RtcPeer`, `RtcChannel` and `loadDataChannel`, one peer connection over `node-datachannel`.
- Enrollment: `dialEnrollment` and `listenForEnrollment` open the channel used to enroll a new
  device; they fail with `EnrollmentLinkError`.
- Admission frames: `localProofFrame` (the local-peer nonce) and `handoffGrantFrame` /
  `judgeHandoffGrant` (a signed cross-device hand-off grant, verified by a host-supplied verifier).
- Test doubles: `createInMemorySignalingPair`, `createInMemoryMeshRelayHub`, `createInMemoryItemNetwork`,
  `createInMemoryNostrHub`, `createInMemoryMdnsBus` and `createInMemoryMeshAddressCache` run the
  signaling, relay and discovery ports in one process.

## Device mesh

`DeviceMeshNode` connects one user's devices to each other, each admitted by the device handshake of
`@robota-sdk/agent-remote-pairing`. `new DeviceMeshNode(options)` takes `IDeviceMeshNodeOptions`:

| Option               | Description                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `cryptoContext`      | Required. `IIdentityContext` the handshake runs under.                                                                              |
| `identity`           | Required. This device's `IDeviceHandshakeIdentity`: certificates, keys and the lists in force.                                      |
| `sessionDescriptor`  | Required. This device's signed descriptor of the session it offers.                                                                 |
| `localPolicy`        | Required. The capabilities a peer may be asked for; an admission grants the intersection with the peer's certificate.               |
| `relay`              | Required. The `IMeshRelay` signaling carrier, for example a `DiscoveringMeshRelay`.                                                 |
| `operatorApprover`   | Asked before a peer may use a capability that needs approval. Absent: such capabilities are refused.                                |
| `iceServers`         | STUN/TURN servers. None is contacted unless one is configured here or a paired device advertises its relay.                         |
| `relays`             | `IDeviceMeshRelayOptions`: `advertised` (relays that peers advertise), `configured` (TURN servers), `relayOnly`, `credentialTtlMs`. |
| `relayServer`        | This device's own relay; told which devices it serves (`declarePeers`) whenever the lists in force change.                          |
| `fetchLatestLists`   | Before a remote admission, asks a signing-key holder for newer lists.                                                               |
| `onListsAdopted`     | Receives the newer verified lists a handshake adopted, for the caller to persist.                                                   |
| `connectTimeoutMs`   | From the first signal of an attempt to its admission. Default 20 s.                                                                 |
| `handshakeTimeoutMs` | Bound on the device handshake.                                                                                                      |

`start()` announces this device to every peer device the lists name. `refresh({ identity?, sessionDescriptor? })`
applies newer lists or a new descriptor from the next handshake on, and drops peers the lists no longer
name. `connect(deviceId, timeoutMs?)` resolves with an admitted `IDeviceMeshLink` (the existing one if there
is one); `link(deviceId)`, `roleFor(deviceId)`, `onLink(handler)` and `onRefusal(handler)` read the state;
`stop()` ends the node. Between two devices the one with the lower device id offers.

An `IDeviceMeshLink` carries `admission`, `channelBinding` and an `authority`, the `ConnectionAuthority` of
`@robota-sdk/agent-interface/session-mobility` that answers what the peer may do on this connection. It
sends and receives messages (`send`, `onMessage`), opens a channel of its own for one file transfer
(`openFileChannel`, `onFileChannel`) and reports its end (`onClose`, `close`).

Discovery and signaling for the mesh try what reveals least first. `startLanMeshRelay` builds a
`DiscoveringMeshRelay` over this device's direct signaling endpoint that looks for a peer in the address
cache, with mDNS (`MeshMdns`), then in public records (`MeshDht` over the stores from
`startMainlineDhtStore` or `createPkarrRelayStore`), and signals through public carriers
(`NostrMeshRelay`) before the self-hosted relay (`WsMeshRelayClient`). `DEFAULT_NOSTR_RELAYS` and
`DEFAULT_PKARR_RELAYS` are the default public relays. Every one of these only carries signals, so a stale
or planted address delays a connection and never admits one.

## Relay

When no direct path works, a relay moves datagrams and nothing more. The relay is a TURN server on one of
the user's own always-on devices, then a TURN server the user configured. With neither, a connection that
needs a relay is refused with `MeshRelayNeededError` (its `need` is `relay-only` or `no-direct-path`).

- `MeshTurnRelay.start(options)` runs the relay for a user's paired devices. `IMeshTurnRelayOptions`:
  `host` (default every IPv4 interface), `port` (default 3478; `0` picks a free one), `relayAddress`,
  `relayPorts` (`{ min, max }`), `quotas` (a partial `ITurnQuotas` over `DEFAULT_TURN_QUOTAS`),
  `allowPrivatePeers` (default `true`: relayed data may reach private and link-local ranges),
  `allowPeer`, `now` and `onError`. `endpoint` reports where it listens, `declarePeers(peers)` names the
  devices it serves (any other device's credentials stop working and its allocations close), and `close()`
  stops it.
- `meshRelayCredential` and `meshRelayIceServers` derive the short-lived credential a device presents to a
  peer's relay from their pairwise rendezvous (`DEFAULT_RELAY_CREDENTIAL_TTL_MS`, at most
  `MAX_RELAY_CREDENTIAL_TTL_MS`).
- `TurnServer.start(options)` is the TURN implementation underneath, over UDP. Its `ITurnServerOptions`
  add a required `authorize(username)` that returns who a username belongs to and its password (or
  `undefined` to refuse it), a `realm` of at most 4 bytes (default `r`) and `unauthenticatedLimits` (a
  partial `IUnauthenticatedLimits` over `DEFAULT_UNAUTHENTICATED_LIMITS`), which bound the answers given to
  requests nobody authenticated.

## Related packages

- [`@robota-sdk/agent-transport`](../README.md): the transport-neutral session
  bridge and wire protocol this transport carries.
- [`@robota-sdk/agent-remote-pairing`](../../agent-remote-pairing/README.md): the pairing handshake and
  DTLS-fingerprint channel binding the pairing gate uses.
- [`@robota-sdk/agent-transport/ws`](./ws.md): the WebSocket transport for
  the same protocol.
- The browser peer that answers this transport's offer is the remote client in
  [`apps/agent-web`](../../../apps/agent-web/docs/SPEC.md) (`src/remote-client`).

For how the agent runtime CLI uses this for remote control and connecting your own devices, see the
[devices and remote access guide](../../../content/guide/devices-and-remote.md). See
[SPEC.md](./SPEC.md) for the subpath contract.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../../LICENSE) or a [commercial license](../../../COMMERCIAL.md). See [LICENSING.md](../../../LICENSING.md).
