# Gemma Provider Specification

## Scope

This package owns Gemma model-family provider behavior for Robota when Gemma models are served through OpenAI-compatible Chat Completions endpoints such as LM Studio. It composes `agent-provider-openai-compatible` for transport primitives and owns Gemma-specific text projection for reasoning-channel markers, documented Gemma/LM Studio native tool-call text, and Gemma-generated XML-like execution artifacts emitted as assistant content.

## Boundaries

- Does not own Google Gemini API behavior. That remains in `agent-provider-google` until a future `agent-provider-gemini` migration.
- Does not own generic OpenAI-compatible transport conversion, response parsing, stream assembly, or endpoint probing. Those belong to `agent-provider-openai-compatible`.
- Does not own OpenAI-branded account semantics or OpenAI defaults. Those belong to `agent-provider-openai`.
- Does not own session persistence, tool execution, or CLI command routing.

## Architecture Overview

```
src/
  index.ts                    # public exports
  provider.ts                 # GemmaProvider
  provider-definition.ts      # provider definition for CLI/runtime composition
  message-factory.ts          # small universal streaming message factory
  types.ts                    # provider options and option value types
  reasoning-projector.ts      # Gemma reasoning-channel projection
  tool-call-projector.ts      # Gemma/LM Studio native tool-call text projection
  pseudo-tool-call-projector.ts # Gemma XML-like execution artifact projection
```

`GemmaProvider` is the provider shell. It creates or receives an OpenAI SDK client, builds OpenAI-compatible requests, and delegates conversion/parsing/stream assembly to `agent-provider-openai-compatible`. `GemmaReasoningProjector` is a pure stateful projector used by streaming paths to remove Gemma channel markers from user-facing text. `GemmaToolCallProjector` is a provider-owned adapter for the documented Gemma/LM Studio template block shaped as `<|tool_call>call:<tool>{...}<tool_call|>` and for Gemma XML-like execution artifacts. XML-like projection is generic: executable calls are produced only when a tag name or JSON command envelope matches a tool declared in the current request.

## Type Ownership

| Type                              | Location                     | Purpose                                                 |
| --------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `IGemmaProviderOptions`           | `src/types.ts`               | Constructor options for `GemmaProvider`.                |
| `TGemmaProviderOptionValue`       | `src/types.ts`               | Valid provider option value union.                      |
| `IGemmaReasoningProjection`       | `src/reasoning-projector.ts` | Result of projecting raw Gemma text into visible text.  |
| `IGemmaToolCallProjection`        | `src/tool-call-projector.ts` | Result of projecting Gemma native tool-call text.       |
| `IGemmaToolCallProjectorOptions`  | `src/tool-call-projector.ts` | Declared tool names and call-id prefix for projection.  |
| `DEFAULT_GEMMA_PROVIDER_MODEL`    | `src/provider-definition.ts` | Package-owned default Gemma model for setup definition. |
| `DEFAULT_GEMMA_PROVIDER_API_KEY`  | `src/provider-definition.ts` | Package-owned local endpoint API-key default.           |
| `DEFAULT_GEMMA_PROVIDER_BASE_URL` | `src/provider-definition.ts` | Package-owned local OpenAI-compatible base URL default. |

## Public API Surface

| Export                            | Kind       | Description                                                               |
| --------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `GemmaProvider`                   | class      | Primary provider class; extends `AbstractAIProvider`.                     |
| `GemmaReasoningProjector`         | class      | Stateful streaming projector for Gemma reasoning-channel markers.         |
| `GemmaToolCallProjector`          | class      | Stateful projector for documented Gemma/LM Studio native tool-call text.  |
| `projectGemmaReasoningText`       | function   | Stateless full-text projection helper.                                    |
| `projectGemmaToolCallText`        | function   | Stateless full-text native tool-call projection helper.                   |
| `createGemmaProviderDefinition`   | function   | Returns an `IProviderDefinition` for branch-free CLI/runtime composition. |
| `DEFAULT_GEMMA_PROVIDER_MODEL`    | constant   | Default setup model owned by this package.                                |
| `DEFAULT_GEMMA_PROVIDER_API_KEY`  | constant   | Default local endpoint API key owned by this package.                     |
| `DEFAULT_GEMMA_PROVIDER_BASE_URL` | constant   | Default local endpoint base URL owned by this package.                    |
| `IGemmaProviderOptions`           | interface  | Provider constructor options.                                             |
| `TGemmaProviderOptionValue`       | type alias | Valid provider option values.                                             |

