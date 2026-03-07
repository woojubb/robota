# Anthropic Specification

## Scope

- Owns the Anthropic Claude provider integration for Robota SDK.
- Implements `AbstractAIProvider` from `@robota-sdk/agents` to provide Claude model access through the Anthropic Messages API.
- Owns Anthropic-specific message format conversion (universal to/from Anthropic wire format).
- Owns Anthropic-specific response parsing, including streaming chunk handling.
- Owns Anthropic-specific tool call format conversion (`input_schema`-based tools).
- Owns provider option types (`IAnthropicProviderOptions`, `TAnthropicProviderOptionValue`).
- Owns Anthropic API type definitions for messages, requests, responses, streaming, tools, and errors.

## Boundaries

- Does not own generic agent orchestration, message types, or provider abstractions; those belong to `@robota-sdk/agents`.
- Does not own executor contracts (`IExecutor`); imports them from `@robota-sdk/agents`.
- Does not own `TUniversalMessage`, `IChatOptions`, `IToolSchema`, or `IAssistantMessage`; imports them from `@robota-sdk/agents`.
- Does not implement image generation capabilities (unlike the Google provider).
- Does not own session management, team collaboration, or workflow concerns.
- Keeps all Anthropic-specific transport behavior explicit and provider-scoped; no leaking of Anthropic SDK types through the public API surface beyond `IAnthropicProviderOptions.client`.

## Architecture Overview

The package follows a provider-adapter pattern:

1. **`AnthropicProvider`** (`provider.ts`) -- the primary class. Extends `AbstractAIProvider` and implements `chat()`, `chatStream()`, `supportsTools()`, `validateConfig()`, and `dispose()`. Converts between `TUniversalMessage` and Anthropic `MessageParam`/`MessageCreateParams` formats. Supports both direct API execution (via `@anthropic-ai/sdk` client) and delegated execution (via `IExecutor`).

2. **`AnthropicResponseParser`** (`parsers/response-parser.ts`) -- a static utility class that parses raw Anthropic API responses (`IAnthropicMessage`) and streaming chunks (`MessageStreamEvent`) into `TUniversalMessage`. Extracts token usage metadata and tool call data.

3. **Types layer** (`types.ts`, `types/api-types.ts`) -- provider option interface and Anthropic-specific API type definitions covering messages, requests, streaming, tools, and errors.

4. **Entry point** (`index.ts`) -- re-exports `provider.ts` and `types.ts`, and exposes a `createAnthropicProvider` factory function.

Dependency direction: `@robota-sdk/anthropic` depends on `@robota-sdk/agents` (peer dependency) and `@anthropic-ai/sdk` (direct dependency). No other workspace packages are imported.

## Type Ownership

| Type | Owner | Location |
|------|-------|----------|
| `IAnthropicProviderOptions` | `@robota-sdk/anthropic` | `src/types.ts` |
| `TAnthropicProviderOptionValue` | `@robota-sdk/anthropic` | `src/types.ts` |
| `IAnthropicMessage` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicContent` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicUsage` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicChatRequestParams` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicStreamRequestParams` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicRequestMessage` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicRequestContent` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicTool` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicToolProperty` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicToolCall` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicStreamChunk` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicStreamDelta` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicError` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicLogData` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicProviderResponse` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `IAnthropicStreamContext` | `@robota-sdk/anthropic` | `src/types/api-types.ts` |
| `AnthropicProvider` | `@robota-sdk/anthropic` | `src/provider.ts` |
| `AnthropicResponseParser` | `@robota-sdk/anthropic` | `src/parsers/response-parser.ts` |

Imported from `@robota-sdk/agents` (not owned): `AbstractAIProvider`, `TUniversalMessage`, `IChatOptions`, `IToolSchema`, `IAssistantMessage`, `IExecutor`, `TProviderOptionValueBase`, `logger`.

## Public API Surface

| Export | Kind | Source | Description |
|--------|------|--------|-------------|
| `AnthropicProvider` | class | `src/provider.ts` | Anthropic provider implementing `AbstractAIProvider`. Methods: `chat()`, `chatStream()`, `supportsTools()`, `validateConfig()`, `dispose()`. |
| `AnthropicResponseParser` | class | `src/parsers/response-parser.ts` | Static utility for parsing Anthropic API responses and streaming chunks into `TUniversalMessage`. Methods: `parseResponse()`, `parseStreamingChunk()`. |
| `IAnthropicProviderOptions` | interface | `src/types.ts` | Configuration options for constructing `AnthropicProvider`. Fields: `apiKey`, `timeout`, `baseURL`, `client`, `executor`, plus index signature. |
| `TAnthropicProviderOptionValue` | type alias | `src/types.ts` | Union type for valid provider option values. |
| `createAnthropicProvider` | function | `src/index.ts` | Factory function for creating an Anthropic provider (stub implementation). |
| All types from `src/types/api-types.ts` | interfaces/types | `src/types/api-types.ts` | Anthropic API type definitions (messages, requests, tools, streaming, errors). Exported transitively via `src/types.ts` re-export pattern. |

## Extension Points

- **Executor injection**: The provider accepts an `IExecutor` via `IAnthropicProviderOptions.executor`, enabling delegation of chat operations to local or remote executors without modifying the provider.
- **Pre-built client injection**: A pre-configured `Anthropic` client instance can be passed via `IAnthropicProviderOptions.client`, allowing custom transport configuration.
- **AbstractAIProvider contract**: New lifecycle or capability methods added to `AbstractAIProvider` in `@robota-sdk/agents` can be overridden in `AnthropicProvider`.

## Error Taxonomy

| Error Condition | Thrown By | Message Pattern |
|-----------------|-----------|-----------------|
| Missing client, apiKey, and executor | `AnthropicProvider` constructor | `"Either Anthropic client, apiKey, or executor is required"` |
| Client unavailable during direct execution | `chat()`, `chatStream()` | `"Anthropic client not available. Either provide a client/apiKey or use an executor."` |
| Missing model in chat options | `chat()`, `chatStream()` | `"Model is required in chat options. Please specify a model in defaultModel configuration."` |
| Empty response content | `convertFromAnthropicResponse()` | `"No content in Anthropic response"` |
| Unsupported content block type | `convertFromAnthropicResponse()` | `"Unsupported content type: <type>"` |
| Invalid message array (not array) | `validateMessages()` | `"Messages must be an array"` |
| Empty message array | `validateMessages()` | `"Messages array cannot be empty"` |
| Invalid message role | `validateMessages()` | `"Invalid message role: <role>"` |
| Response parsing failure | `AnthropicResponseParser.parseResponse()` | Re-throws original error after logging |
| Stream chunk parsing failure | `AnthropicResponseParser.parseStreamingChunk()` | Returns `null` after logging error |

Anthropic API errors are defined in `IAnthropicError` with types: `invalid_request_error`, `authentication_error`, `permission_error`, `not_found_error`, `rate_limit_error`, `api_error`, `overloaded_error`.

## Class Contract Registry

### Interface Implementations

None. This package has no local interface implementations.

### Inheritance Chains

| Base (Owner) | Derived | Location | Notes |
|------|---------|----------|-------|
| `AbstractAIProvider` (agents) | `AnthropicProvider` | `src/provider.ts` | Primary provider implementation |

### Cross-Package Port Consumers

| Port (Owner) | Adapter | Location |
|--------------|---------|----------|
| `AbstractAIProvider` (agents) | `AnthropicProvider` | `src/provider.ts` |

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
