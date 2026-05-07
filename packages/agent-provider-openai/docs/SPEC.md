# OpenAI Package Specification

## Scope

- Owns the OpenAI provider integration for Robota, including Responses API model access, streaming support, tool/function calling, structured outputs, multimodal input conversion, and provider-bound request/response adaptation.
- Owns the OpenAI-branded provider shell, provider definition, payload logging, and public compatibility wrappers.
- Composes `@robota-sdk/agent-provider-openai-compatible` for reusable Chat Completions message conversion, response parsing, stream assembly, and OpenAI-compatible endpoint probing.
- Owns payload logging infrastructure with environment-specific implementations (Node.js file-based, browser console-based).
- Owns OpenAI-specific API type definitions for Responses request parameters, streaming events, output items, tool calls, structured output config, and error structures.
- Supports OpenAI-compatible Chat Completions endpoints only as an explicit compatibility mode through `apiSurface: "chat-completions"` or implicit `baseURL` usage.
- Does not own Gemma-family chat-template marker projection; Gemma local models must use `agent-provider-gemma`.

## Boundaries

- Does not own generic agent orchestration contracts, executor abstractions, or universal message types -- those belong to `@robota-sdk/agent-core`.
- Does not own session management, conversation history, or tool execution logic.
- Keeps OpenAI-specific transport behavior explicit and provider-scoped.
- Keeps OpenAI-compatible transport primitives model-neutral; this package may consume them for Chat Completions compatibility, but OpenAI Responses semantics stay here.
- Owns provider-native replay payload selection for both Responses and Chat Completions surfaces. Generic layers receive only the `IChatOptions.onProviderNativeRawPayload` callback contract and must not import OpenAI SDK types.
- Relies on `AbstractAIProvider` from `@robota-sdk/agent-core` as the base class for provider implementation.
- Logger and executor interfaces (`ILogger`, `IExecutor`) are imported from `@robota-sdk/agent-core`, not redefined.

## Research

Official OpenAI documentation states that Responses is recommended for new projects while Chat Completions remains supported. Responses uses typed output items, semantic streaming events, internally tagged function tools, and `text.format` for Structured Outputs. Chat Completions keeps `messages`, `choices`, externally tagged function tools, and `response_format`. The provider therefore defaults official OpenAI calls to Responses and preserves Chat Completions for OpenAI-compatible `baseURL` profiles because many local/proxy endpoints implement only `/v1/chat/completions`.

Sources:

- <https://platform.openai.com/docs/guides/responses-vs-chat-completions>
- <https://platform.openai.com/docs/guides/chat-completions>
- <https://platform.openai.com/docs/api-reference/chat/create/>
- <https://platform.openai.com/docs/guides/structured-outputs>
- <https://platform.openai.com/docs/guides/function-calling>
- <https://platform.openai.com/docs/guides/streaming-responses>
- <https://platform.openai.com/docs/api-reference/models/list>
- <https://platform.openai.com/docs/guides/tools-web-search>
- <https://lmstudio.ai/docs/developer/openai-compat>
- <https://lmstudio.ai/docs/developer/openai-compat/tools>
- <https://platform.openai.com/docs/guides/rate-limits>
- <https://platform.openai.com/docs/guides/error-codes>

## Architecture Overview

### Layer Structure

```
  src/
  index.ts                          # Public API surface (re-exports)
  provider.ts                       # OpenAIProvider (extends AbstractAIProvider)
  provider-definition.ts            # provider definition for CLI/runtime composition
  model-catalog-refresh.ts          # provider-owned live model catalog refresh adapter
  adapter.ts                        # OpenAIConversationAdapter (static message conversion)
  chat-completions-chat.ts          # Chat Completions compatibility request/stream handling
  openai-request-format.ts          # Structured output request mapping for both API surfaces
  responses-chat.ts                 # Responses API request/stream orchestration
  responses-converter.ts            # Universal message/tool to Responses input/tool conversion
  responses-parser.ts               # Responses output/event to TUniversalMessage conversion
  responses-stream-utils.ts         # Abort-aware async stream helpers for Responses streaming
  responses-types.ts                # Provider-owned Responses API type contracts
  types.ts                          # Provider options and option value types
  types/
    api-types.ts                    # OpenAI-specific API type definitions
  interfaces/
    payload-logger.ts               # IPayloadLogger / IPayloadLoggerOptions contracts
  parsers/
    response-parser.ts              # OpenAIResponseParser (completion + streaming chunk parsing)
  streaming/
    stream-handler.ts               # OpenAIStreamHandler (modular streaming logic)
    stream-assembler.ts             # Assembles Chat Completions stream chunks into one TUniversalMessage
  loggers/
    index.ts                        # Logger barrel exports
    console.ts                      # Subpath entry: ConsolePayloadLogger
    file.ts                         # Subpath entry: FilePayloadLogger
    console-payload-logger.ts       # Browser console logger implementation
    file-payload-logger.ts          # Node.js file logger implementation
    sanitize-openai-log-data.ts     # SSOT sanitization utility for log data
```

