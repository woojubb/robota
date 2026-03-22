# Anthropic Specification

## Scope

- Owns the Anthropic Claude provider integration for Robota SDK.
- Implements `AbstractAIProvider` from `@robota-sdk/agent-core` to provide Claude model access through the Anthropic Messages API.
- Owns Anthropic-specific message format conversion (universal to/from Anthropic wire format).
- Owns Anthropic-specific response parsing, including streaming chunk handling.
- Owns Anthropic-specific tool call format conversion (`input_schema`-based tools).
- Owns provider option types (`IAnthropicProviderOptions`, `TAnthropicProviderOptionValue`).
- Owns Anthropic API type definitions for messages, requests, responses, streaming, tools, and errors.

## Boundaries

- Does not own generic agent orchestration, message types, or provider abstractions; those belong to `@robota-sdk/agent-core`.
- Does not own executor contracts (`IExecutor`); imports them from `@robota-sdk/agent-core`.
- Does not own `TUniversalMessage`, `IChatOptions`, `IToolSchema`, or `IAssistantMessage`; imports them from `@robota-sdk/agent-core`.
- Does not implement image generation capabilities (unlike the Google provider).
- Does not own session management, team collaboration, or workflow concerns.
- Keeps all Anthropic-specific transport behavior explicit and provider-scoped; no leaking of Anthropic SDK types through the public API surface beyond `IAnthropicProviderOptions.client`.

## Architecture Overview

The package follows a provider-adapter pattern:

1. **`AnthropicProvider`** (`provider.ts`) -- the primary class. Extends `AbstractAIProvider` and implements `chat()`, `chatStream()`, `supportsTools()`, `validateConfig()`, and `dispose()`. Converts between `TUniversalMessage` and Anthropic `MessageParam`/`MessageCreateParams` formats. Supports both direct API execution (via `@anthropic-ai/sdk` client) and delegated execution (via `IExecutor`).

2. **`AnthropicResponseParser`** (`parsers/response-parser.ts`) -- a static utility class that parses raw Anthropic API responses (`IAnthropicMessage`) and streaming chunks (`MessageStreamEvent`) into `TUniversalMessage`. Extracts token usage metadata and tool call data.

3. **Types layer** (`types.ts`, `types/api-types.ts`) -- provider option interface and Anthropic-specific API type definitions covering messages, requests, streaming, tools, and errors.

4. **Entry point** (`index.ts`) -- re-exports `provider.ts` and `types.ts`, and exposes a `createAnthropicProvider` factory function.

Dependency direction: `@robota-sdk/agent-provider-anthropic` depends on `@robota-sdk/agent-core` (peer dependency) and `@anthropic-ai/sdk` (direct dependency). No other workspace packages are imported.

## Streaming Policy

The provider MUST always use the streaming API (`messages.stream` / SSE) for all provider calls, regardless of whether an `onTextDelta` callback is provided. When no callback is provided, streaming results are assembled silently without calling any delta callback.

**Reason:** Anthropic SDK enforces a 10-minute timeout on non-streaming requests. Agentic workflows with tool loops can exceed this limit. Streaming connections have no such timeout.

**Implementation:** The non-streaming code path (`client.messages.create` without streaming) is removed. All calls go through `chatWithStreaming`, passing a no-op callback when `onTextDelta` is not available.

## Output Token Limits

The provider uses `max_tokens` from `IChatOptions.maxTokens` if provided. When not specified, the provider MUST use the model's `maxOutput` from `CLAUDE_MODELS` (via `getModelMaxOutput`) as the default. A low hardcoded default (e.g., 4096) is insufficient for agentic workflows where tool loops and long responses are common.

## Type Ownership

| Type                            | Owner                                  | Location                         |
| ------------------------------- | -------------------------------------- | -------------------------------- |
| `IAnthropicProviderOptions`     | `@robota-sdk/agent-provider-anthropic` | `src/types.ts`                   |
| `TAnthropicProviderOptionValue` | `@robota-sdk/agent-provider-anthropic` | `src/types.ts`                   |
| `IAnthropicMessage`             | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicContent`             | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicUsage`               | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicChatRequestParams`   | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicStreamRequestParams` | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicRequestMessage`      | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicRequestContent`      | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicTool`                | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicToolProperty`        | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicToolCall`            | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicStreamChunk`         | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicStreamDelta`         | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicError`               | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicLogData`             | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicProviderResponse`    | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `IAnthropicStreamContext`       | `@robota-sdk/agent-provider-anthropic` | `src/types/api-types.ts`         |
| `AnthropicProvider`             | `@robota-sdk/agent-provider-anthropic` | `src/provider.ts`                |
| `AnthropicResponseParser`       | `@robota-sdk/agent-provider-anthropic` | `src/parsers/response-parser.ts` |

