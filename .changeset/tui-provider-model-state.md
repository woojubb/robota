---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-sdk': patch
'@robota-sdk/agent-command-model': patch
'@robota-sdk/agent-command-provider': patch
'@robota-sdk/agent-command-agent': patch
'@robota-sdk/agent-command-background': patch
'@robota-sdk/agent-command-compact': patch
'@robota-sdk/agent-command-context': patch
'@robota-sdk/agent-command-exit': patch
'@robota-sdk/agent-command-help': patch
'@robota-sdk/agent-command-language': patch
'@robota-sdk/agent-command-memory': patch
'@robota-sdk/agent-command-mode': patch
'@robota-sdk/agent-command-permissions': patch
'@robota-sdk/agent-command-plugin': patch
'@robota-sdk/agent-command-reset': patch
'@robota-sdk/agent-command-rewind': patch
'@robota-sdk/agent-command-session': patch
'@robota-sdk/agent-command-statusline': patch
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-gemini': patch
'@robota-sdk/agent-provider-gemma': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-openai-compatible': patch
'@robota-sdk/agent-provider-qwen': patch
'@robota-sdk/agent-runtime': patch
'@robota-sdk/agent-sessions': patch
'@robota-sdk/agent-tools': patch
'@robota-sdk/agent-transport-headless': patch
---

Add provider-owned model catalog metadata, route `/model` suggestions through the active provider, and make `cli:dev` resolve the CLI workspace dependency closure through source export conditions.
