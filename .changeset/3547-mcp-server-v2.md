---
'@robota-sdk/agent-transport-mcp': patch
'@robota-sdk/agent-cli': patch
---

**`@robota-sdk/agent-transport-mcp` serves stdio from `@modelcontextprotocol/server` 2.x, and the 1.x `@modelcontextprotocol/sdk` leaves the repository's runtime dependencies.**

The stdio server (`createAgentMcpServer`, `createMcpTransport`) now builds on the same v2 server
package the HTTP hosts already use, through its `/stdio` carrier; the catalog is validated with the
SDK's own `Tool` validator, so the HTTP hosts no longer re-serialize it at the SDK boundary. Client-
visible behavior is unchanged: the same tools, submission extension, admission, turn correlation and
error results, negotiated through the legacy `initialize` handshake as before. `createAgentMcpServer`
returns the v2 `Server` type; a consumer wiring its own carrier imports `StdioServerTransport` from
`@modelcontextprotocol/server/stdio`. The stdio connection is stateful, so the server can send
server-to-client requests such as `elicitInput` to a client that declares the capability (tested).

`@robota-sdk/agent-cli` drops `@modelcontextprotocol/sdk` from its external `dependencies`; nothing
in its bundle imports it any more. The 1.x SDK remains only as a test dependency of
`@robota-sdk/agent-mcp`, for its legacy-era fixture host.