### Design Patterns

- **Adapter pattern**: `OpenAIConversationAdapter` and `responses-converter.ts` convert `TUniversalMessage` into provider-native input formats.
- **Strategy pattern (logging)**: `IPayloadLogger` interface with two built-in implementations (`FilePayloadLogger`, `ConsolePayloadLogger`) and support for custom implementations.
- **Template method**: `OpenAIProvider` extends `AbstractAIProvider`, overriding `chat`, `chatStream`, `validateMessages`, `supportsTools`, `validateConfig`, and `dispose`.
- **Executor delegation**: When an `IExecutor` is provided, the provider delegates all chat operations to the executor instead of making direct OpenAI API calls, enabling remote execution.
- **Dependency injection**: Logger and payload logger are injected via constructor options. Defaults to `SilentLogger` when no logger is provided.
- **Provider definition**: `createOpenAIProviderDefinition()` exposes official OpenAI setup prompts, API key setup help links, and provider construction through the common `IProviderDefinition` contract so consumers do not branch on `type: "openai"`.

## Type Ownership

Types owned by this package (SSOT):

| Type                                        | Kind       | File                           | Description                                                                                  |
| ------------------------------------------- | ---------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `IOpenAIProviderOptions`                    | Interface  | `types.ts`                     | Constructor options for `OpenAIProvider`                                                     |
| `TOpenAIApiSurface`                         | Type alias | `types.ts`                     | Explicit API surface selector (`responses` or `chat-completions`)                            |
| `IOpenAIJsonSchemaDefinition`               | Interface  | `types.ts`                     | Structured output JSON Schema config                                                         |
| `IOpenAIResponsesReasoningOptions`          | Interface  | `types.ts`                     | Responses reasoning controls; hidden reasoning is never exposed as message content           |
| `IOpenAINativeWebToolsOptions`              | Interface  | `types.ts`                     | Provider-owned config shape for requested native web search/fetch behavior                   |
| `TOpenAIProviderOptionValue`                | Type alias | `types.ts`                     | Union of valid provider option value types                                                   |
| Responses request/input/output/event types  | Interfaces | `responses-types.ts`           | Provider-owned Responses API contracts used by converter/parser modules                      |
| `IOpenAIChatRequestParams`                  | Interface  | `types/api-types.ts`           | OpenAI chat completion request parameters                                                    |
| `IOpenAIStreamRequestParams`                | Interface  | `types/api-types.ts`           | OpenAI streaming request parameters (extends chat params)                                    |
| `IOpenAIToolCall`                           | Interface  | `types/api-types.ts`           | OpenAI tool call structure                                                                   |
| `IOpenAIAssistantMessage`                   | Interface  | `types/api-types.ts`           | OpenAI assistant message with optional tool calls                                            |
| `IOpenAIToolMessage`                        | Interface  | `types/api-types.ts`           | OpenAI tool response message                                                                 |
| `IOpenAIStreamDelta`                        | Interface  | `types/api-types.ts`           | Streaming chunk delta structure                                                              |
| `IOpenAIStreamChunk`                        | Interface  | `types/api-types.ts`           | Full streaming chunk structure                                                               |
| `IOpenAIError`                              | Interface  | `types/api-types.ts`           | OpenAI error structure for type-safe error handling                                          |
| `IOpenAILogData`                            | Interface  | `types/api-types.ts`           | Payload logging data structure                                                               |
| `IPayloadLogger`                            | Interface  | `interfaces/payload-logger.ts` | Contract for payload logger implementations                                                  |
| `IPayloadLoggerOptions`                     | Interface  | `interfaces/payload-logger.ts` | Configuration options for payload loggers                                                    |
| `DEFAULT_OPENAI_PROVIDER_MODEL`             | Constant   | `provider-definition.ts`       | Optional setup default model; currently undefined to keep this provider model-family neutral |
| `DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE` | Constant   | `provider-definition.ts`       | Default `$ENV:OPENAI_API_KEY` setup reference                                                |
| `refreshOpenAIModelCatalog`                 | Function   | `model-catalog-refresh.ts`     | Provider-owned live model catalog refresh adapter using the OpenAI Models API                |

