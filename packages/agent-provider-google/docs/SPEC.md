# Google Specification

## Scope

- Owns the Google AI (Gemini) provider integration for Robota SDK.
- Implements `AbstractAIProvider` from `@robota-sdk/agent-core` to provide Gemini model access through the Google Generative AI SDK.
- Implements `IImageGenerationProvider` from `@robota-sdk/agent-core` to provide image generation, editing, and composition capabilities.
- Owns Google-specific message format conversion (universal to/from Gemini wire format), including multipart content with inline image data.
- Owns Google-specific tool call format conversion (`functionDeclarations`-based tools).
- Owns provider option types (`IGoogleProviderOptions`, `TGoogleProviderOptionValue`).
- Owns Google AI API type definitions for messages, requests, responses, streaming, tools, safety ratings, and errors.
- Owns response modality logic (TEXT, IMAGE) and image-capable model validation.

## Boundaries

- Does not own generic agent orchestration, message types, or provider abstractions; those belong to `@robota-sdk/agent-core`.
- Does not own executor contracts (`IExecutor`); imports them from `@robota-sdk/agent-core`.
- Does not own `TUniversalMessage`, `IChatOptions`, `IToolSchema`, `IAssistantMessage`, `IUserMessage`, `ISystemMessage`, `IToolMessage`, `TUniversalMessagePart`, or image generation interfaces; imports them from `@robota-sdk/agent-core`.
- Does not own session management, team collaboration, or workflow concerns.
- Keeps all Google-specific transport behavior explicit and provider-scoped.

## Architecture Overview

The package follows a provider-adapter pattern with additional image generation support:

1. **`GoogleProvider`** (`provider.ts`) -- the primary class. Extends `AbstractAIProvider` and implements `IImageGenerationProvider`. Provides `chat()`, `chatStream()`, `generateImage()`, `editImage()`, `composeImage()`, `supportsTools()`, `validateConfig()`, and `dispose()`. Converts between `TUniversalMessage` (including multipart with inline images) and Gemini `contents` format. Supports both direct API execution (via `@google/generative-ai` SDK) and delegated execution (via `IExecutor`).

2. **Types layer** (`types.ts`, `types/api-types.ts`) -- provider option interface and Google AI-specific API type definitions covering content, requests, responses, streaming, tools, safety ratings, citation metadata, and errors.

3. **Entry point** (`index.ts`) -- re-exports `provider.ts` and `types.ts`.

Key internal methods:

- `convertToGeminiFormat()` -- maps `TUniversalMessage[]` to Gemini `contents` array, handling user, assistant (model), tool, and system roles. Supports `parts`-based messages with text and inline image data.
- `convertFromGeminiResponse()` -- extracts text parts, inline image parts, and function calls from Gemini candidates into `TUniversalMessage` with `parts` array.
- `buildResponseModalities()` -- determines whether to request TEXT, IMAGE, or both based on chat options, input message content, and provider defaults.
- `buildGenerationConfig()` -- constructs generation config including modality validation against image-capable models.
- `runImageRequest()` -- shared execution path for `generateImage()`, `editImage()`, and `composeImage()`, delegating to `chat()` with IMAGE modality.
- `mapImageInputSourceToPart()` -- validates and converts image input sources (inline or data URI) to `TUniversalMessagePart`.

Dependency direction: `@robota-sdk/agent-provider-google` depends on `@robota-sdk/agent-core` (peer dependency) and `@google/generative-ai` (direct dependency). No other workspace packages are imported.

## Type Ownership

