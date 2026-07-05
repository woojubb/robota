# Seedance Video Node Specification

## Scope

- Owns the `seedance-video` DAG node definition.
- Generates a video from a text prompt via the ByteDance/ModelArk (Seedance) video API, emitting a binary video output.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- Delegates to `@robota-sdk/agent-provider/bytedance` `BytedanceProvider`, which implements `IVideoGenerationProvider` (`createVideo` → `getVideoJob` → `cancelVideoJob`). Video generation is an **asynchronous job**: submit, then poll until a terminal status.
- Distinct from the image nodes: image generation is a single synchronous provider call; this node runs a **poll loop** inside `executeWithConfig` until the job reaches `succeeded`/`failed`/`cancelled` or a max-wait timeout.
- The DAG subsystem stays private; this package is `private: true`. Registered in the **async/optional** node-registry list (the ByteDance provider is optional; the node self-skips if it cannot construct).
- Matches the existing `nodeType: "seedance-video"` used by pre-authored `.dag-storage` fixtures and the planned node in `packages/dag-nodes/docs/SPEC.md`.

## Architecture Overview

- `SeedanceVideoNodeDefinition` — node with a single `text` input port (string, required) and a single binary `video` output port (`VIDEO_MP4` preset). `defaultInputPort='text'`, `defaultOutputPort='video'`.
- `SeedanceVideoRuntime.generateVideo(request)` — isolates provider/credential/model resolution and the submit→poll job loop:
  - default model: `config.model` if non-empty, else `DAG_SEEDANCE_VIDEO_DEFAULT_MODEL` (required, else validation error).
  - allowed models: `DAG_SEEDANCE_VIDEO_ALLOWED_MODELS` (CSV); when non-empty the resolved model must be a member.
  - provider: constructed only when both `SEEDANCE_API_KEY` and `SEEDANCE_BASE_URL` are present; otherwise a validation error.
  - `createVideo({ prompt, model, durationSeconds?, aspectRatio? })` → `jobId`; then poll `getVideoJob(jobId)` every `pollIntervalMs` until terminal or `maxWaitMs` elapsed.
  - `succeeded` + `output` → `normalizeVideoOutput` → `IPortBinaryValue` (`kind:'video'`). `failed`/`cancelled` → task-execution error. Timeout → best-effort `cancelVideoJob` + task-execution error.
  - `seed` is intentionally NOT exposed (the ModelArk Seedance provider rejects it).
- A `sleep` function is injectable via runtime options for deterministic tests (defaults to a `setTimeout`-based delay).
- Cost estimate: `config.baseCredits` (default 0.5).

## Type Ownership

| Type                           | Location                         | Purpose                                                                        |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------ |
| `SeedanceVideoNodeDefinition`  | `src/index.ts`                   | Node definition class                                                          |
| `SeedanceVideoConfigSchema`    | `src/index.ts`                   | Zod config schema                                                              |
| `SeedanceVideoRuntime`         | `src/runtime-core.ts`            | Provider/model resolution + poll loop                                          |
| `ISeedanceVideoRequest`        | `src/runtime-core.ts`            | `{ prompt, model, durationSeconds?, aspectRatio?, pollIntervalMs, maxWaitMs }` |
| `ISeedanceVideoRuntimeOptions` | `src/runtime-core.ts`            | `{ apiKey?, baseUrl?, defaultModel?, allowedModels?, sleep? }`                 |
| `normalizeVideoOutput`         | `src/video-output-normalizer.ts` | `IMediaOutputRef` → `IPortBinaryValue` (video)                                 |

## Public API Surface

- `SeedanceVideoNodeDefinition` — class
- `createSeedanceVideoNodeDefinition()` — factory function
- `SeedanceVideoConfigSchema` — Zod schema
- `TSeedanceVideoConfig` — inferred config type
- `SeedanceVideoRuntime`, `ISeedanceVideoRequest`, `ISeedanceVideoRuntimeOptions` — re-exported from the node module

## Extension Points

- Config `model`, `baseCredits`, `durationSeconds`, `aspectRatio`, `pollIntervalMs` (default 5000), `maxWaitMs` (default 300000).
- Env `SEEDANCE_API_KEY`, `SEEDANCE_BASE_URL`, `DAG_SEEDANCE_VIDEO_DEFAULT_MODEL`, `DAG_SEEDANCE_VIDEO_ALLOWED_MODELS`.
- Error codes: `DAG_VALIDATION_SEEDANCE_VIDEO_PROMPT_REQUIRED`, `DAG_VALIDATION_SEEDANCE_VIDEO_MODEL_REQUIRED`, `DAG_VALIDATION_SEEDANCE_VIDEO_MODEL_NOT_ALLOWED`, `DAG_VALIDATION_SEEDANCE_VIDEO_CREDENTIALS_REQUIRED`, `DAG_TASK_EXECUTION_SEEDANCE_VIDEO_CREATE_FAILED`, `DAG_TASK_EXECUTION_SEEDANCE_VIDEO_POLL_FAILED`, `DAG_TASK_EXECUTION_SEEDANCE_VIDEO_JOB_FAILED`, `DAG_TASK_EXECUTION_SEEDANCE_VIDEO_TIMEOUT`, `DAG_TASK_EXECUTION_SEEDANCE_VIDEO_OUTPUT_*`.
