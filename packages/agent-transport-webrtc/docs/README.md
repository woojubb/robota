# @robota-sdk/agent-transport-webrtc

WebRTC P2P transport for the Robota SDK. Carries an `IProtocolSession` (a full interactive session is a valid
one) over an `RTCDataChannel` so an external remote client can co-drive a live `agent-cli` session directly,
peer-to-peer — session content never routes through a server. It reuses the same transport-neutral session
bridge + wire protocol as the WebSocket transport (`createSessionMessageHandler` from `@robota-sdk/agent-transport`).
Host-injected personal/current/stored-session usage reporters follow the admitted direct, paired, and
reconnecting channel paths; reconnecting through `SessionResumeBridge` does not drop those capabilities.

> **Status:** `defaultEnabled: false` — nothing starts it automatically. Admission is decided at construction:
> with a pairing `secret` the data channel is pairing-gated (the session is exposed only after the pairing
> handshake accepts, bound to the DTLS fingerprints); without one the constructor throws unless the caller passes
> `open: true` with a written `openReason`. `agent-cli` uses it for `/remote-control`: its remote-control
> controller builds a pairing-gated transport over a `WsSignalingClient` and starts it when the command enables
> remote control.

## Usage

```ts
import { WebRtcTransport, createInMemorySignalingPair } from '@robota-sdk/agent-transport-webrtc';

const [hostSignaling] = createInMemorySignalingPair();
const transport = new WebRtcTransport({
  signaling: hostSignaling,
  secret: pairingSecret, // shared with the remote client; or `open: true, openReason: '…'` for loopback tests
});
transport.attach(session); // an IProtocolSession
await transport.start(); // offerer: opens the peer, data channel, and sends the SDP offer
// ...
await transport.stop();
```

`node-datachannel` (libdatachannel, native) is an **optional peer dependency**, loaded lazily. If it is not
installed or has no prebuilt binary for the platform, `start()` throws an explicit `WebRTC transport unavailable`
error — never a silent no-op and never a fallback to another implementation.

Signaling (SDP/ICE rendezvous) is injected via `ISignalingClient`: the in-memory pair for tests, or a client to
the `@robota-sdk/remote-signaling` relay in production.

See [`SPEC.md`](./SPEC.md) for the full contract.
