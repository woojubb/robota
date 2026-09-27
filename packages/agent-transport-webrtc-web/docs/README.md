# @robota-sdk/agent-transport-webrtc-web

The **browser** WebRTC transport peer for a Robota session — the browser mirror of the Node host transport
[`@robota-sdk/agent-transport-webrtc`](../../agent-transport-webrtc/docs/README.md). It answers the host's
WebRTC offer over a native `RTCPeerConnection`, runs the directional-HMAC pairing handshake as the
responder behind a fail-closed gate, and co-drives the same session over an `RTCDataChannel`, reusing the
shared session reducer and view components from
[`@robota-sdk/agent-ui-web`](../../agent-ui-web/docs/README.md).

> Internal (private, not published to npm), browser-only, React 18+.

## What it owns

- `useRtcSession({ relayUrl, rendezvous, secret, iceServers?, forceTurn? })` — binds the shared session
  reducer to the WebRTC client.
- `RemoteClient` — the remote page root: reads the pairing URL, pairs, and renders the session.
- `createRtcSessionClient` / `createRtcSignalingClient` / `parseRemoteClientLocation` — the RTC client
  stack.
- `TRtcConnectionStatus` / `TSessionStatus` — the connection status, widened with the `pairing`,
  `awaiting-approval`, `refused` and `failed` states.

## Using it

```tsx
import { RemoteClient } from '@robota-sdk/agent-transport-webrtc-web/client';

// Page entry — connection inputs come from this page's URL (`?relay=` query, pairing secret in the fragment).
export function App() {
  return <RemoteClient />;
}
```

`./client` is the browser build of the same exports. The shared conversation view and prompt components
come from `@robota-sdk/agent-ui-web`; this package does not re-export them.

## Documents

- [SPEC.md](./SPEC.md) — the contract: admission, fail-closed pairing and the single-fingerprint rule.
- [README](../README.md) — where the package sits.
