# Gemma Provider Specification

## Scope

This package owns Gemma model-family provider behavior for Robota when Gemma models are served through OpenAI-compatible Chat Completions endpoints such as LM Studio. It composes `agent-provider-openai-compatible` for transport primitives and owns Gemma-specific text projection for reasoning-channel markers.

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
```

`GemmaProvider` is the provider shell. It creates or receives an OpenAI SDK client, builds OpenAI-compatible requests, and delegates conversion/parsing/stream assembly to `agent-provider-openai-compatible`. `GemmaReasoningProjector` is a pure stateful projector used by streaming paths to remove Gemma channel markers from user-facing text.

## Type Ownership

| Type                              | Location                     | Purpose                                                 |
| --------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `IGemmaProviderOptions`           | `src/types.ts`               | Constructor options for `GemmaProvider`.                |
| `TGemmaProviderOptionValue`       | `src/types.ts`               | Valid provider option value union.                      |
| `IGemmaReasoningProjection`       | `src/reasoning-projector.ts` | Result of projecting raw Gemma text into visible text.  |
| `DEFAULT_GEMMA_PROVIDER_MODEL`    | `src/provider-definition.ts` | Package-owned default Gemma model for setup definition. |
| `DEFAULT_GEMMA_PROVIDER_API_KEY`  | `src/provider-definition.ts` | Package-owned local endpoint API-key default.           |
| `DEFAULT_GEMMA_PROVIDER_BASE_URL` | `src/provider-definition.ts` | Package-owned local OpenAI-compatible base URL default. |

## Public API Surface

| Export                            | Kind       | Description                                                               |
| --------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `GemmaProvider`                   | class      | Primary provider class; extends `AbstractAIProvider`.                     |
| `GemmaReasoningProjector`         | class      | Stateful streaming projector for Gemma reasoning-channel markers.         |
| `projectGemmaReasoningText`       | function   | Stateless full-text projection helper.                                    |
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
- Unit tests cover `GemmaProvider` request construction with OpenAI-compatible base URL, tools, streaming text deltas, and model requirement errors.
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
