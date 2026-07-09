# LLM Text Node Specification

## Scope

- Owns the collapsed `llm-text` DAG node definition (ARCH-PROVIDER-003).
- Provides AI-powered text generation for **any** provider in an injected provider-definition registry —
  superseding the five per-vendor `llm-text-<vendor>` nodes and the `llm-text-router`.
- Manages prompt validation, provider selection (priority-fallback), model resolution, cost estimation,
  and Robota agent invocation.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- Depends on `@robota-sdk/agent-core` **only** (no provider-leaf dependency): it is constructed with an
  `IProviderDefinition[]` registry and resolves the target `IAIProvider` through the agent-core
  `normalizeProviderConfig` + `createProviderFromConfig` resolver.
- Reads **no** `process.env` itself — credential and `$ENV:` resolution live in `agent-core`
  (`resolveEnvReference`).
- Does not own provider or agent implementation.
- Input validation uses `NodeIoAccessor.requireInputString`. Config validation through the Zod schema
  (`LlmTextConfigSchema`).

## Architecture Overview

- `LlmTextNodeDefinition` — node with a single `text` string input port and a `text` string output port.
- Constructor takes `providers: readonly IProviderDefinition[]` (the injected registry).
- Config is either the single-provider shorthand (`provider` [+ `model`]) or the routing list
  (`providers: [{ provider, model?, priority? }]`) with `strategy` (`priority-fallback` | `round-robin`).
- Providers are tried in ascending priority order; a provider with no resolvable credential (or unknown to
  the registry, or a disallowed model) is **skipped** (an `// allow-fallback` selection strategy); the first
  success is returned. If every provider is skipped, a single `NO_PROVIDER_AVAILABLE` validation error lists
  the skip reasons.
- Cost estimation: `baseCredits + (promptLength / 4) * costPerToken`, where `costPerToken` is the primary
  provider definition's `costPerTokenUsd` or a fallback flat estimate when unknown.

## Type Ownership

| Type                    | Location       | Purpose                   |
| ----------------------- | -------------- | ------------------------- |
| `LlmTextNodeDefinition` | `src/index.ts` | Collapsed node definition |

## Public API Surface

- `LlmTextNodeDefinition` — class (constructed with an `IProviderDefinition[]` registry)

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `validateInputWithConfig`, `estimateCostWithConfig`, and
  `executeWithConfig`.
- Config schema: `provider` / `providers`, `model`, `temperature` (0.2), `maxTokens` (optional),
  `maxCostUsd` (optional), `baseCredits` (0), `strategy` (`priority-fallback`), `options` (passthrough).
- Providers/credentials: supplied via the injected `IProviderDefinition[]` (default =
  `createDefaultProviderDefinitions()` when composed by `createDagFramework`).

## Error Taxonomy

| Code                                       | Layer      | Description                                         |
| ------------------------------------------ | ---------- | --------------------------------------------------- |
| `DAG_VALIDATION_LLM_PROMPT_REQUIRED`       | Validation | Prompt input is empty or missing                    |
| `DAG_VALIDATION_LLM_PROMPT_INVALID`        | Validation | Prompt is not a string (cost estimation)            |
| `DAG_VALIDATION_LLM_PROVIDER_REQUIRED`     | Validation | Neither `provider` nor a non-empty `providers` set  |
| `DAG_VALIDATION_LLM_NO_PROVIDER_AVAILABLE` | Validation | Every configured provider was skipped (see reasons) |
| `DAG_TASK_EXECUTION_LLM_GENERATION_FAILED` | Execution  | Provider run threw (retryable per error class)      |

## Test Strategy

- `src/index.test.ts` stubs the `IProviderDefinition[]` registry and mocks `Robota` (no real provider
  call, per common-mistakes #76). Covers registry-driven resolution (TC-01), priority-fallback + skip
  semantics (TC-02/02b/02c), options passthrough (TC-07), allowlist enforcement, prompt validation, and the
  cost formula. Real-provider coverage is out-of-band/opt-in only.
