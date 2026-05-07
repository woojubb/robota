# Gemini Provider Specification

## Scope

- Owns the Google Gemini API provider integration for Robota SDK.
- Implements `AbstractAIProvider` from `@robota-sdk/agent-core` to provide Gemini model access through the Google GenAI SDK.
- Exposes `createGeminiProviderDefinition()` so CLI/SDK composition can select canonical provider type `gemini` while accepting `google` as a compatibility alias.
- Implements `IImageGenerationProvider` from `@robota-sdk/agent-core` to provide image generation, editing, and composition capabilities.
- Owns Google-specific message format conversion (universal to/from Gemini wire format), including multipart content with inline image data.
- Owns Google-specific tool call format conversion (`functionDeclarations`-based tools and `functionResponse` tool results).
- Owns provider option types (`IGeminiProviderOptions`, `TGeminiProviderOptionValue`).
- Owns Google AI API type definitions for messages, requests, responses, streaming, tools, safety ratings, and errors.
- Owns response modality logic (TEXT, IMAGE) and image-capable model validation.
- Owns direct Gemini request config assembly for system instructions, structured output, safety settings, thinking config, abort signal, and provider default model fallback.

## Boundaries

- Does not own generic agent orchestration, message types, or provider abstractions; those belong to `@robota-sdk/agent-core`.
- Does not own executor contracts (`IExecutor`); imports them from `@robota-sdk/agent-core`.
- Does not own `TUniversalMessage`, `IChatOptions`, `IToolSchema`, `IAssistantMessage`, `IUserMessage`, `ISystemMessage`, `IToolMessage`, `TUniversalMessagePart`, or image generation interfaces; imports them from `@robota-sdk/agent-core`.
- Does not own session management, team collaboration, or workflow concerns.
- Keeps all Google-specific transport behavior explicit and provider-scoped.
- Owns provider-native replay payload selection for Google GenAI `models.generateContent` and `models.generateContentStream`. Generic layers receive only the `IChatOptions.onProviderNativeRawPayload` callback contract and must not import Google GenAI SDK types.

## Architecture Overview

The package follows a provider-adapter pattern with additional image generation support:

1. **`GeminiProvider`** (`provider.ts`) -- the primary class. Extends `AbstractAIProvider` and implements `IImageGenerationProvider`. Provides `chat()`, `chatStream()`, `generateImage()`, `editImage()`, `composeImage()`, `supportsTools()`, `validateConfig()`, and `dispose()`. Converts between `TUniversalMessage` (including multipart with inline images) and Gemini `contents` format. Supports both direct API execution via `@google/genai` and delegated execution via `IExecutor`.

2. **Types layer** (`types.ts`, `types/api-types.ts`) -- provider option interface and Google AI-specific API type definitions covering content, requests, responses, streaming, tools, safety ratings, citation metadata, and errors.

3. **Provider definition** (`provider-definition.ts`) -- exposes canonical `type: "gemini"`, compatibility alias `google`, setup metadata, official setup help links, defaults, and concrete provider construction through the common `IProviderDefinition` contract.

4. **Entry point** (`index.ts`) -- re-exports `provider.ts`, `provider-definition.ts`, and `types.ts`.

Key internal methods:

- `convertToGeminiRequestFormat()` -- maps `TUniversalMessage[]` to Gemini `contents` plus request-level `systemInstruction`. User and assistant messages become `user`/`model` contents, tool messages become `functionResponse` parts, and system messages become `config.systemInstruction`.
- `convertToGeminiFormat()` -- compatibility helper that returns only Gemini `contents` from `convertToGeminiRequestFormat()`.
- `convertFromGeminiResponse()` -- extracts text parts, inline image parts, and function calls from Gemini candidates into `TUniversalMessage` with `parts` array.
- `buildResponseModalities()` -- determines whether to request TEXT, IMAGE, or both based on chat options, input message content, and provider defaults.
- `buildGenerationConfig()` -- constructs Gemini request `config`, including modality validation, temperature/max token settings, provider/per-request safety settings, structured output settings, thinking config, tool config, and abort signal.
- `runImageRequest()` -- shared execution path for `generateImage()`, `editImage()`, and `composeImage()`, delegating to `chat()` with IMAGE modality.
- `mapImageInputSourceToPart()` -- validates and converts image input sources (inline or data URI) to `TUniversalMessagePart`.

