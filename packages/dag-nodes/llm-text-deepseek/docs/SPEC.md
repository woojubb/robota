# DeepSeek LLM Text Node Specification

## Scope

- Owns the `llm-text-deepseek` DAG node definition.
- Provides AI-powered text generation via DeepSeek models within DAG execution flows.
- Manages model resolution, prompt validation, cost estimation, and Robota agent invocation.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-node`. Does not redefine core DAG contracts.
- Delegates AI provider calls to `@robota-sdk/agent-provider` (subpath `/deepseek`, `DeepSeekProvider`) via `@robota-sdk/agent-core` (`Robota`).
- Does not own provider or agent implementation.
- Input validation uses `NodeIoAccessor.requireInputString`.
- Config validation through Zod schema (`LlmTextDeepSeekConfigSchema`).

## Architecture Overview

- `LlmTextDeepSeekNodeDefinition` — node that accepts a single `text` string input port and produces a `text` string output port.
- Reads `DEEPSEEK_API_KEY` from environment at call time and instantiates `DeepSeekProvider`.
- Model allowlist validation via `resolveModel` private method.
- Overrides `validateInputWithConfig` for early prompt and model validation before execution.
- Cost estimation: `baseCredits + (promptLength / 1000) * 0.0001` (cost-efficient provider).
- Execution creates a `Robota` agent instance per call with configured model, temperature, and maxTokens.

## Type Ownership

| Type                                    | Location       | Purpose                                           |
| --------------------------------------- | -------------- | ------------------------------------------------- |
| `LlmTextDeepSeekNodeDefinition`         | `src/index.ts` | Node definition class                             |
| `ILlmTextDeepSeekNodeDefinitionOptions` | `src/index.ts` | Constructor options (defaultModel, allowedModels) |

## Public API Surface

- `LlmTextDeepSeekNodeDefinition` — class
- `ILlmTextDeepSeekNodeDefinitionOptions` — interface

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `validateInputWithConfig`, `estimateCostWithConfig`, and `executeWithConfig`.
- Constructor options: `defaultModel` (defaults to `deepseek-v4-flash`), `allowedModels`.
- Config schema: `model`, `temperature` (0.2), `maxTokens` (optional), `baseCredits` (0).
- Environment variables: `DEEPSEEK_API_KEY`.

## Error Taxonomy

| Code                                       | Layer      | Description                                 |
| ------------------------------------------ | ---------- | ------------------------------------------- |
| `DAG_VALIDATION_LLM_PROMPT_REQUIRED`       | Validation | Prompt input is empty or missing            |
| `DAG_VALIDATION_LLM_PROMPT_INVALID`        | Validation | Prompt is not a string (cost estimation)    |
| `DAG_VALIDATION_LLM_MODEL_NOT_ALLOWED`     | Validation | Selected model not in allowlist             |
| `DAG_VALIDATION_DEEPSEEK_API_KEY_REQUIRED` | Validation | DEEPSEEK_API_KEY not configured             |
| `DAG_TASK_EXECUTION_LLM_GENERATION_FAILED` | Execution  | Robota agent run threw an error (retryable) |

## Test Strategy

- Unit tests with mocked `DeepSeekProvider` and `Robota` covering: prompt validation, model allowlist, cost estimation formula, and execution error handling.
- `validateInputWithConfig` rejects empty prompts and disallowed models before execution.
