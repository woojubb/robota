# SPEC: agent-builtin-providers

## Purpose

Composition leaf that aggregates the built-in chat provider definitions.
`createDefaultProviderDefinitions()` returns the anthropic/openai/gemini/gemma/qwen/deepseek
definitions; `bytedance` (video) is intentionally excluded.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core`
and register it directly.

## Non-goals / Boundaries

- Depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where
  applicable).
- Must never import `agent-framework`, `agent-session`, or any higher-layer package.
