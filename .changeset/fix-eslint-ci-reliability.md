---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-sdk': patch
'@robota-sdk/agent-sessions': patch
'@robota-sdk/agent-team': patch
'@robota-sdk/agent-tools': patch
'@robota-sdk/agent-tool-mcp': patch
'@robota-sdk/agent-event-service': patch
'@robota-sdk/agent-remote-client': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-bytedance': patch
'@robota-sdk/agent-provider-google': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-transport-headless': patch
'@robota-sdk/agent-transport-http': patch
'@robota-sdk/agent-transport-mcp': patch
'@robota-sdk/agent-transport-ws': patch
'@robota-sdk/agent-plugin-conversation-history': patch
'@robota-sdk/agent-plugin-error-handling': patch
'@robota-sdk/agent-plugin-event-emitter': patch
'@robota-sdk/agent-plugin-execution-analytics': patch
'@robota-sdk/agent-plugin-limits': patch
'@robota-sdk/agent-plugin-logging': patch
'@robota-sdk/agent-plugin-performance': patch
'@robota-sdk/agent-plugin-usage': patch
'@robota-sdk/agent-plugin-webhook': patch
'@robota-sdk/dag-core': patch
'@robota-sdk/dag-api': patch
'@robota-sdk/dag-node': patch
'@robota-sdk/dag-orchestrator': patch
'@robota-sdk/dag-projection': patch
'@robota-sdk/dag-runtime': patch
'@robota-sdk/dag-scheduler': patch
'@robota-sdk/dag-worker': patch
'@robota-sdk/dag-designer': patch
---

fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability

- Add tsconfig.eslint.json to all packages for per-package ESLint runs
- Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
- Add --if-present to all recursive pnpm run scripts
- Fix React type imports, dynamic imports in tests, Express.Multer types
