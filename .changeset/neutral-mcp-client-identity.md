---
'@robota-sdk/agent-mcp': major
'@robota-sdk/agent-cli': patch
---

Use a neutral default MCP client name and let hosts supply their own protocol identity. configured CLI startup now explicitly supplies its prior `host-configured MCP client name` name, preserving its initialize handshake; embedders relying on that implicit name can set `clientInfo` explicitly.
