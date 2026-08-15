---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-transport': patch
'@robota-sdk/agent-transport-protocol': major
'@robota-sdk/agent-transport-tui': minor
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-transport-ws': minor
---

Emit the complete persisted checkpoint and branch lifecycle, forward plan, context-refresh, and
branch events through protocol transports, and render deterministic bounded notices in the TUI.
Transport-owned delivery failures now enter the owning carrier cleanup lifecycle without reversing
an already-committed session operation.
