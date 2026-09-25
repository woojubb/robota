---
'@robota-sdk/agent-transport-mcp': major
'@robota-sdk/agent-cli': patch
---

MCP servers now publish a neutral submission tool by default. Hosts that need the previous
`robota_submit` tool must pass `submitTool: { name: 'robota_submit', description: '...' }` to
`createAgentMcpServer`, `createMcpTransport`, or `createMcpHttpHost`. The Robota CLI supplies its
existing name and description for both stdio and HTTP carriers.
