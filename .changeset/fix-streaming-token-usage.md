---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-provider': patch
---

fix(streaming): expose token usage on the streaming execution path (BEHAVIOR-005)

Token usage was silently dropped on streaming turns, so `readTokenUsageFromMessage` and robota's usage analytics returned empty/0 for every `run()`/`runStream()` (which always stream). OpenAI-compatible streaming requests now send `stream_options: { include_usage: true }`, the stream assembler and the `runStream` commit path attach the same top-level `usage` shape the non-streaming path already emits, and both `run()` and `runStream()` now expose usage. New opt-out `IOpenAIProviderOptions.includeStreamUsage` (default `true`) for OpenAI-compatible servers that reject `stream_options`.
