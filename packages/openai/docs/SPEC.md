# OpenAI Package Specification

## Scope

- Owns the OpenAI provider integration for Robota, including GPT model access, streaming support, tool/function calling, and provider-bound request/response adaptation.
- Owns bidirectional message conversion between `TUniversalMessage` and OpenAI SDK native types.
- Owns payload logging infrastructure with environment-specific implementations (Node.js file-based, browser console-based).
- Owns OpenAI-specific API type definitions for request parameters, streaming chunks, tool calls, and error structures.

## Boundaries

- Does not own generic agent orchestration contracts, executor abstractions, or universal message types -- those belong to `@robota-sdk/agents`.
- Does not own session management, conversation history, or tool execution logic.
- Keeps OpenAI-specific transport behavior explicit and provider-scoped.
- Relies on `AbstractAIProvider` from `@robota-sdk/agents` as the base class for provider implementation.
- Logger and executor interfaces (`ILogger`, `IExecutor`) are imported from `@robota-sdk/agents`, not redefined.

## Architecture Overview

### Layer Structure

```
src/
  index.ts                          # Public API surface (re-exports)
  provider.ts                       # OpenAIProvider (extends AbstractAIProvider)
  adapter.ts                        # OpenAIConversationAdapter (static message conversion)
  types.ts                          # Provider options and option value types
  types/
    api-types.ts                    # OpenAI-specific API type definitions
  interfaces/
    payload-logger.ts               # IPayloadLogger / IPayloadLoggerOptions contracts
  parsers/
    response-parser.ts              # OpenAIResponseParser (completion + streaming chunk parsing)
  streaming/
    stream-handler.ts               # OpenAIStreamHandler (modular streaming logic)
  loggers/
    index.ts                        # Logger barrel exports
    console.ts                      # Subpath entry: ConsolePayloadLogger
    file.ts                         # Subpath entry: FilePayloadLogger
    console-payload-logger.ts       # Browser console logger implementation
    file-payload-logger.ts          # Node.js file logger implementation
    sanitize-openai-log-data.ts     # SSOT sanitization utility for log data
```

### Design Patterns

- **Adapter pattern**: `OpenAIConversationAdapter` provides static methods for bidirectional conversion between `TUniversalMessage` and `OpenAI.Chat.ChatCompletionMessageParam`.
- **Strategy pattern (logging)**: `IPayloadLogger` interface with two built-in implementations (`FilePayloadLogger`, `ConsolePayloadLogger`) and support for custom implementations.
- **Template method**: `OpenAIProvider` extends `AbstractAIProvider`, overriding `chat`, `chatStream`, `validateMessages`, `supportsTools`, `validateConfig`, and `dispose`.
- **Executor delegation**: When an `IExecutor` is provided, the provider delegates all chat operations to the executor instead of making direct OpenAI API calls, enabling remote execution.
- **Dependency injection**: Logger and payload logger are injected via constructor options. Defaults to `SilentLogger` when no logger is provided.

## Type Ownership

Types owned by this package (SSOT):

| Type | Kind | File | Description |
|------|------|------|-------------|
| `IOpenAIProviderOptions` | Interface | `types.ts` | Constructor options for `OpenAIProvider` |
| `TOpenAIProviderOptionValue` | Type alias | `types.ts` | Union of valid provider option value types |
| `IOpenAIChatRequestParams` | Interface | `types/api-types.ts` | OpenAI chat completion request parameters |
| `IOpenAIStreamRequestParams` | Interface | `types/api-types.ts` | OpenAI streaming request parameters (extends chat params) |
| `IOpenAIToolCall` | Interface | `types/api-types.ts` | OpenAI tool call structure |
| `IOpenAIAssistantMessage` | Interface | `types/api-types.ts` | OpenAI assistant message with optional tool calls |
| `IOpenAIToolMessage` | Interface | `types/api-types.ts` | OpenAI tool response message |
| `IOpenAIStreamDelta` | Interface | `types/api-types.ts` | Streaming chunk delta structure |
| `IOpenAIStreamChunk` | Interface | `types/api-types.ts` | Full streaming chunk structure |
| `IOpenAIError` | Interface | `types/api-types.ts` | OpenAI error structure for type-safe error handling |
| `IOpenAILogData` | Interface | `types/api-types.ts` | Payload logging data structure |
| `IPayloadLogger` | Interface | `interfaces/payload-logger.ts` | Contract for payload logger implementations |
| `IPayloadLoggerOptions` | Interface | `interfaces/payload-logger.ts` | Configuration options for payload loggers |

Types imported from `@robota-sdk/agents` (not owned here):

| Type | Usage |
|------|-------|
| `TUniversalMessage` | Message format for chat/chatStream input and output |
| `IAssistantMessage` | Narrowed assistant message type with toolCalls |
| `IChatOptions` | Chat method options (model, temperature, maxTokens, tools) |
| `IToolCall` | Universal tool call structure |
| `IToolSchema` | Tool definition schema for function calling |
| `IExecutor` | Executor interface for delegated execution |
| `ILogger` | Logger interface for dependency-injected logging |
| `TProviderOptionValueBase` | Base type for provider option values |
| `AbstractAIProvider` | Base class for all AI providers |
| `SilentLogger` | Default no-op logger |
| `LocalExecutor` | Local executor implementation (used in tests) |

