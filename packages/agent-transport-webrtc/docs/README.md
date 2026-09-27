# @robota-sdk/agent-transport-webrtc

The WebRTC peer-to-peer transport for the Robota SDK (Node.js host side). It carries an
`IProtocolSession` (a full interactive session is one) over an `RTCDataChannel`, so a remote client can
drive a live session directly, peer to peer, without session content passing through a server. It reuses
the transport-neutral session bridge and wire protocol from `@robota-sdk/agent-transport`
(`createSessionMessageHandler`), the same ones the WebSocket transport uses. Host-injected usage
reporters stay available on every admitted path, including reconnects through `SessionResumeBridge`.

Nothing starts it automatically (`defaultEnabled: false`). Admission is decided at construction: with a
pairing `secret` the data channel carries only pairing frames until the handshake from
`@robota-sdk/agent-remote-pairing` accepts, bound to the connection's DTLS fingerprints; without one the
constructor throws unless the caller passes `open: true` with a written `openReason`. The Robota CLI's
`/remote-control` command builds a pairing-gated transport over a `WsSignalingClient` and starts it when
remote control is enabled.

The package also holds the building blocks for connecting one user's devices to each other: the device
mesh, peer discovery and signaling, device enrollment, and a TURN relay.

```ts
import { WebRtcTransport, createInMemorySignalingPair } from '@robota-sdk/agent-transport-webrtc';
import type { IProtocolSession } from '@robota-sdk/agent-transport';

declare const session: IProtocolSession;
declare const pairingSecret: string; // shared with the remote client out of band

const [hostSignaling] = createInMemorySignalingPair();
const transport = new WebRtcTransport({
  signaling: hostSignaling,
  secret: pairingSecret, // or `open: true, openReason: '…'` for loopback tests
});
transport.attach(session);
await transport.start(); // offerer: opens the peer, data channel, and sends the SDP offer
// ...
await transport.stop();
```

`node-datachannel` (libdatachannel, native) is an optional peer dependency, loaded lazily. If it is not
installed or has no prebuilt binary for the platform, `start()` throws an explicit
`WebRTC transport unavailable` error; there is no silent no-op and no fallback implementation.

Signaling (the SDP/ICE rendezvous) is injected through `ISignalingClient`: the in-memory pair for tests,
or `WsSignalingClient` joining a WebSocket signaling relay in production. The repository's relay is the
private `apps/remote-signaling` app, not an npm package; it sees only SDP and ICE, never session content.

For the user-facing picture — remote control from a browser and connecting your own devices — see the
[devices and remote access guide](../../../content/guide/devices-and-remote.md).

## Documents

- [SPEC.md](./SPEC.md) — package contract, admission and security model.
- [README](../README.md) — installation, options and the full export list.
