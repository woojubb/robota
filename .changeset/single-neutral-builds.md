---
'@robota-sdk/agent-builtin-providers': minor
'@robota-sdk/agent-capability-pack': minor
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-executor': minor
'@robota-sdk/agent-interface-analytics': minor
'@robota-sdk/agent-interface-command': minor
'@robota-sdk/agent-interface-execution': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-interface-session-mobility': minor
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-interface-tui': minor
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-organization': minor
'@robota-sdk/agent-plugin': minor
'@robota-sdk/agent-provider-anthropic': minor
'@robota-sdk/agent-provider-bytedance': minor
'@robota-sdk/agent-provider-gemini': minor
'@robota-sdk/agent-provider-openai': minor
'@robota-sdk/agent-provider-openai-compatible': minor
'@robota-sdk/agent-remote-pairing': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-session-analytics': minor
'@robota-sdk/agent-telemetry-otel': minor
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-http': minor
'@robota-sdk/agent-transport-webrtc-web': minor
'@robota-sdk/agent-ui-web': minor
---

Ship one build per package. The platform-neutral entries moved from `dist/node` to `dist`, and the second
`dist/browser` build of `@robota-sdk/agent-core`, `@robota-sdk/agent-transport`,
`@robota-sdk/agent-ui-web` and `@robota-sdk/agent-transport-webrtc-web` is gone: a neutral entry runs
unchanged in every runtime, so a subpath's `exports` map `import` and `require` to the same files and no
longer a `node` or `browser` condition (a Node-only subpath keeps `"browser": null`). Import specifiers
and the code behind them are unchanged; only a deep import of `dist/node/*` or `dist/browser/*` breaks.
`@robota-sdk/agent-transport/client` also ships a CommonJS build now.
