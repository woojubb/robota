---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-mcp': patch
'@robota-sdk/agent-transport': major
---

Update HTTP and MCP dependencies to versions containing security fixes. The transport package now requires Hono `^4.13.16`, MCP Node `^2.1.2`, and MCP Server `^2.4.0` when those optional peers are used.
