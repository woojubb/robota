# DeepSeek Provider Specification

## Scope

This package owns DeepSeek provider behavior for Robota when DeepSeek models are served through
DeepSeek's OpenAI-compatible Chat Completions endpoint. It composes
`agent-provider-openai-compatible` for message conversion, tool conversion, response parsing,
streaming assembly, native replay payload observation, and endpoint probing while owning DeepSeek
defaults, setup labels, model catalog metadata, thinking-mode controls, and error framing.

## Boundaries

- Does not own generic OpenAI-compatible transport conversion, parser behavior, stream assembly, or
  endpoint probing. Those belong to `agent-provider-openai-compatible`.
- Does not own OpenAI-branded account semantics or OpenAI default models. Those belong to
  `agent-provider-openai`.
- Does not own DeepSeek's Anthropic-format API transport. This package starts with the documented
  OpenAI-format base URL.
- Does not own CLI routing, session persistence, tool execution, or SDK orchestration.
- Owns provider-native replay payload selection for DeepSeek Chat Completions calls. Generic layers
  receive only the `IChatOptions.onProviderNativeRawPayload` callback contract and must not import
  concrete SDK types.

## Research

Official DeepSeek API documentation says the API is compatible with OpenAI and Anthropic formats.
The documented OpenAI-format base URL is `https://api.deepseek.com`, authentication uses a DeepSeek
API key, and the documented current models are `deepseek-v4-flash` and `deepseek-v4-pro`.
Compatibility aliases `deepseek-chat` and `deepseek-reasoner` are documented as deprecated on
2026-07-24. The model details page lists JSON output and tool calls as supported features, and the
`/models` endpoint returns currently available model identifiers.

Sources:

- <https://api-docs.deepseek.com/>
- <https://api-docs.deepseek.com/quick_start/pricing>
- <https://api-docs.deepseek.com/api/list-models>
- <https://api-docs.deepseek.com/guides/thinking_mode>
- <https://api-docs.deepseek.com/guides/function_calling>

## Architecture Overview

```text
src/
  index.ts                  # public exports
  defaults.ts               # DeepSeek documented defaults
  provider.ts               # DeepSeekProvider
  provider-definition.ts    # provider definition for CLI/runtime composition
  model-catalog-refresh.ts  # DeepSeek /models catalog refresh adapter
  types.ts                  # provider options and option value types
```

`DeepSeekProvider` is a provider shell over OpenAI-compatible Chat Completions.
`createDeepSeekProviderDefinition()` returns an `IProviderDefinition` so CLI and SDK composition can
inject DeepSeek without provider-specific branches.

## Type Ownership

| Type                                          | Location                       | Purpose                                                |
| --------------------------------------------- | ------------------------------ | ------------------------------------------------------ |
| `IDeepSeekProviderOptions`                    | `src/types.ts`                 | Constructor options for `DeepSeekProvider`.            |
| `TDeepSeekProviderOptionValue`                | `src/types.ts`                 | Valid provider option value union.                     |
| `TDeepSeekThinkingMode`                       | `src/types.ts`                 | DeepSeek thinking toggle value.                        |
| `TDeepSeekReasoningEffort`                    | `src/types.ts`                 | DeepSeek reasoning effort values accepted by settings. |
| `DEFAULT_DEEPSEEK_PROVIDER_MODEL`             | `src/defaults.ts`              | Package-owned default model for setup definition.      |
| `DEFAULT_DEEPSEEK_PROVIDER_API_KEY_ENV`       | `src/defaults.ts`              | Package-owned default API-key environment variable.    |
| `DEFAULT_DEEPSEEK_PROVIDER_API_KEY_REFERENCE` | `src/defaults.ts`              | `$ENV:` provider profile reference for the API key.    |
| `DEFAULT_DEEPSEEK_PROVIDER_BASE_URL`          | `src/defaults.ts`              | Package-owned default OpenAI-compatible base URL.      |
| `refreshDeepSeekModelCatalog()`               | `src/model-catalog-refresh.ts` | Live model catalog refresh adapter.                    |
| `DEEPSEEK_DEPRECATED_ALIAS_RETIREMENT_DATE`   | `src/provider-definition.ts`   | Official alias retirement date.                        |

## Public API Surface

