---
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-remote-pairing': patch
'@robota-sdk/agent-cli': minor
---

The Node WebRTC transport runs on `node-datachannel` (libdatachannel, DTLS by OpenSSL). The DTLS stack
verifies handshake signatures, so a channel binding names the party that holds the certificate's key.
It is an optional dependency with a prebuilt binary per platform; where it cannot load, the WebRTC
transport reports itself unavailable instead of falling back to another implementation.

- `agent-transport-webrtc` — `RtcPeer` / `RtcChannel` wrap one connection; `loadDataChannel` replaces
  `loadWerift` (and the `loadWerift` option becomes `loadDataChannel`). Every connection has its own DTLS
  certificate, no ICE server is contacted unless configured, and `werift` is no longer a peer dependency.
  A pairing peer that finishes the handshake first and speaks at once no longer has that frame dropped: it
  is held until this side accepts, and discarded if it does not.
- `agent-cli` — depends on `node-datachannel` (optional) instead of `werift`.