Dependency direction: `@robota-sdk/agent-provider-gemini` depends on `@robota-sdk/agent-core` (peer dependency) and `@google/genai` (direct dependency). No other workspace packages are imported.

## Type Ownership

| Type                                  | Owner                               | Location                     |
| ------------------------------------- | ----------------------------------- | ---------------------------- |
| `IGeminiProviderOptions`              | `@robota-sdk/agent-provider-gemini` | `src/types.ts`               |
| `TGeminiProviderOptionValue`          | `@robota-sdk/agent-provider-gemini` | `src/types.ts`               |
| `IGeminiSafetySetting`                | `@robota-sdk/agent-provider-gemini` | `src/types.ts`               |
| `IGeminiThinkingConfig`               | `@robota-sdk/agent-provider-gemini` | `src/types.ts`               |
| `IGoogleModelConfig`                  | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleGenerateContentRequest`       | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleStreamGenerateContentRequest` | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleContent`                      | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGooglePart`                         | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleFunctionCall`                 | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleFunctionResponse`             | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleTool`                         | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleFunctionDeclaration`          | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleFunctionParameters`           | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGooglePropertySchema`               | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleGenerateContentResponse`      | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleCandidate`                    | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `TGoogleFinishReason`                 | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleSafetyRating`                 | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `TGoogleHarmCategory`                 | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `TGoogleHarmProbability`              | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleCitationMetadata`             | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleCitationSource`               | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGooglePromptFeedback`               | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `TGoogleBlockReason`                  | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleUsageMetadata`                | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleStreamChunk`                  | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleError`                        | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleErrorDetail`                  | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleLogData`                      | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleToolCall`                     | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleMessageConversionResult`      | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `IGoogleStreamContext`                | `@robota-sdk/agent-provider-gemini` | `src/types/api-types.ts`     |
| `GeminiProvider`                      | `@robota-sdk/agent-provider-gemini` | `src/provider.ts`            |
| `createGeminiProviderDefinition`      | `@robota-sdk/agent-provider-gemini` | `src/provider-definition.ts` |

Imported from `@robota-sdk/agent-core` (not owned): `AbstractAIProvider`, `TUniversalMessage`, `IChatOptions`, `IToolSchema`, `IAssistantMessage`, `IUserMessage`, `ISystemMessage`, `IToolMessage`, `TUniversalMessagePart`, `IImageGenerationProvider`, `IImageGenerationRequest`, `IImageEditRequest`, `IImageComposeRequest`, `IImageGenerationResult`, `IMediaOutputRef`, `TProviderMediaResult`, `IExecutor`, `TProviderOptionValueBase`.

## Public API Surface

| Export                                      | Kind                        | Source                       | Description                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | --------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GeminiProvider`                            | class                       | `src/provider.ts`            | Google Gemini provider implementing `AbstractAIProvider` and `IImageGenerationProvider`. Methods: `chat()`, `chatStream()`, `generateImage()`, `editImage()`, `composeImage()`, `supportsTools()`, `validateConfig()`, `dispose()`.                                                                      |
| `createGeminiProviderDefinition`            | function                    | `src/provider-definition.ts` | Returns an `IProviderDefinition` with canonical type `gemini`, compatibility alias `google`, Gemini setup prompts, and official setup help links.                                                                                                                                                        |
| `DEFAULT_GEMINI_PROVIDER_MODEL`             | const                       | `src/provider-definition.ts` | Default CLI/setup model for Gemini provider profiles.                                                                                                                                                                                                                                                    |
| `IGeminiProviderOptions`                    | interface                   | `src/types.ts`               | Configuration options for constructing `GeminiProvider`. Fields: `apiKey` (required), `defaultModel`, `responseMimeType`, `responseSchema`, `responseJsonSchema`, `safetySettings`, `thinkingConfig`, `toolConfig`, `defaultResponseModalities`, `imageCapableModels`, `executor`, plus index signature. |
| `TGeminiProviderOptionValue`                | type alias                  | `src/types.ts`               | Union type for valid provider option values.                                                                                                                                                                                                                                                             |
| ~~All types from `src/types/api-types.ts`~~ | interfaces/types (internal) | `src/types/api-types.ts`     | Google AI API type definitions (content, requests, responses, tools, safety, streaming, errors). **Not exported** — these types are internal-only and are not part of the public API surface. `src/types.ts` does not re-export `api-types.ts`.                                                          |

## Extension Points

