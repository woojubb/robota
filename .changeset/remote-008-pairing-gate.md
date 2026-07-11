---
'@robota-sdk/agent-transport-webrtc': minor
---

Add the pairing gate to the WebRTC transport (REMOTE-008 Step 1, security milestone). When a pairing
`secret` is configured, the data channel is phase-separated: pre-accept it carries only pairing frames
(routed to the directional-HMAC handshake bound to the DTLS fingerprints; any non-pairing frame is
dropped), and only after the handshake accepts is the session bridge built — fail closed on
mismatch/timeout (channel closed, session never exposed). Without a `secret` the channel is exposed
immediately, unchanged. Introduces a dependency on the zero-dep `@robota-sdk/agent-remote-pairing` leaf
(the gate must live where the SDP fingerprints and channel frames are visible).
