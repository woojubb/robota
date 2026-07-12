# @robota-sdk/agent-transport-webrtc-web

The **browser** WebRTC transport peer for a robota session (REMOTE-009 Stage D) — the browser mirror of the
node-side host transport [`@robota-sdk/agent-transport-webrtc`](../agent-transport-webrtc). It answers the
host's WebRTC offer over a native `RTCPeerConnection`, runs the directional-HMAC pairing handshake as RESPONDER
behind a fail-closed gate, and co-drives the SAME session over an `RTCDataChannel`, reusing the shared session
reducer + view components from [`@robota-sdk/agent-transport-gui`](../agent-transport-gui).

> Private, browser-only, React 18+.

## What it owns

- `useRtcSession({relayUrl,rendezvous,secret})` — binds the shared reducer to the WebRTC client.
- `RemoteClient` — the Stage-D page root (reads the pairing URL, pairs, renders the session).
- `createRtcSessionClient` / `createRtcSignalingClient` / `parseRemoteClientLocation` — the RTC client stack.
- `TRtcConnectionStatus` / `TSessionStatus` — the WebRTC-widened status union.

## Using it

```tsx
import { RemoteClient } from '@robota-sdk/agent-transport-webrtc-web/client';

// remote.html entry — connection inputs come from THIS page's URL (relay ← query, secret ← fragment).
export function App() {
  return <RemoteClient />;
}
```

The shared conversation view / prompt components come from `@robota-sdk/agent-transport-gui`. This package does
NOT re-export the core (no pass-through re-exports).

See [SPEC.md](./SPEC.md) for the full contract.