- **Executor injection**: The provider accepts an `IExecutor` via `IGeminiProviderOptions.executor`, enabling delegation of chat operations to local or remote executors without modifying the provider.
- **Default model fallback**: `IGeminiProviderOptions.defaultModel` is used by direct `chat()` and `chatStream()` calls when request options do not provide a model. Robota-level model configuration remains the primary runtime path.
- **Response modalities configuration**: `IGeminiProviderOptions.defaultResponseModalities` allows default modality configuration (TEXT, IMAGE). Per-request overrides are available via `IChatOptions.google.responseModalities`.
- **Image-capable model allowlist**: `IGeminiProviderOptions.imageCapableModels` overrides the default model-name heuristic for image capability detection.
- **Response format configuration**: `responseMimeType`, `responseSchema`, and `responseJsonSchema` options allow requesting structured JSON output from Gemini. `responseSchema` and `responseJsonSchema` are mutually exclusive.
- **Safety and thinking configuration**: `safetySettings` and `thinkingConfig` are passed through to Gemini request config. Per-request `IChatOptions.google.safetySettings` overrides provider-level safety defaults.
- **AbstractAIProvider contract**: New lifecycle or capability methods added to `AbstractAIProvider` in `@robota-sdk/agent-core` can be overridden in `GeminiProvider`.
- **Provider definition composition**: Consumers such as `agent-cli` can inject `createGeminiProviderDefinition()` alongside other provider definitions. Generic CLI/SDK code resolves `gemini` and alias `google` through `IProviderDefinition`, not hardcoded provider-name branches.

### Native Replay Payload Capture

When `IChatOptions.onProviderNativeRawPayload` is provided, `GeminiProvider` emits provider-native payload events before normalization:

- `payloadKind: "request"` for the exact `GenerateContentParameters` request sent to `models.generateContent` or `models.generateContentStream`.
- `payloadKind: "response"` for non-streaming `GenerateContentResponse` values.
- `payloadKind: "stream_event"` for each streaming `GenerateContentResponse` chunk.

The concrete provider instance owns the `provider` label, so the deprecated `GoogleProvider` compatibility subclass emits `provider: "google"` while sharing Gemini transport behavior. Core/session/CLI layers must treat payloads as opaque and rely on session logging for redaction/externalization.

## Error Taxonomy

