---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-http': minor
'@robota-sdk/agent-transport-mcp': minor
'@robota-sdk/agent-transport-protocol': minor
'@robota-sdk/agent-transport-ws': minor
'@robota-sdk/agent-transport-webrtc': minor
---

Add named session capability roles and explicit capability-host queries while preserving the legacy
`IInteractiveSession` interface shape. HTTP, MCP, protocol, WS, WebRTC, and headless transports now
declare only the session roles they consume, and the direct aggregate-cast floor is zero.
