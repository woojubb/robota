# @robota-sdk/agent-transport-webrtc

WebRTC peer-to-peer transport for the Robota SDK (Node.js). `WebRtcTransport` carries a Robota
session over an `RTCDataChannel`, so a remote client can drive a live session directly, peer to
peer, without session content passing through a server. It reuses the transport-neutral session
bridge and wire protocol from `@robota-sdk/agent-transport`, the same ones the WebSocket transport
uses. The package also contains the building blocks for connecting one user's devices to each other
(the device mesh): peer discovery and signaling, device enrollment and a TURN relay.

## Installation

```bash
npm install @robota-sdk/agent-transport-webrtc @robota-sdk/agent-transport node-datachannel
```

Requires Node.js 22 or later. The WebRTC implementation, `node-datachannel` (libdatachannel, a
native module), is an optional peer dependency loaded lazily. If it is not installed or has no
prebuilt binary for the platform, `start()` fails with an explicit `WebRTC transport unavailable`
error; there is no fallback implementation. `@robota-sdk/agent-transport` provides the
`IProtocolSession` type used below.

## Usage

```typescript
import { WebRtcTransport, WsSignalingClient } from '@robota-sdk/agent-transport-webrtc';
import type { IProtocolSession } from '@robota-sdk/agent-transport';

declare const session: IProtocolSession; // e.g. a live interactive session
declare const pairingSecret: string; // shared with the remote client out of band

const signaling = new WsSignalingClient({
  url: 'wss://signaling.example.com',
  rendezvous: 'my-rendezvous-id',
  onError: (error) => console.error(error),
});

const transport = new WebRtcTransport({
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
| `onDeliveryError`                                                        | callback                         | Observes an outbound delivery failure before the channel is dropped.                                                              |
| `personalUsageReporter` / `usageReporter` / `storedSessionUsageReporter` | reporters                        | Host-owned usage read models, available to the peer only after admission.                                                         |

`start()` before `attach()` throws; `stop()` is safe to call more than once, and starting again
requires attaching again.

## Other exports

- Peers: `RtcPeer`, `RtcChannel` and `loadDataChannel`, one peer connection over `node-datachannel`.
- Device mesh: `DeviceMeshNode` connects one user's devices, admitted by the device handshake.
  Discovery and signaling for it: `DiscoveringMeshRelay`, `MeshMdns`, `MeshDht`, `NostrMeshRelay`,
  `WsMeshRelayClient`, `startLanMeshRelay`.
- Relay: `TurnServer` and `MeshTurnRelay`, a TURN relay one of the user's devices can run for its
  paired devices.
- Enrollment: `dialEnrollment` and `listenForEnrollment` open the channel used to enroll a new
  device.

## Related packages

- [`@robota-sdk/agent-transport`](../agent-transport/README.md): the transport-neutral session
  bridge and wire protocol this transport carries.
- [`@robota-sdk/agent-remote-pairing`](../agent-remote-pairing/README.md): the pairing handshake and
  DTLS-fingerprint channel binding the pairing gate uses.
- [`@robota-sdk/agent-transport-ws`](../agent-transport-ws/README.md): the WebSocket transport for
  the same protocol.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
