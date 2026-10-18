---
'@robota-sdk/agent-ui-web': minor
---

The GUI surface can now show an MCP app view: the interface a tool's own server declared for a call,
under that call's line in the conversation.

The document is never put in the page and never runs in its origin. `SessionSurface` takes an optional
`appViewSandboxUrl`, the address of a static sandbox page from the host's own origin; the app view
frame loads that page with `sandbox="allow-scripts"` (an opaque origin, no `allow` attribute), and the
page holds the document in a second `srcdoc` frame under its own no-network policy. A surface that
passes no sandbox URL (the remote browser surface, `apps/agent-web`) shows one plain line and its text
result, and never reads the view.

- `AppView` and a pure, React-free bridge for the MCP Apps dialect (JSON-RPC over `postMessage`):
  it answers `ui/initialize`, sends `tool-input` and then `tool-result` only after the view is
  initialized, follows `size-changed` within bounds, and refuses every other request. Messages count
  only from the frame's own window.
- A view can call only the tools its own server declared (`callableTools`), one call at a time; each
  goes to the session as `call-app-tool` and passes the session's permission gate, so the GUI's own
  prompt appears and can be denied.
- `IActiveTool.appView` carries the live `tool_end` reference; `IWsSessionState` gains `readAppView`
  and `callAppTool`, each a promise settled by the reply that echoes its request id and rejected when
  the session refuses it or the connection drops. `app_view` and `app_tool_result` are now
  `reducer-state` in `SERVER_MESSAGE_HANDLING`.