Imported from `@robota-sdk/agent-core` (not owned): `AbstractAIProvider`, `TUniversalMessage`, `IChatOptions`, `IToolSchema`, `IAssistantMessage`, `IExecutor`, `TProviderOptionValueBase`, `logger`.

## Public API Surface

| Export                                  | Kind             | Source                           | Description                                                                                                                                     |
| --------------------------------------- | ---------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `AnthropicProvider`                     | class            | `src/provider.ts`                | Anthropic provider implementing `AbstractAIProvider`. Methods: `chat()`, `chatStream()`, `supportsTools()`, `validateConfig()`, `dispose()`.    |
| ~~`AnthropicResponseParser`~~           | class (internal) | `src/parsers/response-parser.ts` | Internal static utility — not exported from `src/index.ts`. Used by `AnthropicProvider` internally for response/streaming parsing.              |
| `IAnthropicProviderOptions`             | interface        | `src/types.ts`                   | Configuration options for constructing `AnthropicProvider`. Fields: `apiKey`, `timeout`, `baseURL`, `client`, `executor`, plus index signature. |
| `TAnthropicProviderOptionValue`         | type alias       | `src/types.ts`                   | Union type for valid provider option values.                                                                                                    |
| `createAnthropicProvider`               | function (stub)  | `src/index.ts`                   | Stub — currently returns `void`. Not yet implemented; placeholder for future factory pattern.                                                   |
| All types from `src/types/api-types.ts` | interfaces/types | `src/types/api-types.ts`         | Anthropic API type definitions (messages, requests, tools, streaming, errors). Exported transitively via `src/types.ts` re-export pattern.      |

### AnthropicProvider Public Instance Fields

| Field             | Type                                                    | Default | Description                                                       |
| ----------------- | ------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| `enableWebTools`  | `boolean`                                               | `false` | When true, includes `web_search_20250305` server tool in requests |
| `onTextDelta`     | `TTextDeltaCallback \| undefined`                       | —       | Streaming text delta callback for real-time output                |
| `onServerToolUse` | `(name: string, input: Record<string, string>) => void` | —       | Callback when server-managed tool executes during streaming       |

## Web Search Support

The provider supports Anthropic's server-side web search tool:

- **`enableWebTools` flag** -- When set to `true` in chat options, includes the `web_search_20250305` server tool in API requests. This is a server-managed tool (not a `FunctionTool`) that Anthropic executes during response generation.
- **`onServerToolUse` callback** -- Fires when a server tool executes during streaming. The callback receives the tool name and input (e.g., query string). Consumers use this to display search status indicators.
- **Streaming block handling** -- The streaming parser handles `server_tool_use` and `web_search_tool_result` content blocks. When a `server_tool_use` block is encountered, the provider emits a search indicator (e.g., "Searching...").
- **`formatWebSearchResults()`** -- Private method on `AnthropicProvider` that converts raw web search result blocks into human-readable text with source URLs and snippets.

## SDK Version and Message Format

- **Anthropic SDK**: `@anthropic-ai/sdk` v0.80.0 (upgraded from v0.24.3).
- **System message extraction**: System messages are extracted from the message array and sent via the dedicated `system` parameter in the API request, rather than being included as a `role: user` message. This follows the current Anthropic API best practice.
- **`chat()` vs `chatStream()` asymmetry**: `chat()` applies `enableWebTools`, system message extraction, and `onServerToolUse` callbacks. `chatStream()` does NOT apply these features — it uses the native SDK streaming API directly without server tool support. This is a known limitation.
- **Response parsing**: Two parsing paths coexist — `convertFromAnthropicResponse()` (inline in provider, used by `chat()`) and `AnthropicResponseParser` (separate class, used by `chatStream()`). They have minor behavioral differences (e.g., `null` vs `''` for tool-only content).
- **Local API types**: `IAnthropicStreamChunk` and other types in `api-types.ts` were written before migration to the native Anthropic SDK. The provider's streaming code now uses native SDK event types directly; local API types are partially unused but retained for backward compatibility.
- **`validateConfig()` edge case**: Returns `false` for executor-based providers (no client/apiKey) even though the provider is functional. This is a known gap.

