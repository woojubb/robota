# LLM Text Router Node Specification

## Scope

- Owns the `llm-text-router` DAG node definition.
- Routes LLM text generation across multiple configured providers using a priority-fallback or round-robin strategy.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- Delegates execution to provider-specific node definitions (`llm-text-anthropic`, `llm-text-openai`, `llm-text-gemini`, `llm-text-deepseek`, `llm-text-qwen`).
- Reads API key presence from environment variables at runtime — never stores keys in config.
- Input validation uses `NodeIoAccessor` and error builders from `@robota-sdk/dag-core`.

## Architecture Overview

- `LlmTextRouterNodeDefinition` — node that accepts a `text` input port and produces a `text` output port.
- Provider list is declared in `config.providers` (type + optional model + priority).
- Providers are sorted by ascending priority; a provider is skipped if its API key env var is absent.
- On failure the router tries the next provider (priority-fallback strategy).
- Successful response includes an `_agentSummary` indicating which provider was used and any fallback chain.
- Cost estimation: proportional to prompt character length at a fixed per-token rate.

## Type Ownership

| Type                          | Location       | Purpose                               |
| ----------------------------- | -------------- | ------------------------------------- |
| `LlmTextRouterNodeDefinition` | `src/index.ts` | Node definition class                 |
| `TRouterProviderType`         | `src/index.ts` | Union of supported provider type keys |

## Public API Surface

- `LlmTextRouterNodeDefinition` — class (default export via package index)
- `TRouterProviderType` — type alias

## Extension Points

- Config `providers`: array of `{ type, model?, priority }` entries.
- Config `strategy`: `'priority-fallback'` (default) or `'round-robin'`.
- Config `maxCostUsd`: optional cap on estimated cost per invocation.
- Supported provider env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`.
- Error codes: `DAG_VALIDATION_ROUTER_NO_API_KEY_AVAILABLE`, `DAG_VALIDATION_LLM_PROMPT_REQUIRED`, `DAG_TASK_EXECUTION_LLM_GENERATION_FAILED`.
