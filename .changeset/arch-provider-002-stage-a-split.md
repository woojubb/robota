---
'@robota-sdk/agent-provider-anthropic': minor
'@robota-sdk/agent-provider-openai': minor
'@robota-sdk/agent-provider-openai-compatible': minor
'@robota-sdk/agent-provider-gemini': minor
'@robota-sdk/agent-provider-bytedance': minor
'@robota-sdk/agent-provider-defaults': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-subagent-runner': minor
---

Split the `@robota-sdk/agent-provider` monolith into SDK-aligned leaf packages (ARCH-PROVIDER-002 Stage A). The single package that hard-bundled all three vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`) is **removed** and replaced by per-vendor leaves, each depending only on `@robota-sdk/agent-core` + its one SDK: `@robota-sdk/agent-provider-anthropic`, `@robota-sdk/agent-provider-openai`, `@robota-sdk/agent-provider-openai-compatible` (DeepSeek/Qwen/Gemma over the shared OpenAI-compatible base), `@robota-sdk/agent-provider-gemini` (+ a `./google` entry), and `@robota-sdk/agent-provider-bytedance` (media/video `IVideoGenerationProvider`). The aggregated `createDefaultProviderDefinitions()` now lives in the new `@robota-sdk/agent-provider-defaults` leaf.

Migration: replace `@robota-sdk/agent-provider/<vendor>` imports with the corresponding `@robota-sdk/agent-provider-<vendor>` package (`/deepseek`, `/qwen`, `/gemma` → `@robota-sdk/agent-provider-openai-compatible`; `/google` → `@robota-sdk/agent-provider-gemini/google`), and import `createDefaultProviderDefinitions` from `@robota-sdk/agent-provider-defaults`. Consumers now pull only the vendor SDK(s) they actually use.
