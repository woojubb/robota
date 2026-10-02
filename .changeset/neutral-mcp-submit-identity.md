---
'@robota-sdk/agent-transport-mcp': major
'@robota-sdk/agent-cli': patch
---

MCP servers now publish a neutral submission tool by default. Hosts that need the previous
`<configured-submit-tool>` tool must pass `submitTool: { name: '<configured-submit-tool>', description: '...' }` to
`createAgentMcpServer`, `createMcpTransport`, or `createMcpHttpHost`. The configured CLI supplies its
existing name and description for both stdio and HTTP carriers.
