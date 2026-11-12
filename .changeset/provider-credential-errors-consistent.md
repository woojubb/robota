---
'@robota-sdk/agent-provider': patch
---

`OpenAIProvider`, `DeepSeekProvider`, `QwenProvider` and `GemmaProvider` now throw a `ConfigurationError` when built with no client, apiKey or executor, as `AnthropicProvider` already did, so a host can handle a missing credential once. The message gains the `Configuration Error: ` prefix; it still names the missing client, apiKey or executor.
