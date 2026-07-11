---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-transport-tui': minor
'@robota-sdk/agent-cli': minor
---

Add the `/remote-control` enable path (REMOTE-008 Stage B4-2b) — turn on P2P remote control locally, get
a QR + link, and a paired device co-drives the SAME live session over pairing-gated WebRTC. The command
is a declarative trigger returning `remote-control-enable-requested`/`-stop-requested` effects (SSOT
agent-interface-transport) and reads state via a new `ICommandHostAdapters.remoteControl.getStatus()`;
the TUI dispatches the effects to injected callbacks; all transport construction lives at the agent-cli
composition root (`WsSignalingClient` + pairing-gated `WebRtcTransport`, relay URL from
`transports.webrtc.options.relayUrl`, QR/link rendered into history). Fail-closed: no relay configured ⇒
does nothing; pairing mismatch/timeout ⇒ the session is never exposed. Consumes REMOTE-007 so a paired
remote owner answers their own permission/ask prompts over the WebRTC channel.
