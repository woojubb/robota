---
'@robota-sdk/agent-transport-protocol': minor
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-transport-ws': patch
'@robota-sdk/agent-web-ui': patch
---

REMOTE-002 Stage A: extract the transport-neutral session bridge + wire protocol into a new
`@robota-sdk/agent-transport-protocol` package (`createWsHandler`, `TClientMessage`/`TServerMessage`); repoint
`agent-transport-ws` and `agent-web-ui` at it (no pass-through re-export). Add a new
`@robota-sdk/agent-transport-webrtc` package: a `WebRtcTransport` (`IConfigurableTransport`, `defaultEnabled:false`)
that carries an `IInteractiveSession` over an `RTCDataChannel` reusing the shared handler, with a lazily-loaded
optional `werift` peer dependency that throws an explicit "WebRTC transport unavailable" error on absence (never a
silent no-op). No user-facing enable path and no auth in Stage A (that lands in Stage B); the transport is proven
by an in-process loopback data-channel round-trip only.