## Public API Surface

### Main entry point (`@robota-sdk/openai`)

| Export | Kind | Description |
|--------|------|-------------|
| `OpenAIProvider` | Class | Primary provider class; extends `AbstractAIProvider` |
| `OpenAIConversationAdapter` | Class | Static utility for message format conversion |
| `IOpenAIProviderOptions` | Interface | Provider constructor options |
| `TOpenAIProviderOptionValue` | Type alias | Valid option value types |
| `IPayloadLogger` | Interface (type-only) | Payload logger contract |
| `IPayloadLoggerOptions` | Interface (type-only) | Payload logger configuration |
| All exports from `types.ts` | Mixed | Provider options and value types |
| All exports from `adapter.ts` | Class | Conversation adapter |

### Subpath entry points

| Subpath | Export | Description |
|---------|--------|-------------|
| `@robota-sdk/openai/loggers/file` | `FilePayloadLogger` | Node.js file-based payload logger |
| `@robota-sdk/openai/loggers/console` | `ConsolePayloadLogger` | Browser console-based payload logger |

### Internal (not exported from main entry)

| Class | File | Description |
|-------|------|-------------|
| `OpenAIResponseParser` | `parsers/response-parser.ts` | Parses completions and streaming chunks into `TUniversalMessage` |
| `OpenAIStreamHandler` | `streaming/stream-handler.ts` | Modular streaming handler (used internally by provider) |
| `sanitizeOpenAILogData` | `loggers/sanitize-openai-log-data.ts` | Deep-copy sanitization for log payloads |

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

### Base URL Override

The `baseURL` option in `IOpenAIProviderOptions` allows consumers to point the provider at OpenAI-compatible APIs (e.g., Azure OpenAI, local proxies).

## Error Taxonomy

This package does not define a custom error class hierarchy. It uses standard `Error` instances with descriptive messages. Error scenarios:

| Condition | Error message pattern | Source |
|-----------|----------------------|--------|
| Missing client, apiKey, and executor | `"Either OpenAI client, apiKey, or executor is required"` | `provider.ts` constructor |
| Missing model in chat options | `"Model is required in chat options..."` | `provider.ts` chat/chatStream |
| Client unavailable (no executor) | `"OpenAI client not available..."` | `provider.ts` chat/chatStream |
| API call failure | `"OpenAI chat failed: <message>"` | `provider.ts` chat |
| Streaming failure | `"OpenAI stream failed: <message>"` | `provider.ts` chatStream |
| Response parsing failure | `"OpenAI response parsing failed: <message>"` | `parsers/response-parser.ts` |
| Chunk parsing failure | `"OpenAI chunk parsing failed: <message>"` | `parsers/response-parser.ts` |
| Stream handler failure | `"OpenAI streaming failed: <message>"` | `streaming/stream-handler.ts` |
| Tool message missing toolCallId | `"Tool message missing toolCallId: <json>"` | `adapter.ts` |
| Unsupported message role | `"Unsupported message role: <role>"` | `adapter.ts`, `provider.ts` |

Payload loggers (`FilePayloadLogger`, `ConsolePayloadLogger`) catch and log their own errors internally without propagating them, ensuring logging failures do not break main functionality.

## Class Contract Registry

### Interface Implementations

| Interface | Implementor | Kind | Location |
|-----------|------------|------|----------|
| `IPayloadLogger` | `ConsolePayloadLogger` | production | `src/loggers/console-payload-logger.ts` |
| `IPayloadLogger` | `FilePayloadLogger` | production | `src/loggers/file-payload-logger.ts` |

### Inheritance Chains

| Base (Owner) | Derived | Location | Notes |
|------|---------|----------|-------|
| `AbstractAIProvider` (agents) | `OpenAIProvider` | `src/provider.ts` | Primary provider implementation |

### Cross-Package Port Consumers

| Port (Owner) | Adapter | Location |
|--------------|---------|----------|
| `AbstractAIProvider` (agents) | `OpenAIProvider` | `src/provider.ts` |

## Test Strategy

### Current Test Files

| File | Type | Coverage |
|------|------|----------|
| `adapter.test.ts` | Unit | `OpenAIConversationAdapter` -- all message types, tool call content handling, filtering, complete conversation flow |
| `executor-integration.test.ts` | Integration | `OpenAIProvider` with `LocalExecutor` -- chat, streaming, error handling, mixed mode, initialization |

### Test Gaps

- No unit tests for `OpenAIResponseParser` (completion parsing, streaming chunk parsing, error cases).
- No unit tests for `OpenAIStreamHandler` (stream handling, payload logging during streams).
- No unit tests for `FilePayloadLogger` or `ConsolePayloadLogger`.
- No unit tests for `sanitizeOpenAILogData`.
- No direct unit tests for `OpenAIProvider.chat` and `OpenAIProvider.chatStream` with a mocked OpenAI client (non-executor path).
- No tests for `OpenAIProvider.validateConfig` or `OpenAIProvider.validateMessages` specific behavior.
- No tests verifying payload logger integration within the provider (logging is called with correct data).
