# Gemini Image Edit Node Specification

## Scope

- Owns the `gemini-image-edit` and `gemini-image-compose` DAG node definitions.
- Provides AI-powered image editing (single image + prompt) and image composition (multiple images + prompt) via Google Gemini models.
- Manages Gemini runtime lifecycle including model resolution, input image resolution (asset, data URI, HTTP), and output normalization.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-core`. Does not redefine core DAG contracts.
- Delegates AI provider calls to `@robota-sdk/agent-provider-google` (`GoogleProvider`). Does not own provider implementation.
- Binary port definitions use `BINARY_PORT_PRESETS.IMAGE_COMMON` from `dag-core`.
- Config validation through Zod schemas (`GeminiImageEditConfigSchema`, `GeminiImageComposeConfigSchema`).
- Input validation uses `NodeIoAccessor` helpers (`requireInputBinary`, `requireInputBinaryList`, `requireInputString`).

## Architecture Overview

- `GeminiImageEditNodeDefinition` — single image edit node (image + prompt -> image).
- `GeminiImageComposeNodeDefinition` — multi-image compose node (images[] + prompt -> image).
- `GeminiImageRuntime` — shared runtime that handles provider capability checks, model allowlist validation, image input resolution via `MediaReference`, and output normalization.
- `runtime-helpers.ts` — utility functions for CSV parsing, base URL resolution, data URI parsing, inline image source conversion, and output normalization.

## Type Ownership

| Type                               | Location                 | Purpose                                  |
| ---------------------------------- | ------------------------ | ---------------------------------------- |
| `GeminiImageEditNodeDefinition`    | `src/index.ts`           | Edit node definition class               |
| `GeminiImageComposeNodeDefinition` | `src/index.ts`           | Compose node definition class            |
| `IGeminiImageEditRequest`          | `src/runtime-core.ts`    | Edit request contract                    |
| `IGeminiImageComposeRequest`       | `src/runtime-core.ts`    | Compose request contract                 |
| `IGeminiImageRuntimeOptions`       | `src/runtime-core.ts`    | Runtime constructor options              |
| `IInlineImageSource`               | `src/runtime-helpers.ts` | Resolved inline image for provider calls |

## Public API Surface

- `GeminiImageEditNodeDefinition` — class
- `GeminiImageComposeNodeDefinition` — class
- `IGeminiImageEditNodeDefinitionOptions` — interface (re-export of runtime options)
- `IGeminiImageComposeNodeDefinitionOptions` — interface (re-export of runtime options)
- `IGeminiImageEditRequest`, `IGeminiImageComposeRequest`, `IGeminiImageRuntimeOptions` — re-exported types

## Extension Points

- Both node classes extend `AbstractNodeDefinition` and override `estimateCostWithConfig` and `executeWithConfig`.
- Runtime options allow injecting `apiKey`, `defaultModel`, and `allowedModels` at construction time.
- Environment variables: `GEMINI_API_KEY`, `DAG_GEMINI_IMAGE_DEFAULT_MODEL`, `DAG_GEMINI_IMAGE_ALLOWED_MODELS`, `DAG_RUNTIME_BASE_URL`, `DAG_PORT`.

## Error Taxonomy

| Code                                                        | Layer      | Description                                     |
| ----------------------------------------------------------- | ---------- | ----------------------------------------------- |
| `DAG_VALIDATION_GEMINI_IMAGE_INPUT_INVALID`                 | Validation | Input image is not a valid binary image payload |
| `DAG_VALIDATION_GEMINI_IMAGE_PROMPT_REQUIRED`               | Validation | Prompt input is empty or missing                |
| `DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGES_INVALID`        | Validation | Compose images input is not a valid binary list |
| `DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_PROMPT_REQUIRED`       | Validation | Compose prompt is empty or missing              |
| `DAG_VALIDATION_GEMINI_IMAGE_COMPOSE_IMAGES_MIN_ITEMS`      | Validation | Compose requires at least two images            |
| `DAG_VALIDATION_GEMINI_API_KEY_REQUIRED`                    | Validation | API key not configured                          |
| `DAG_VALIDATION_GEMINI_IMAGE_MODEL_NOT_ALLOWED`             | Validation | Model not in allowlist                          |
| `DAG_VALIDATION_GEMINI_IMAGE_INPUT_ASSET_NOT_FOUND`         | Validation | Asset reference could not be fetched            |
| `DAG_VALIDATION_GEMINI_IMAGE_INPUT_DATA_URI_INVALID`        | Validation | Data URI is malformed                           |
| `DAG_VALIDATION_GEMINI_IMAGE_INPUT_URI_UNREACHABLE`         | Validation | HTTP URI fetch failed                           |
| `DAG_VALIDATION_GEMINI_IMAGE_INPUT_MEDIA_TYPE_INVALID`      | Validation | Resolved content is not an image MIME type      |
| `DAG_VALIDATION_GEMINI_IMAGE_INPUT_REFERENCE_UNSUPPORTED`   | Validation | URI scheme not supported                        |
| `DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_INVALID`            | Execution  | Runtime returned non-image output               |
| `DAG_TASK_EXECUTION_GEMINI_IMAGE_EDIT_FAILED`               | Execution  | Provider edit call failed                       |
| `DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_FAILED`            | Execution  | Provider compose call failed                    |
| `DAG_TASK_EXECUTION_GEMINI_IMAGE_COMPOSE_OUTPUT_INVALID`    | Execution  | Compose returned non-image output               |
| `DAG_TASK_EXECUTION_GEMINI_IMAGE_RESPONSE_MISSING_IMAGE`    | Execution  | Provider response has no image data             |
| `DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_ASSET_INVALID`      | Execution  | Output asset missing valid assetId              |
| `DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_MEDIA_TYPE_INVALID` | Execution  | Output has non-image MIME type                  |
| `DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_MISSING`        | Execution  | Output URI reference missing                    |
| `DAG_TASK_EXECUTION_GEMINI_IMAGE_OUTPUT_URI_UNSUPPORTED`    | Execution  | Output data URI is not a valid image            |

## Test Strategy

- No test files exist yet. Coverage status: none.
- Recommended: unit tests for `GeminiImageRuntime` with mocked `GoogleProvider`, input validation paths, model allowlist logic, and output normalization.
- Recommended: integration tests for `MediaReference` resolution and data URI parsing in `runtime-helpers.ts`.
