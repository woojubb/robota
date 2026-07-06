# @robota-sdk/agent-web

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-interface-transport@3.0.0-beta.79
- @robota-sdk/agent-transport-ws@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- @robota-sdk/agent-interface-transport@3.0.0-beta.78
- @robota-sdk/agent-transport-ws@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- @robota-sdk/agent-interface-transport@3.0.0-beta.77
- @robota-sdk/agent-transport-ws@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- 9df3a88: Split the consolidated `@robota-sdk/agent-transport` package into per-concern transport packages (DQ-AUDIT-005) so unrelated heavy dependencies (React/Ink, ws, Hono, MCP SDK) no longer share one publishable unit and are not dragged into non-TUI consumers' graphs:

  - `@robota-sdk/agent-transport` — lean core: headless adapter + `TransportRegistry` + scripted-provider testing fixtures (no external runtime deps).
  - `@robota-sdk/agent-transport-tui` — React + Ink terminal UI.
  - `@robota-sdk/agent-transport-ws` — WebSocket transport + protocol (`agent-web-ui` now depends only on this for WS types).
  - `@robota-sdk/agent-transport-http` — Hono HTTP transport.
  - `@robota-sdk/agent-transport-mcp` — MCP server transport.

  The default transport-registry wiring (pre-registering `WsTransport`) moves to the CLI composition root, removing the core→ws edge.

- Updated dependencies [9df3a88]
  - @robota-sdk/agent-transport-ws@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-transport@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- @robota-sdk/agent-transport@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- Updated dependencies [d4fd33f]
  - @robota-sdk/agent-transport@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-transport@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-transport@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-transport@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- @robota-sdk/agent-transport@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-transport@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- @robota-sdk/agent-transport@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-transport@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-transport@3.0.0-beta.65

## 3.0.0-beta.64

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-transport@3.0.0-beta.64

## 3.0.0-beta.63

### Patch Changes

- @robota-sdk/agent-transport-ws@3.0.0-beta.63

## 3.0.0-beta.62

### Patch Changes

- Add CLI second-screen browser monitor (PLG-002)
  - New `@robota-sdk/agent-web` package: WebSocket client, `useWsSession` hook, `SessionMonitor` component with Markdown rendering
  - `--web` flag on `agent-cli`: starts WebSocket sidecar server and auto-opens browser monitor
  - `--no-open` flag and `ROBOTA_NO_OPEN` env var to suppress browser launch
  - `user_message` event added to `IInteractiveSessionEvents` so user prompts stream to browser in real-time
  - `TServerMessage` protocol extended with `user_message` type
  - @robota-sdk/agent-transport-ws@3.0.0-beta.62
