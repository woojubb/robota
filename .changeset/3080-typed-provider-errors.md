---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-provider-anthropic': minor
'@robota-sdk/agent-provider-openai': minor
'@robota-sdk/agent-provider-gemini': minor
'@robota-sdk/agent-provider-openai-compatible': minor
'@robota-sdk/agent-provider-bytedance': patch
---

Provider failures keep the vendor's HTTP status and error type. `ProviderError` gains `status` and `type`, adapters throw `ProviderError` (or `RateLimitError` for a rate limit) instead of a bare `Error`, an Anthropic mid-stream `overloaded_error` event surfaces as a `ProviderError` with that type, and media errors carry `status`. New `classifyProviderFailure` says whether a failure is worth retrying on another model, and `toProviderError` is the shared adapter mapping.
