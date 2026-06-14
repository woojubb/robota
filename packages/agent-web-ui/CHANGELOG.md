# @robota-sdk/agent-web

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
