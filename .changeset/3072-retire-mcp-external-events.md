---
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-cli': minor
---

An MCP server is no longer a carrier for external events: a server connection proves nothing about who wrote a
message, and external events are now admitted only by a verified access token.

- `agent-mcp` (breaking) — `MCP_EXTERNAL_EVENT_CAPABILITY`, `MCP_EXTERNAL_EVENT_METHOD`, `IMCPExternalEvent` and
  `TMCPExternalEventListener` are removed, as are `IMCPSession.externalEventsDeclared`,
  `IMCPSession.onExternalEvent`, `IMCPSession.onClose` and `MCPConnectionSupervisor.onExternalEvent`. A server
  that declares `com.robota.external-event` or sends its notification is served as any other server and the
  notification is ignored. The `zod` dependency is dropped.
- `agent-cli` (breaking) — `IMcpClientComposition.subscribeExternalEvent` and
  `IMcpServerConnection.onExternalEvent` are removed.