| Export                                        | Kind       | Description                                                               |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `DeepSeekProvider`                            | class      | Primary provider class; extends `AbstractAIProvider`.                     |
| `createDeepSeekProviderDefinition`            | function   | Returns an `IProviderDefinition` for branch-free CLI/runtime composition. |
| `refreshDeepSeekModelCatalog`                 | function   | Refreshes model catalog metadata from DeepSeek `/models`.                 |
| `DEFAULT_DEEPSEEK_PROVIDER_MODEL`             | constant   | Default setup model owned by this package.                                |
| `DEFAULT_DEEPSEEK_PROVIDER_API_KEY_ENV`       | constant   | Default API-key environment variable name.                                |
| `DEFAULT_DEEPSEEK_PROVIDER_API_KEY_REFERENCE` | constant   | Default `$ENV:` API-key reference for settings.                           |
| `DEFAULT_DEEPSEEK_PROVIDER_BASE_URL`          | constant   | Default setup base URL owned by this package.                             |
| `IDeepSeekProviderOptions`                    | interface  | Provider constructor options.                                             |
| `IDeepSeekThinkingConfig`                     | interface  | DeepSeek thinking request object.                                         |
| `TDeepSeekThinkingMode`                       | type alias | DeepSeek thinking toggle.                                                 |
| `TDeepSeekReasoningEffort`                    | type alias | DeepSeek reasoning effort controls.                                       |

## Extension Points

- Consumers can provide a preconfigured OpenAI SDK `client` for custom DeepSeek-compatible endpoint
  behavior.
- Consumers can provide `apiKey`, `baseURL`, `timeout`, `defaultModel`, `thinking`, and
  `reasoningEffort`.
- Consumers can provide an executor to delegate provider execution without direct API calls.
- Consumers such as `agent-cli` can inject `createDeepSeekProviderDefinition()` alongside other
  provider definitions. The CLI and SDK must not special-case DeepSeek by type string or model name.
- Future Anthropic-format DeepSeek transport must be added as explicit DeepSeek-owned capability,
  not as generic CLI/SDK branches.

## Error Taxonomy

| Condition                            | Error pattern                                             | Source                     |
| ------------------------------------ | --------------------------------------------------------- | -------------------------- |
| Missing client, apiKey, and executor | `Either DeepSeek client, apiKey, or executor is required` | `provider.ts` constructor  |
| Missing API key in provider setup    | `Provider deepseek requires apiKey`                       | `provider-definition.ts`   |
| Missing model                        | `DeepSeek chat/stream failed: Model is required...`       | `provider.ts`              |
| Client unavailable                   | `DeepSeek client not available...`                        | `provider.ts`              |
| Chat failure                         | `DeepSeek chat failed: <message>`                         | `provider.ts`              |
| Streaming failure                    | `DeepSeek stream failed: <message>`                       | `provider.ts`              |
| Model refresh failure                | `DeepSeek model refresh failed: HTTP <status>`            | `model-catalog-refresh.ts` |

## Test Strategy

- Unit tests verify `createDeepSeekProviderDefinition()` exposes DeepSeek defaults, setup steps,
  fallback model catalog metadata, endpoint probing, refresh hooks, and provider creation behavior.
- Unit tests verify `DeepSeekProvider` constructs an OpenAI SDK client with explicit or default
  DeepSeek base URL, API key, and timeout.
- Unit tests verify non-streaming chat sends OpenAI-compatible messages/tools and parses native tool
  calls into universal assistant messages.
- Unit tests verify DeepSeek thinking controls are included only through provider-owned options.
- Unit tests verify streaming assembly emits `onTextDelta` values and returns the final assembled
  assistant response.
- Unit tests verify direct `chatStream` yields universal assistant stream chunks.
- Unit tests verify upstream chat and streaming failures are wrapped with DeepSeek-owned error
  messages.
- CLI tests verify DeepSeek is available through injected default provider definitions without CLI
  provider-specific branches.

## Class Contract Registry

### Interface Implementations

None.

### Inheritance Chains

| Base (Owner)                      | Derived            | Location          | Notes                                                       |
| --------------------------------- | ------------------ | ----------------- | ----------------------------------------------------------- |
| `AbstractAIProvider` (agent-core) | `DeepSeekProvider` | `src/provider.ts` | DeepSeek provider using OpenAI-compatible Chat Completions. |

### Cross-Package Port Consumers

| Port (Owner)                           | Adapter                            | Location                       |
| -------------------------------------- | ---------------------------------- | ------------------------------ |
| `AbstractAIProvider` (agent-core)      | `DeepSeekProvider`                 | `src/provider.ts`              |
| `IProviderDefinition` (agent-core)     | `createDeepSeekProviderDefinition` | `src/provider-definition.ts`   |
| `IProviderProfileConfig` (agent-core)  | `refreshDeepSeekModelCatalog`      | `src/model-catalog-refresh.ts` |
| `TUniversalMessage` (agent-core)       | `DeepSeekProvider`                 | `src/provider.ts`              |
| OpenAI-compatible transport primitives | `DeepSeekProvider`                 | `src/provider.ts`              |
| OpenAI-compatible endpoint probe       | `createDeepSeekProviderDefinition` | `src/provider-definition.ts`   |