| Type                                  | Owner                               | Location                 |
| ------------------------------------- | ----------------------------------- | ------------------------ |
| `IGoogleProviderOptions`              | `@robota-sdk/agent-provider-google` | `src/types.ts`           |
| `TGoogleProviderOptionValue`          | `@robota-sdk/agent-provider-google` | `src/types.ts`           |
| `IGoogleModelConfig`                  | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleGenerateContentRequest`       | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleStreamGenerateContentRequest` | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleContent`                      | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGooglePart`                         | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleFunctionCall`                 | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleFunctionResponse`             | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleTool`                         | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleFunctionDeclaration`          | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleFunctionParameters`           | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGooglePropertySchema`               | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleGenerateContentResponse`      | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleCandidate`                    | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `TGoogleFinishReason`                 | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleSafetyRating`                 | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `TGoogleHarmCategory`                 | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `TGoogleHarmProbability`              | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleCitationMetadata`             | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleCitationSource`               | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGooglePromptFeedback`               | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `TGoogleBlockReason`                  | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleUsageMetadata`                | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleStreamChunk`                  | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleError`                        | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleErrorDetail`                  | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleLogData`                      | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleToolCall`                     | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleMessageConversionResult`      | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `IGoogleStreamContext`                | `@robota-sdk/agent-provider-google` | `src/types/api-types.ts` |
| `GoogleProvider`                      | `@robota-sdk/agent-provider-google` | `src/provider.ts`        |

Imported from `@robota-sdk/agent-core` (not owned): `AbstractAIProvider`, `TUniversalMessage`, `IChatOptions`, `IToolSchema`, `IAssistantMessage`, `IUserMessage`, `ISystemMessage`, `IToolMessage`, `TUniversalMessagePart`, `IImageGenerationProvider`, `IImageGenerationRequest`, `IImageEditRequest`, `IImageComposeRequest`, `IImageGenerationResult`, `IMediaOutputRef`, `TProviderMediaResult`, `IExecutor`, `TProviderOptionValueBase`.

## Public API Surface

| Export                                      | Kind                        | Source                   | Description                                                                                                                                                                                                                                     |
| ------------------------------------------- | --------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GoogleProvider`                            | class                       | `src/provider.ts`        | Google Gemini provider implementing `AbstractAIProvider` and `IImageGenerationProvider`. Methods: `chat()`, `chatStream()`, `generateImage()`, `editImage()`, `composeImage()`, `supportsTools()`, `validateConfig()`, `dispose()`.             |
| `IGoogleProviderOptions`                    | interface                   | `src/types.ts`           | Configuration options for constructing `GoogleProvider`. Fields: `apiKey` (required), `responseMimeType`, `responseSchema`, `defaultResponseModalities`, `imageCapableModels`, `executor`, plus index signature.                                |
| `TGoogleProviderOptionValue`                | type alias                  | `src/types.ts`           | Union type for valid provider option values.                                                                                                                                                                                                    |
| ~~All types from `src/types/api-types.ts`~~ | interfaces/types (internal) | `src/types/api-types.ts` | Google AI API type definitions (content, requests, responses, tools, safety, streaming, errors). **Not exported** — these types are internal-only and are not part of the public API surface. `src/types.ts` does not re-export `api-types.ts`. |

## Extension Points

- **Executor injection**: The provider accepts an `IExecutor` via `IGoogleProviderOptions.executor`, enabling delegation of chat operations to local or remote executors without modifying the provider.
- **Response modalities configuration**: `IGoogleProviderOptions.defaultResponseModalities` allows default modality configuration (TEXT, IMAGE). Per-request overrides are available via `IChatOptions.google.responseModalities`.
- **Image-capable model allowlist**: `IGoogleProviderOptions.imageCapableModels` overrides the default model-name heuristic for image capability detection.
- **Response format configuration**: `responseMimeType` and `responseSchema` options allow requesting structured JSON output from Gemini.
- **AbstractAIProvider contract**: New lifecycle or capability methods added to `AbstractAIProvider` in `@robota-sdk/agent-core` can be overridden in `GoogleProvider`.

## Error Taxonomy

