# @robota-sdk/agent-transport-webrtc

WebRTC P2P transport for the Robota SDK (REMOTE-001). Carries an `IInteractiveSession` over an `RTCDataChannel`
so an external remote client can co-drive a live `agent-cli` session directly, peer-to-peer — session content
never routes through a server. It reuses the same transport-neutral session bridge + wire protocol as the
WebSocket transport (`createWsHandler` from `@robota-sdk/agent-transport-protocol`).

> **Stage A status:** `defaultEnabled: false`, no pairing/auth, no `/remote-control` command, not registered in
> `agent-cli`. Exercised only by loopback tests. Pairing/auth + the enable path land in Stage B.

## Usage (loopback / test shape)

```ts
import { WebRtcTransport, createInMemorySignalingPair } from '@robota-sdk/agent-transport-webrtc';

const [hostSignaling] = createInMemorySignalingPair();
const transport = new WebRtcTransport({ signaling: hostSignaling });
transport.attach(session); // an IInteractiveSession
await transport.start(); // offerer: opens the peer, data channel, and sends the SDP offer
// ...
await transport.stop();
```

`werift` (pure-TS WebRTC) is an **optional peer dependency**, loaded lazily. If it is not installed, `start()`
throws an explicit `WebRTC transport unavailable — install … "werift"` error — never a silent no-op.

Signaling (SDP/ICE rendezvous) is injected via `ISignalingClient`: the in-memory pair for tests, or a client to
the `@robota-sdk/remote-signaling` relay in production.

See [`SPEC.md`](./SPEC.md) for the full contract.
