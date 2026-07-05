# Text to Image Node Specification

## Scope

- Owns the `text-to-image` DAG node definition.
- Generates a **new** image from a text prompt only (no input image) via the Gemini image API, emitting a binary image output.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- Distinct from `gemini-image-edit`/`gemini-image-compose`: those take one or more **input images** and edit/compose them. This node is pure generation — prompt in, image out, no binary input port.
- Delegates to `@robota-sdk/agent-provider/google` `GoogleProvider.generateImage({ prompt, model })` (already a required method on `IImageGenerationProvider`). The Google SDK (`@google/genai`) is a transitive concern of `agent-provider`, not a direct dependency.
- The DAG subsystem stays private; this package is `private: true`. Registered in the **async/optional** node-registry list (the Gemini SDK is an optional peer — the node self-skips if the provider cannot construct).

## Architecture Overview

- `TextToImageNodeDefinition` — node with a single `text` input port (string, required) and a single binary `image` output port (`IMAGE_COMMON` preset). `defaultInputPort='text'`, `defaultOutputPort='image'`.
- `TextToImageRuntime` — isolates provider/credential/model resolution and the API call from the node definition (mirrors `GeminiImageRuntime`, minus all input-image handling):
  - default model: `config.model` if non-empty, else `DAG_TEXT_TO_IMAGE_DEFAULT_MODEL` (required, else validation error).
  - allowed models: `DAG_TEXT_TO_IMAGE_ALLOWED_MODELS` (CSV); when non-empty the resolved model must be a member.
  - provider: constructed only when `GEMINI_API_KEY` is present; otherwise a `set_config`-style validation error.
  - calls `provider.generateImage({ prompt, model })`, takes the first output, and normalizes it to an `IPortBinaryValue` (`asset://` or `data:`/http image reference).
- Cost estimate: `config.baseCredits` (default 0.02).

## Type Ownership

| Type                         | Location                         | Purpose                                      |
| ---------------------------- | -------------------------------- | -------------------------------------------- |
| `TextToImageNodeDefinition`  | `src/index.ts`                   | Node definition class                        |
| `TextToImageConfigSchema`    | `src/index.ts`                   | Zod config schema                            |
| `TextToImageRuntime`         | `src/runtime-core.ts`            | Provider/model resolution + API call         |
| `ITextToImageRequest`        | `src/runtime-core.ts`            | `{ prompt, model }` runtime request          |
| `ITextToImageRuntimeOptions` | `src/runtime-core.ts`            | `{ apiKey?, defaultModel?, allowedModels? }` |
| `normalizeImageOutput`       | `src/image-output-normalizer.ts` | `IMediaOutputRef` → `IPortBinaryValue`       |

## Public API Surface

- `TextToImageNodeDefinition` — class
- `createTextToImageNodeDefinition()` — factory function
- `TextToImageConfigSchema` — Zod schema
- `TTextToImageConfig` — inferred config type
- `TextToImageRuntime`, `ITextToImageRequest`, `ITextToImageRuntimeOptions` — re-exported from the node module

## Extension Points

- Config `model`: overrides the default model for this node instance.
- Config `baseCredits`: base cost per successful generation.
- Env `DAG_TEXT_TO_IMAGE_DEFAULT_MODEL`, `DAG_TEXT_TO_IMAGE_ALLOWED_MODELS`, `GEMINI_API_KEY`.
- Error codes: `DAG_VALIDATION_TEXT_TO_IMAGE_PROMPT_REQUIRED`, `DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_REQUIRED`, `DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED`, `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED`, `DAG_TASK_EXECUTION_TEXT_TO_IMAGE_FAILED`, `DAG_TASK_EXECUTION_TEXT_TO_IMAGE_RESPONSE_MISSING_IMAGE`, `DAG_TASK_EXECUTION_TEXT_TO_IMAGE_OUTPUT_*`.