## Extension Points

- **Executor injection**: The provider accepts an `IExecutor` via `IAnthropicProviderOptions.executor`, enabling delegation of chat operations to local or remote executors without modifying the provider.
- **Pre-built client injection**: A pre-configured `Anthropic` client instance can be passed via `IAnthropicProviderOptions.client`, allowing custom transport configuration.
- **AbstractAIProvider contract**: New lifecycle or capability methods added to `AbstractAIProvider` in `@robota-sdk/agent-core` can be overridden in `AnthropicProvider`.

## Error Taxonomy

| Error Condition                            | Thrown By                                       | Message Pattern                                                                              |
| ------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Missing client, apiKey, and executor       | `AnthropicProvider` constructor                 | `"Either Anthropic client, apiKey, or executor is required"`                                 |
| Client unavailable during direct execution | `chat()`, `chatStream()`                        | `"Anthropic client not available. Either provide a client/apiKey or use an executor."`       |
| Missing model in chat options              | `chat()`, `chatStream()`                        | `"Model is required in chat options. Please specify a model in defaultModel configuration."` |
| Empty response content                     | `convertFromAnthropicResponse()`                | `"No content in Anthropic response"`                                                         |
| Unsupported content block type             | `convertFromAnthropicResponse()`                | `"Unsupported content type: <type>"`                                                         |
| Invalid message array (not array)          | `validateMessages()`                            | `"Messages must be an array"`                                                                |
| Empty message array                        | `validateMessages()`                            | `"Messages array cannot be empty"`                                                           |
| Invalid message role                       | `validateMessages()`                            | `"Invalid message role: <role>"`                                                             |
| Response parsing failure                   | `AnthropicResponseParser.parseResponse()`       | Re-throws original error after logging                                                       |
| Stream chunk parsing failure               | `AnthropicResponseParser.parseStreamingChunk()` | Returns `null` after logging error                                                           |

Anthropic API errors are defined in `IAnthropicError` with types: `invalid_request_error`, `authentication_error`, `permission_error`, `not_found_error`, `rate_limit_error`, `api_error`, `overloaded_error`.

## Class Contract Registry

### Interface Implementations

None. This package has no local interface implementations.

### Inheritance Chains

| Base (Owner)                      | Derived             | Location          | Notes                           |
| --------------------------------- | ------------------- | ----------------- | ------------------------------- |
| `AbstractAIProvider` (agent-core) | `AnthropicProvider` | `src/provider.ts` | Primary provider implementation |

### Cross-Package Port Consumers

| Port (Owner)                      | Adapter             | Location          |
| --------------------------------- | ------------------- | ----------------- |
| `AbstractAIProvider` (agent-core) | `AnthropicProvider` | `src/provider.ts` |

## Test Strategy

- **Current state**: No test files exist in the package (`pnpm test` runs with `--passWithNoTests`).
- **Recommended coverage areas**:
  - Unit tests for `AnthropicProvider` constructor validation (client vs apiKey vs executor).
  - Unit tests for message format conversion (`convertToAnthropicFormat`, `convertFromAnthropicResponse`), including tool call content-null invariant.
  - Unit tests for tool schema conversion (`convertToolsToAnthropicFormat`).
  - Unit tests for `AnthropicResponseParser.parseResponse()` covering text blocks, tool_use blocks, usage metadata, and error cases.
  - Unit tests for `AnthropicResponseParser.parseStreamingChunk()` covering all chunk types (`content_block_start`, `content_block_delta`, `content_block_stop`, `message_stop`).
  - Unit tests for `validateMessages()` edge cases.
  - Integration-style tests with mocked `@anthropic-ai/sdk` client for `chat()` and `chatStream()` flows.
- **Framework**: Vitest (configured in workspace).
- **Test commands**: `pnpm test`, `pnpm test:watch`, `pnpm test:coverage`.
