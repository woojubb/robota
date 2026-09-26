---
'@robota-sdk/agent-builtin-providers': patch
'@robota-sdk/agent-capability-pack': patch
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-executor': patch
'@robota-sdk/agent-file-authority': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-interface-analytics': patch
'@robota-sdk/agent-interface-command': patch
'@robota-sdk/agent-interface-execution': patch
'@robota-sdk/agent-interface-session-mobility': patch
'@robota-sdk/agent-interface-session': patch
'@robota-sdk/agent-interface-transport': patch
'@robota-sdk/agent-interface-tui': patch
'@robota-sdk/agent-mcp': patch
'@robota-sdk/agent-plugin': patch
'@robota-sdk/agent-preset': patch
'@robota-sdk/agent-process': patch
'@robota-sdk/agent-product': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-bytedance': patch
'@robota-sdk/agent-provider-gemini': patch
'@robota-sdk/agent-provider-openai-compatible': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-remote-pairing': patch
'@robota-sdk/agent-session-analytics': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/agent-tool-defaults': patch
'@robota-sdk/agent-tools': patch
'@robota-sdk/agent-transport-http': patch
'@robota-sdk/agent-transport-mcp': patch
'@robota-sdk/agent-transport-webrtc': patch
'@robota-sdk/agent-transport-ws': patch
'@robota-sdk/agent-transport': patch
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/pack-coding': patch
---

Every published package now exports `./package.json`, so `require('<package>/package.json')` and
`import('<package>/package.json', { with: { type: 'json' } })` work instead of failing with
`ERR_PACKAGE_PATH_NOT_EXPORTED`, and each tarball now ships the package's `CHANGELOG.md`.
