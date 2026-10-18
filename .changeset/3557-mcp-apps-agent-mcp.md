---
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-cli': minor
---

MCP Apps: a tool's declared view can ride its result to a surface that can host it.

`agent-mcp` declares the `io.modelcontextprotocol/ui` extension only when the host opts in
(`IMCPOpenSessionOptions.apps`), on both protocol eras. A tool's `_meta.ui` reference (a `ui://`
resource and its audience) is kept in discovery and the catalog only when the server declared the
extension and resources too; a malformed declaration is reported by a fixed reason and the tool is
still offered without a view, and a tool the server hides from the model is rejected with a reason
rather than offered. `IMCPSession` gains `readResource` (a general `resources/read`, also on
`MCPConnectionSupervisor`) and `apps`; a custom `IMCPSession` implementation must add `readResource`.
After a successful call, `DiscoveredMCPTool` reads the declared resource and, when it is one
`text/html;profile=mcp-app` document within the size bound, attaches `IToolResult.view`; otherwise the
text result is unchanged and the omission is reported. The view never enters model context.

`agent-cli` opts in only for the plain `--serve` host that the desktop app and web GUI drive, not the
TUI, print runs, `mcp serve` or the ACP agent.
