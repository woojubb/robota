---
'@robota-sdk/agent-provider-anthropic': patch
---

`AnthropicProvider` now uses its `defaultModel` option when a chat call names no model, as the other built-in providers do. The Anthropic provider definition already passed the configured model as `defaultModel`, and a call without a model threw "Model is required" instead of using it.
