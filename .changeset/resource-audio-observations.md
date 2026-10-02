---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-mcp': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-gemini': patch
'@robota-sdk/agent-provider-openai-compatible': patch
---

Retain typed resource and audio observations alongside structured tool results through history, durable receipts, recovery, size admission, and session persistence. Preserve opaque resource references without fetching them, project embedded text and explicit unsupported binary/audio diagnostics into provider requests and compaction transcripts, and validate persisted observation shapes on reload.