Types imported from `@robota-sdk/agent-core` (not owned here):

| Type                       | Usage                                                      |
| -------------------------- | ---------------------------------------------------------- |
| `TUniversalMessage`        | Message format for chat/chatStream input and output        |
| `IAssistantMessage`        | Narrowed assistant message type with toolCalls             |
| `IChatOptions`             | Chat method options (model, temperature, maxTokens, tools) |
| `IToolCall`                | Universal tool call structure                              |
| `IToolSchema`              | Tool definition schema for function calling                |
| `IExecutor`                | Executor interface for delegated execution                 |
| `ILogger`                  | Logger interface for dependency-injected logging           |
| `TProviderOptionValueBase` | Base type for provider option values                       |
| `AbstractAIProvider`       | Base class for all AI providers                            |
| `SilentLogger`             | Default no-op logger                                       |

## Model Catalog Refresh

OpenAI provider definitions expose a provider-owned `refreshModelCatalog` hook. The hook queries the
OpenAI Models API through the effective provider profile and returns `IProviderModelCatalog` with
`status: "live"` when discovery succeeds. The hook returns `status: "unavailable"` with a message
when credentials, network access, or endpoint responses prevent discovery. SDK and command layers may
consume this hook, but the CLI/TUI must not hardcode OpenAI model lists or call OpenAI APIs directly.

## Public API Surface

### Main entry point (`@robota-sdk/agent-provider-openai`)

| Export                                      | Kind                  | Description                                                                                                     |
| ------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `OpenAIProvider`                            | Class                 | Primary provider class; extends `AbstractAIProvider`                                                            |
| `OpenAIConversationAdapter`                 | Class                 | Static utility for message format conversion                                                                    |
| `createOpenAIProviderDefinition`            | Function              | Returns `IProviderDefinition` with OpenAI setup prompts, official setup help links, and branch-free composition |
| `refreshOpenAIModelCatalog`                 | Function              | Queries the OpenAI Models API and returns an `IProviderModelCatalog`                                            |
| `DEFAULT_OPENAI_PROVIDER_MODEL`             | Constant              | Optional setup default model; currently undefined                                                               |
| `DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE` | Constant              | Default `$ENV:OPENAI_API_KEY` setup reference                                                                   |
| `IRefreshOpenAIModelCatalogOptions`         | Interface             | Optional testable fetch/time injection for catalog refresh                                                      |
| `IOpenAIProviderOptions`                    | Interface             | Provider constructor options                                                                                    |
| `TOpenAIApiSurface`                         | Type alias            | Provider API surface selector                                                                                   |
| `TOpenAIProviderOptionValue`                | Type alias            | Valid option value types                                                                                        |
| `IPayloadLogger`                            | Interface (type-only) | Payload logger contract                                                                                         |
| `IPayloadLoggerOptions`                     | Interface (type-only) | Payload logger configuration                                                                                    |
| All exports from `types.ts`                 | Mixed                 | Provider options and value types                                                                                |
| All exports from `adapter.ts`               | Class                 | Conversation adapter                                                                                            |
| All exports from `model-catalog-refresh.ts` | Mixed                 | OpenAI model catalog refresh adapter and helper contracts                                                       |

### Subpath entry points

| Subpath                                             | Export                 | Description                          |
| --------------------------------------------------- | ---------------------- | ------------------------------------ |
| `@robota-sdk/agent-provider-openai/loggers/file`    | `FilePayloadLogger`    | Node.js file-based payload logger    |
| `@robota-sdk/agent-provider-openai/loggers/console` | `ConsolePayloadLogger` | Browser console-based payload logger |

### Internal (not exported from main entry)

