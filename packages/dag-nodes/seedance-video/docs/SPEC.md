# Seedance Video Node Specification

## Scope

- Owns the `seedance-video` DAG node definition.
- Provides AI-powered video generation via ByteDance Seedance models within DAG execution flows.
- Manages runtime lifecycle including model resolution, image input resolution, async job polling, and video output normalization.

## Boundaries

- Extends `AbstractNodeDefinition` from `dag-core`. Does not redefine core DAG contracts.
- Delegates video generation to `@robota-sdk/bytedance` (`BytedanceProvider`) via `@robota-sdk/agents` video generation interfaces.
- Binary port definitions use `BINARY_PORT_PRESETS.IMAGE_COMMON` (input) and `BINARY_PORT_PRESETS.VIDEO_MP4` (output).
- Input validation uses `NodeIoAccessor` helpers (`requireInputString`, `requireInputBinaryList`).
- Config validation through Zod schema (`SeedanceVideoConfigSchema`).

## Architecture Overview

- `SeedanceVideoNodeDefinition` — node that accepts a `prompt` string and optional `images` binary list, producing a `video` binary output.
- `SeedanceVideoNodeTaskHandler` — internal task handler delegating cost estimation and execution.
- `SeedanceVideoRuntime` — runtime that manages provider initialization, model allowlist, image input resolution via `MediaReference`, async job creation and polling loop with configurable interval and timeout.
- `runtime-helpers.ts` — utility functions for base URL resolution, image input source resolution, and video output normalization.
- Polling loop: creates a video job, polls `getVideoJob` until `succeeded`, `failed`, `cancelled`, or timeout.

## Type Ownership

| Type | Location | Purpose |
|------|----------|---------|
| `SeedanceVideoNodeDefinition` | `src/index.ts` | Node definition class |
| `ISeedanceVideoNodeDefinitionOptions` | `src/index.ts` | Constructor options |
| `SeedanceVideoRuntime` | `src/runtime.ts` | Video generation runtime |
| `ISeedanceVideoRuntimeOptions` | `src/runtime.ts` | Runtime constructor options |
| `ISeedanceGenerateVideoRequest` | `src/runtime.ts` | Video generation request contract |

## Public API Surface

- `SeedanceVideoNodeDefinition` — class
- `ISeedanceVideoNodeDefinitionOptions` — interface
- `ISeedanceGenerateVideoRequest`, `ISeedanceVideoRuntimeOptions` — re-exported types

## Extension Points

- Extends `AbstractNodeDefinition` and overrides `estimateCostWithConfig` and `executeWithConfig`.
- Constructor options: `apiKey`, `baseUrl`, `defaultModel`, `allowedModels`.
- Config schema: `model`, `durationSeconds`, `aspectRatio`, `seed`, `pollIntervalMs` (3s), `pollTimeoutMs` (180s), `baseCostUsd` (0.08).
- Environment variables: `BYTEDANCE_API_KEY` / `ARK_API_KEY`, `BYTEDANCE_BASE_URL`, `DAG_SEEDANCE_DEFAULT_MODEL`, `DAG_SEEDANCE_ALLOWED_MODELS`, `DAG_RUNTIME_BASE_URL`, `DAG_DEV_PORT`.

## Error Taxonomy

| Code | Layer | Description |
|------|-------|-------------|
| `DAG_VALIDATION_SEEDANCE_PROMPT_REQUIRED` | Validation | Prompt input is empty or missing |
| `DAG_VALIDATION_SEEDANCE_IMAGES_INVALID` | Validation | Images input is not a valid binary image list |
| `DAG_VALIDATION_SEEDANCE_MODEL_NOT_ALLOWED` | Validation | Selected model not in allowlist |
| `DAG_VALIDATION_BYTEDANCE_CONFIG_REQUIRED` | Validation | API key or base URL not configured |
| `DAG_VALIDATION_SEEDANCE_IMAGE_ASSET_NOT_FOUND` | Validation | Image asset fetch failed |
| `DAG_VALIDATION_SEEDANCE_IMAGE_MEDIA_TYPE_INVALID` | Validation | Image asset is not an image MIME type |
| `DAG_VALIDATION_SEEDANCE_IMAGE_REFERENCE_UNSUPPORTED` | Validation | Image URI scheme not supported |
| `DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_INVALID` | Execution | Runtime returned non-video output |
| `DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_MISSING` | Execution | Job completed without output reference |
| `DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_ASSET_INVALID` | Execution | Output asset missing valid assetId |
| `DAG_TASK_EXECUTION_SEEDANCE_OUTPUT_URI_INVALID` | Execution | Output URI reference missing |
| `DAG_TASK_EXECUTION_SEEDANCE_CREATE_FAILED` | Execution | Provider createVideo call failed |
| `DAG_TASK_EXECUTION_SEEDANCE_POLL_FAILED` | Execution | Provider getVideoJob poll failed |
| `DAG_TASK_EXECUTION_SEEDANCE_JOB_FAILED` | Execution | Job reached failed terminal state |
| `DAG_TASK_EXECUTION_SEEDANCE_JOB_CANCELLED` | Execution | Job was cancelled |
| `DAG_TASK_EXECUTION_SEEDANCE_TIMEOUT` | Execution | Polling exceeded timeout (retryable) |

## Test Strategy

- No test files exist yet. Coverage status: none.
- Recommended: unit tests with mocked `BytedanceProvider` for prompt validation, model allowlist, polling loop (success, failure, timeout), image input resolution, and output normalization.
- Recommended: verify terminal job states (`failed`, `cancelled`) produce non-retryable errors while timeout produces a retryable error.