| Error Condition                                   | Thrown By                        | Message Pattern                                                                                    |
| ------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| Client unavailable during direct execution        | `chat()`, `chatStream()`         | `"Google client not available. Either provide apiKey or use an executor."`                         |
| Missing model in chat options and provider config | `chat()`, `chatStream()`         | `"Model is required in chat options. Please specify a model in defaultModel configuration."`       |
| Mutually exclusive structured output schemas      | `buildGenerationConfig()`        | `"Gemini structured output options responseSchema and responseJsonSchema are mutually exclusive."` |
| Tool message missing function name                | `convertToGeminiFormat()`        | `"Google provider tool message requires a function name."`                                         |
| No candidate in response                          | `convertFromGeminiResponse()`    | `"No candidate in Gemini response"`                                                                |
| No content in response                            | `convertFromGeminiResponse()`    | `"No content in Gemini response"`                                                                  |
| Unsupported image URI parts                       | `mapMessagePartsToGeminiParts()` | `"Google provider does not support image URI parts directly: <uri>"`                               |
| Non-image-capable model with IMAGE modality       | `buildGenerationConfig()`        | `"Selected model \"<model>\" is not configured as image-capable for Google provider."`             |
| IMAGE modality in streaming                       | `chatStream()`                   | `"Google provider does not support streaming image modality responses."`                           |
| Missing image in response when IMAGE requested    | `chat()`                         | `"Gemini response did not include an image part while IMAGE modality was requested."`              |
| Chat failure (wraps all direct execution errors)  | `chat()`                         | `"Google chat failed: <message>"`                                                                  |
| Stream failure (wraps all streaming errors)       | `chatStream()`                   | `"Google stream failed: <message>"`                                                                |
| Empty prompt for image generation                 | `generateImage()`                | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`               |
| Empty model for image generation                  | `generateImage()`                | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`               |
| Empty prompt for image edit                       | `editImage()`                    | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`               |
| Empty model for image edit                        | `editImage()`                    | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`               |
| Invalid inline image source                       | `mapImageInputSourceToPart()`    | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`               |
| Non-data-URI image source                         | `mapImageInputSourceToPart()`    | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`               |
| Invalid data URI format                           | `mapImageInputSourceToPart()`    | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`               |
| Fewer than 2 images for compose                   | `composeImage()`                 | Result: `{ ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message: '...' } }`               |
| Upstream image generation failure                 | `runImageRequest()`              | Result: `{ ok: false, error: { code: 'PROVIDER_UPSTREAM_ERROR', message: '...' } }`                |

Note: Image generation methods (`generateImage`, `editImage`, `composeImage`) return `TProviderMediaResult` (a discriminated union with `ok: true | false`) rather than throwing. Chat methods throw errors directly.

Google API errors are defined in `IGoogleError` with numeric `code`, string `status`, and optional `details` array.

## Class Contract Registry

### Interface Implementations

| Interface                  | Implementor      | Kind       | Location          |
| -------------------------- | ---------------- | ---------- | ----------------- |
| `IImageGenerationProvider` | `GeminiProvider` | production | `src/provider.ts` |

### Inheritance Chains

| Base (Owner)                  | Derived          | Location          | Notes                          |
| ----------------------------- | ---------------- | ----------------- | ------------------------------ |
| `AbstractAIProvider` (agents) | `GeminiProvider` | `src/provider.ts` | Provider with image generation |

### Cross-Package Port Consumers

| Port (Owner)                        | Adapter                          | Location                     |
| ----------------------------------- | -------------------------------- | ---------------------------- |
| `AbstractAIProvider` (agents)       | `GeminiProvider`                 | `src/provider.ts`            |
| `IImageGenerationProvider` (agents) | `GeminiProvider`                 | `src/provider.ts`            |
| `IProviderDefinition` (agent-core)  | `createGeminiProviderDefinition` | `src/provider-definition.ts` |

## Test Strategy

- **Current state**: Four test files exist covering image operations, message conversion, and extended provider behavior.
  - `src/provider.spec.ts` — image-related functionality
  - `src/image-operations.test.ts` — image generation, edit, and compose operations
  - `src/message-converter.test.ts` — message format conversion utilities
  - `src/provider-definition.test.ts` — provider definition defaults, aliases, and construction behavior
  - `src/provider-extended.test.ts` — extended provider behavior and edge cases
- **Existing test coverage**:
  - Inline image output mapping from Gemini response to assistant `parts`.
  - Inline image input parts mapped correctly into Gemini `inlineData` request parts.
  - Error when IMAGE modality is requested with a non-image-capable model.
  - Error when `image_uri` message part type is used directly.
  - Provider definition exposes canonical `gemini`, compatibility alias `google`, setup defaults, and clear missing-key errors.
  - Text-only message format conversion across user, assistant, system, and tool roles.
  - System message conversion to `config.systemInstruction`.
  - Tool schema conversion to `functionDeclarations` and tool-result conversion to `functionResponse`.
  - Structured output config, safety setting override, and model fallback behavior.
  - `chatStream()` and `chat()` streaming assembly via `onTextDelta`.
  - `validateConfig()` for direct client and executor paths.
- **Framework**: Vitest (configured in workspace).
- **Test commands**: `pnpm test`, `pnpm test:watch`, `pnpm test:coverage`.
- **Scenario verification**: `pnpm scenario:verify`, `pnpm scenario:record` (image dry-run scenarios).

## Modernization Notes

Official Gemini documentation recommends the Google GenAI SDK (`@google/genai`) and marks the legacy JavaScript SDK (`@google/generative-ai`) as not actively maintained. Direct Gemini transport uses `GoogleGenAI` and the `models.generateContent` / `models.generateContentStream` APIs. Request generation options, system instructions, tools, safety settings, structured output, and thinking controls are sent through the `config` property, not the legacy `generationConfig` request property.

Research sources used for this modernization:

- Gemini text generation docs: `https://ai.google.dev/gemini-api/docs/text-generation`
- Gemini API reference: `https://ai.google.dev/api`
- Gemini function calling docs: `https://ai.google.dev/gemini-api/docs/function-calling`
- Gemini structured output docs: `https://ai.google.dev/gemini-api/docs/structured-output`
- Gemini image generation docs: `https://ai.google.dev/gemini-api/docs/image-generation`
- Gemini safety settings docs: `https://ai.google.dev/gemini-api/docs/safety-settings`
- Gemini troubleshooting and rate limit docs: `https://ai.google.dev/gemini-api/docs/troubleshooting`, `https://ai.google.dev/gemini-api/docs/rate-limits`
