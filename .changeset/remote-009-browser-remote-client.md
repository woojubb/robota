---
'@robota-sdk/agent-web-ui': minor
'@robota-sdk/agent-cli': patch
---

Add the browser remote client (REMOTE-009 Stage D) — the P2P peer that opens the pairing URL and
co-drives a live session over WebRTC. `agent-web-ui` gains a native-`WebSocket` signaling client, a
fail-closed responder pairing gate (session exposed only after the DTLS-fingerprint-bound handshake
accepts), an RTC data-channel session client with the same contract as the WS client, a
fragment-injected `spa/remote.html` static entry, and the REMOTE-007 permission/ask render+answer
(the paired owner answers its own prompts — local == remote) shared by both the WS and RTC clients. It
reuses the isomorphic `@robota-sdk/agent-remote-pairing` leaf and takes no node/werift dependency.
`agent-cli` removes the fabricated `robota-remote://pair` client-URL default and fails closed when
`transports.webrtc.options.clientUrl` is unset (no dead link).
