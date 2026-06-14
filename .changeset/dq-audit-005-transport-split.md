---
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-tui': minor
'@robota-sdk/agent-transport-ws': minor
'@robota-sdk/agent-transport-http': minor
'@robota-sdk/agent-transport-mcp': minor
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-web-ui': patch
---

Split the consolidated `@robota-sdk/agent-transport` package into per-concern transport packages (DQ-AUDIT-005) so unrelated heavy dependencies (React/Ink, ws, Hono, MCP SDK) no longer share one publishable unit and are not dragged into non-TUI consumers' graphs:

- `@robota-sdk/agent-transport` — lean core: headless adapter + `TransportRegistry` + scripted-provider testing fixtures (no external runtime deps).
- `@robota-sdk/agent-transport-tui` — React + Ink terminal UI.
- `@robota-sdk/agent-transport-ws` — WebSocket transport + protocol (`agent-web-ui` now depends only on this for WS types).
- `@robota-sdk/agent-transport-http` — Hono HTTP transport.
- `@robota-sdk/agent-transport-mcp` — MCP server transport.

The default transport-registry wiring (pre-registering `WsTransport`) moves to the CLI composition root, removing the core→ws edge.