| Class                          | File                                  | Description                                                            |
| ------------------------------ | ------------------------------------- | ---------------------------------------------------------------------- |
| `OpenAIResponseParser`         | `parsers/response-parser.ts`          | Parses completions and streaming chunks into `TUniversalMessage`       |
| `chatWithOpenAIResponsesApi`   | `responses-chat.ts`                   | Executes Responses API requests and streaming assembly                 |
| `parseOpenAIResponsesResponse` | `responses-parser.ts`                 | Converts Responses output items into universal assistant messages      |
| `streamWithAbort`              | `responses-stream-utils.ts`           | Provides abort-aware async iteration for Responses streaming           |
| `OpenAIStreamHandler`          | `streaming/stream-handler.ts`         | Modular streaming generator for raw streaming APIs                     |
| `assembleOpenAIStream`         | `streaming/stream-assembler.ts`       | Assembles streamed Chat Completions chunks for `OpenAIProvider.chat()` |
| `sanitizeOpenAILogData`        | `loggers/sanitize-openai-log-data.ts` | Deep-copy sanitization for log payloads                                |

## Extension Points

### Custom Payload Logger

Consumers can implement the `IPayloadLogger` interface to create custom logging backends:

```typescript
interface IPayloadLogger {
  isEnabled(): boolean;
  logPayload(payload: IOpenAILogData, type: 'chat' | 'stream'): Promise<void>;
}
```

Pass the implementation via `IOpenAIProviderOptions.payloadLogger`.

### Executor Delegation

Consumers can provide an `IExecutor` implementation (e.g., `LocalExecutor`, `RemoteExecutor`) via `IOpenAIProviderOptions.executor` to delegate all chat operations. When an executor is set, no API key or client instance is required.

### Custom OpenAI Client

Consumers can pass a pre-configured `OpenAI` client instance via `IOpenAIProviderOptions.client` to control SDK configuration (custom base URLs, timeouts, organization settings).

### API Surface Selection

- Official OpenAI profiles default to `apiSurface: "responses"`.
- Profiles with `baseURL` default to `apiSurface: "chat-completions"` for OpenAI-compatible endpoint compatibility.
- Consumers can force either behavior through `IOpenAIProviderOptions.apiSurface`.

### Native Replay Payload Capture

When `IChatOptions.onProviderNativeRawPayload` is provided, `OpenAIProvider` emits provider-native payload events before normalization:

- `payloadKind: "request"` for the exact Responses or Chat Completions request params sent to the OpenAI SDK.
- `payloadKind: "response"` for non-streaming SDK response objects.
- `payloadKind: "stream_event"` for each streaming SDK event/chunk, preserving ordered sequence.

The package owns `apiSurface` labels (`responses` or `chat-completions`) and native payload selection. `agent-core`, `agent-sessions`, `agent-sdk`, and `agent-cli` must treat the payload as opaque data and rely on session logging for redaction/externalization.

### Native Web Capability Handling

OpenAI-compatible local/proxy endpoints such as LM Studio are treated as custom function-tool capable, not provider-native web-search/fetch capable. If a profile has `baseURL`, or explicitly selects `apiSurface: "chat-completions"`, and also sets `options.builtInWebTools` or `options.nativeWebTools`, provider creation must fail before any model request is sent. The error must explain that OpenAI-compatible Chat Completions does not guarantee provider-native web search/fetch and that Robota local `WebSearch`/`WebFetch` tools are the explicit local-tool path.

`OpenAIProvider.getCapabilities()` reports native web search/fetch support from the selected API surface and active options. Until OpenAI Responses hosted web search is fully wired and tested in this package, official OpenAI profiles report native web search as unsupported by Robota even though the external API documents it. This prevents a capability claim without runtime evidence.

### Structured Outputs

`responseFormat: "json_schema"` with `jsonSchema` maps to Responses `text.format` and Chat Completions `response_format`. `responseFormat: "json_object"` remains supported for older JSON mode, but JSON Schema is preferred where supported.

### Reasoning Controls

`IOpenAIProviderOptions.reasoning` maps to Responses reasoning options. Hidden reasoning tokens are never copied into `TUniversalMessage.content`. If encrypted reasoning is requested, the message metadata records `hasEncryptedReasoning` without exposing encrypted payload contents.

### Streaming Assembly for CLI

`OpenAIProvider.chat()` must honor `IChatOptions.onTextDelta`. When the callback is provided, `chat()` uses the selected API surface's streaming mode internally while still returning one complete `TUniversalMessage`.

Streaming assembly responsibilities:

- Accumulate `response.output_text.delta` or Chat Completions `delta.content` into the final assistant content.
- Call `onTextDelta` for every text delta.
- Accumulate Responses `function_call` output items or Chat Completions streamed `tool_calls`, preserving `id`/`call_id`, function `name`, and arguments.
- Return final `toolCalls` only after streamed arguments have been assembled.
- Pass `AbortSignal` through to the OpenAI SDK request where supported.

