# OpenAI LLM Text Node Specification

## Scope

- Owns the `llm-text-openai` DAG node definition.
- Provides AI-powered text generation via OpenAI models within DAG execution flows.
- Manages model resolution, prompt validation, cost estimation, and Robota agent invocation.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-core`. Does not redefine core DAG contracts.
- Delegates AI provider calls to `@robota-sdk/agent-provider-openai` (`OpenAIProvider`) via `@robota-sdk/agent-core` (`Robota`).
- Does not own provider or agent implementation.
- Input validation uses `NodeIoAccessor.requireInputString`.
- Config validation through Zod schema (`LlmTextOpenAiConfigSchema`).

## Architecture Overview

- `LlmTextOpenAiNodeDefinition` — node that accepts a `prompt` string input and produces a `completion` string output.
- Constructor reads `OPENAI_API_KEY` from environment and instantiates `OpenAIProvider`.
- Model allowlist validation via `resolveModel` private method.
- Overrides `validateInputWithConfig` for early prompt and model validation before execution.
- Cost estimation: `baseCostUsd + (promptLength / 1000) * 0.001`.
- Execution creates a `Robota` agent instance per call with configured model, temperature, and maxTokens.

## Type Ownership

| Type                                  | Location       | Purpose                                           |
| ------------------------------------- | -------------- | ------------------------------------------------- |
| `LlmTextOpenAiNodeDefinition`         | `src/index.ts` | Node definition class                             |
| `ILlmTextOpenAiNodeDefinitionOptions` | `src/index.ts` | Constructor options (defaultModel, allowedModels) |

## Public API Surface

- `LlmTextOpenAiNodeDefinition` — class
- `ILlmTextOpenAiNodeDefinitionOptions` — interface

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `validateInputWithConfig`, `estimateCostWithConfig`, and `executeWithConfig`.
- Constructor options: `defaultModel` (defaults to `gpt-4o-mini`), `allowedModels`.
- Config schema: `model`, `temperature` (0.2), `maxTokens` (optional), `baseCredits` (0).
- Environment variables: `OPENAI_API_KEY`.

## Error Taxonomy

| Code                                       | Layer      | Description                                 |
| ------------------------------------------ | ---------- | ------------------------------------------- |
| `DAG_VALIDATION_LLM_PROMPT_REQUIRED`       | Validation | Prompt input is empty or missing            |
| `DAG_VALIDATION_LLM_PROMPT_INVALID`        | Validation | Prompt is not a string (cost estimation)    |
| `DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED`     | Validation | Selected model not in allowlist             |
| `DAG_VALIDATION_OPENAI_API_KEY_REQUIRED`   | Validation | OPENAI_API_KEY not configured               |
| `DAG_TASK_EXECUTION_LLM_GENERATION_FAILED` | Execution  | Robota agent run threw an error (retryable) |

## Test Strategy

- No test files exist yet. Coverage status: none.
- Recommended: unit tests with mocked `OpenAIProvider` and `Robota` for prompt validation, model allowlist, cost estimation formula, and execution error handling.
- Recommended: verify `validateInputWithConfig` rejects empty prompts and disallowed models before execution.