## Extension Points

- Consumers can provide a preconfigured OpenAI SDK `client` for custom endpoint behavior.
- Consumers can provide `apiKey`, `baseURL`, and `timeout` for local OpenAI-compatible servers.
- Consumers can provide an executor to delegate provider execution without direct API calls.
- Consumers such as `agent-cli` can inject `createGemmaProviderDefinition()` alongside other provider definitions. The CLI must not special-case Gemma by type string.
- `createGemmaProviderDefinition()` reuses the shared OpenAI-compatible endpoint probe instead of owning a Gemma-specific CLI/setup branch.
- Future Gemma variants can extend projection behavior inside this package without changing generic OpenAI-compatible transport.
- Native and XML-like execution artifact projection is enabled only when declared tools are present. It validates executable calls against the request's tool names, strips Gemma XML artifact wrappers from user-facing text, and does not add CLI/TUI, command, or domain-tool-specific branches.

## Error Taxonomy

| Condition                            | Error pattern                                          | Source                    |
| ------------------------------------ | ------------------------------------------------------ | ------------------------- |
| Missing client, apiKey, and executor | `Either Gemma client, apiKey, or executor is required` | `provider.ts` constructor |
| Missing model                        | `Model is required in chat options...`                 | `provider.ts`             |
| Client unavailable                   | `Gemma client not available...`                        | `provider.ts`             |
| Chat failure                         | `Gemma chat failed: <message>`                         | `provider.ts`             |
| Streaming failure                    | `Gemma stream failed: <message>`                       | `provider.ts`             |

## Test Strategy

- Unit tests cover `GemmaReasoningProjector` for complete markers, split markers across deltas, empty thought channels, and ordinary text.
- Unit tests cover `GemmaToolCallProjector` for documented LM Studio/Gemma tool-call blocks, split streamed blocks, declared-tool validation, and malformed block preservation.
- Unit tests cover XML-like Gemma execution artifacts so declared tool tags and JSON command envelopes are converted to universal tool calls while wrapper tags are removed from visible text.
- Unit tests cover `GemmaProvider` request construction with OpenAI-compatible base URL, tools, streaming text deltas, and model requirement errors.
- Unit tests verify native Gemma tool-call text is converted to universal `toolCalls` before SDK execution sees the response.
- Unit tests verify Gemma XML-like declared tool text is converted to universal `toolCalls` before SDK execution sees the response.
- Unit tests verify raw Gemma marker text is not emitted through `onTextDelta` or final assistant content when the Gemma provider is selected.
- CLI tests verify injected provider definitions are resolved generically without provider-specific branches in CLI logic.

## Class Contract Registry

### Interface Implementations

None.

### Inheritance Chains

| Base (Owner)                      | Derived         | Location          | Notes                                                          |
| --------------------------------- | --------------- | ----------------- | -------------------------------------------------------------- |
| `AbstractAIProvider` (agent-core) | `GemmaProvider` | `src/provider.ts` | Gemma model-family provider using OpenAI-compatible transport. |

### Cross-Package Port Consumers

| Port (Owner)                           | Adapter                         | Location                     |
| -------------------------------------- | ------------------------------- | ---------------------------- |
| `AbstractAIProvider` (agent-core)      | `GemmaProvider`                 | `src/provider.ts`            |
| `IProviderDefinition` (agent-core)     | `createGemmaProviderDefinition` | `src/provider-definition.ts` |
| `TUniversalMessage` (agent-core)       | `GemmaProvider`                 | `src/provider.ts`            |
| OpenAI-compatible transport primitives | `GemmaProvider`                 | `src/provider.ts`            |
| OpenAI-compatible endpoint probe       | `createGemmaProviderDefinition` | `src/provider-definition.ts` |