The non-streaming Chat Completions path remains supported for callers that do not provide `onTextDelta`.

## Error Taxonomy

This package does not define a custom error class hierarchy. It uses standard `Error` instances with descriptive messages. Error scenarios:

| Condition                            | Error message pattern                                     | Source                                  |
| ------------------------------------ | --------------------------------------------------------- | --------------------------------------- |
| Missing client, apiKey, and executor | `"Either OpenAI client, apiKey, or executor is required"` | `provider.ts` constructor               |
| Missing model in chat options        | `"Model is required in chat options..."`                  | `provider.ts` chat/chatStream           |
| Client unavailable (no executor)     | `"OpenAI client not available..."`                        | `chat-completions-chat.ts`              |
| Responses client unavailable         | `"OpenAI Responses client not available."`                | `responses-chat.ts`                     |
| Native web unsupported               | `"Provider openai does not support native web..."`        | `provider.ts`, `provider-definition.ts` |
| API call failure                     | `"OpenAI chat failed: <message>"`                         | `provider.ts` chat                      |
| Streaming failure                    | `"OpenAI stream failed: <message>"`                       | `provider.ts` chat/chatStream           |
| Responses failure                    | `"OpenAI responses failed: <message>"`                    | `responses-chat.ts`                     |
| Responses streaming failure          | `"OpenAI responses stream failed: <message>"`             | `responses-chat.ts`                     |
| Responses event failure              | `"OpenAI Responses API failed: <message>"`                | `responses-parser.ts`                   |
| Response parsing failure             | `"OpenAI response parsing failed: <message>"`             | `parsers/response-parser.ts`            |
| Chunk parsing failure                | `"OpenAI chunk parsing failed: <message>"`                | `parsers/response-parser.ts`            |
| Stream handler failure               | `"OpenAI streaming failed: <message>"`                    | `streaming/stream-handler.ts`           |
| Tool message missing toolCallId      | `"Tool message missing toolCallId: <json>"`               | `adapter.ts`                            |
| Unsupported message role             | `"Unsupported message role: <role>"`                      | `adapter.ts`, `provider.ts`             |

Payload loggers (`FilePayloadLogger`, `ConsolePayloadLogger`) catch and log their own errors internally without propagating them, ensuring logging failures do not break main functionality.

## Class Contract Registry

### Interface Implementations

| Interface        | Implementor            | Kind       | Location                                |
| ---------------- | ---------------------- | ---------- | --------------------------------------- |
| `IPayloadLogger` | `ConsolePayloadLogger` | production | `src/loggers/console-payload-logger.ts` |
| `IPayloadLogger` | `FilePayloadLogger`    | production | `src/loggers/file-payload-logger.ts`    |

### Inheritance Chains

| Base (Owner)                  | Derived          | Location          | Notes                           |
| ----------------------------- | ---------------- | ----------------- | ------------------------------- |
| `AbstractAIProvider` (agents) | `OpenAIProvider` | `src/provider.ts` | Primary provider implementation |

### Cross-Package Port Consumers

| Port (Owner)                       | Adapter                          | Location                     |
| ---------------------------------- | -------------------------------- | ---------------------------- |
| `AbstractAIProvider` (agents)      | `OpenAIProvider`                 | `src/provider.ts`            |
| `IProviderDefinition` (agent-core) | `createOpenAIProviderDefinition` | `src/provider-definition.ts` |
| `TUniversalMessage` (agent-core)   | Responses converter/parser       | `src/responses-*.ts`         |
| OpenAI-compatible endpoint probe   | `createOpenAIProviderDefinition` | `src/provider-definition.ts` |

## Test Strategy

### Current Test Files

| File                           | Type        | Coverage                                                                                                                   |
| ------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `adapter.test.ts`              | Unit        | `OpenAIConversationAdapter` -- all message types, tool call content handling, filtering, complete conversation flow        |
| `executor-integration.test.ts` | Integration | `OpenAIProvider` with `LocalExecutor` -- chat, streaming, error handling, mixed mode, initialization                       |
| `provider.test.ts`             | Unit        | Responses default path, baseURL Chat Completions compatibility, streaming, tool calling, structured outputs, error mapping |
| `provider-definition.test.ts`  | Unit        | Official OpenAI provider setup defaults, provider construction, and OpenAI-compatible native web rejection                 |

### Test Gaps

- No unit tests for `FilePayloadLogger` or `ConsolePayloadLogger`.
