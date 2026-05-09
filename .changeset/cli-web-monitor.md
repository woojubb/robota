---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-web': patch
---

Add CLI second-screen browser monitor (PLG-002)

- New `@robota-sdk/agent-web` package: WebSocket client, `useWsSession` hook, `SessionMonitor` component with Markdown rendering
- `--web` flag on `agent-cli`: starts WebSocket sidecar server and auto-opens browser monitor
- `--no-open` flag and `ROBOTA_NO_OPEN` env var to suppress browser launch
- `user_message` event added to `IInteractiveSessionEvents` so user prompts stream to browser in real-time
- `TServerMessage` protocol extended with `user_message` type
