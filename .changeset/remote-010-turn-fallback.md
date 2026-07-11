---
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-web-ui': minor
---

Add user-supplied TURN fallback for remote control (REMOTE-010 / Stage E1) so P2P works behind symmetric
NAT / restrictive firewalls. The host reads + validates `transports.webrtc.options.iceServers`/`forceTurn`
at the agent-cli composition root (a fail-closed validator narrowing the untyped value → `IIceServer[]`;
`IWebRtcTransportOptions.iceServers` widened to carry TURN `username`/`credential`), and the browser reads a
validated `ice`/`forceTurn` pairing-URL query param (fail-closed decoder for the attacker-influenceable value;
`forceTurn` → `iceTransportPolicy: 'relay'`) — both threaded into their `RTCPeerConnection`. `forceTurn` without
a TURN server fails closed (else ICE gathers no candidates and silently never connects). Absent ICE config ⇒
host-candidate-only, unchanged.
