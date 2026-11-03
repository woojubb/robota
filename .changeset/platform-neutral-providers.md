---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-provider-anthropic': minor
'@robota-sdk/agent-provider-openai': minor
'@robota-sdk/agent-provider-openai-compatible': minor
'@robota-sdk/agent-provider-gemini': minor
'@robota-sdk/agent-builtin-providers': minor
---

Make the provider packages platform-neutral.

- The Anthropic, OpenAI, OpenAI-compatible, Gemini and built-in provider packages no longer reach Node: message ids come from the new `randomId()` in `@robota-sdk/agent-core` (the platform's `crypto.randomUUID`, with a `getRandomValues` fallback outside a secure context) instead of `node:crypto`.
- `FilePayloadLogger` moved from `@robota-sdk/agent-provider-openai/loggers` to `@robota-sdk/agent-provider-openai/node`; `/loggers` keeps the platform-neutral `ConsolePayloadLogger`.
- `GeminiProvider.canPropagateTraceContext()` reads a base-URL override from the client the SDK built instead of the environment, so it matches where the client sends: a `GOOGLE_VERTEX_BASE_URL` outside Vertex mode, which the SDK ignores, no longer suppresses trace context.