| Error Condition                                  | Thrown By                        | Message Pattern                                                                              |
| ------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------- |
| Client unavailable during direct execution       | `chat()`, `chatStream()`         | `"Google client not available. Either provide apiKey or use an executor."`                   |
| Missing model in chat options                    | `chat()`, `chatStream()`         | `"Model is required in IChatOptions. Please specify a model in defaultModel configuration."` |
| No candidate in response                         | `convertFromGeminiResponse()`    | `"No candidate in Gemini response"`                                                          |
| No content in response                           | `convertFromGeminiResponse()`    | `"No content in Gemini response"`                                                            |
| Unsupported image URI parts                      | `mapMessagePartsToGeminiParts()` | `"Google provider does not support image URI parts directly: <uri>"`                         |
| Non-image-capable model with IMAGE modality      | `buildGenerationConfig()`        | `"Selected model \"<model>\" is not configured as image-capable for Google provider."`       |
| IMAGE modality in streaming                      | `chatStream()`                   | `"Google provider does not support streaming image modality responses."`                     |
| Missing image in response when IMAGE requested   | `chat()`                         | `"Gemini response did not include an image part while IMAGE modality was requested."`        |
| Chat failure (wraps all direct execution errors) | `chat()`                         | `"Google chat failed: <message>"`                                                            |
| Stream failure (wraps all streaming errors)      | `chatStream()`                   | `"Google stream failed: <message>"`                                                          |
| Empty prompt for image generation                | `generateImage()`                | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`         |
| Empty model for image generation                 | `generateImage()`                | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`         |
| Empty prompt for image edit                      | `editImage()`                    | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`         |
| Empty model for image edit                       | `editImage()`                    | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`         |
| Invalid inline image source                      | `mapImageInputSourceToPart()`    | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`         |
| Non-data-URI image source                        | `mapImageInputSourceToPart()`    | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`         |
| Invalid data URI format                          | `mapImageInputSourceToPart()`    | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`         |
| Fewer than 2 images for compose                  | `composeImage()`                 | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`         |
| Upstream image generation failure                | `runImageRequest()`              | Result: `{ ok: false, error: { code: 'PROVIDER_UPSTREAM_ERROR', message: '...' } }`          |

Note: Image generation methods (`generateImage`, `editImage`, `composeImage`) return `TProviderMediaResult` (a discriminated union with `ok: true | false`) rather than throwing. Chat methods throw errors directly.

Google API errors are defined in `IGoogleError` with numeric `code`, string `status`, and optional `details` array.

## Class Contract Registry

### Interface Implementations

| Interface                  | Implementor      | Kind       | Location          |
| -------------------------- | ---------------- | ---------- | ----------------- |
| `IImageGenerationProvider` | `GoogleProvider` | production | `src/provider.ts` |

### Inheritance Chains

| Base (Owner)                  | Derived          | Location          | Notes                          |
| ----------------------------- | ---------------- | ----------------- | ------------------------------ |
| `AbstractAIProvider` (agents) | `GoogleProvider` | `src/provider.ts` | Provider with image generation |

### Cross-Package Port Consumers

| Port (Owner)                        | Adapter          | Location          |
| ----------------------------------- | ---------------- | ----------------- |
| `AbstractAIProvider` (agents)       | `GoogleProvider` | `src/provider.ts` |
| `IImageGenerationProvider` (agents) | `GoogleProvider` | `src/provider.ts` |

## Test Strategy

- **Current state**: Four test files exist covering image operations, message conversion, and extended provider behavior.
  - `src/provider.spec.ts` — image-related functionality
  - `src/image-operations.test.ts` — image generation, edit, and compose operations
  - `src/message-converter.test.ts` — message format conversion utilities
  - `src/provider-extended.test.ts` — extended provider behavior and edge cases
- **Existing test coverage**:
  - Inline image output mapping from Gemini response to assistant `parts`.
  - Inline image input parts mapped correctly into Gemini `inlineData` request parts.
  - Error when IMAGE modality is requested with a non-image-capable model.
  - Error when `image_uri` message part type is used directly.
- **Recommended additional coverage**:
  - Unit tests for `GoogleProvider` constructor validation (apiKey vs executor).
  - Unit tests for text-only message format conversion (`convertToGeminiFormat`) across all roles (user, assistant, system, tool).
  - Unit tests for `convertFromGeminiResponse()` with function calls and usage metadata.
  - Unit tests for tool schema conversion (`convertToolsToGeminiFormat`).
  - Unit tests for `generateImage()`, `editImage()`, and `composeImage()` input validation (empty prompt, empty model, too few images).
  - Unit tests for `mapImageInputSourceToPart()` with various source types and edge cases.
  - Unit tests for `buildResponseModalities()` logic (option override, image input detection, default fallback).
  - Unit tests for `chatStream()` with mocked streaming responses.
  - Unit tests for `validateConfig()`.
- **Framework**: Vitest (configured in workspace).
- **Test commands**: `pnpm test`, `pnpm test:watch`, `pnpm test:coverage`.
- **Scenario verification**: `pnpm scenario:verify`, `pnpm scenario:record` (image dry-run scenarios).
