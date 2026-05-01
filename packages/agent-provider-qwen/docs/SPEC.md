# Qwen Provider Specification

## Scope

This package owns Qwen provider behavior for Robota when Qwen models are served through Alibaba Cloud Model Studio / DashScope OpenAI-compatible Chat Completions endpoints. It composes `agent-provider-openai-compatible` for message conversion, tool conversion, response parsing, streaming assembly, and endpoint probing while owning Qwen/DashScope defaults, setup labels, and error framing.

## Boundaries

- Does not own generic OpenAI-compatible transport conversion, parser behavior, stream assembly, or endpoint probing. Those belong to `agent-provider-openai-compatible`.
- Does not own OpenAI-branded account semantics or OpenAI default models. Those belong to `agent-provider-openai`.
- Does not own Google Gemini/Gemma marker projection. That behavior belongs to provider packages for those model families.
- Does not own native DashScope or OpenAI Responses API behavior. Those require separate transport contracts and are future work.
- Does not own CLI routing, session persistence, tool execution, or SDK orchestration.

## Research

Official Qwen / Alibaba Cloud Model Studio documentation describes OpenAI-compatible Chat Completions as the mature migration path for Qwen chat, streaming, and tool-calling integration. The documented base URLs are region-specific, and API keys are region-bound. This package therefore defaults to the international Singapore compatible endpoint and exposes base URL setup through the common provider-definition contract instead of adding CLI branches.

Sources:

- <https://www.alibabacloud.com/help/en/model-studio/qwen-api-reference/>
- <https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions>
- <https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses>
- <https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-dashscope>
- <https://www.alibabacloud.com/help/en/model-studio/error-code>
- <https://qwenlm.github.io/Qwen-Agent/en/guide/get_started/configuration/>

## Architecture Overview

```
src/
  index.ts                # public exports
  defaults.ts             # Qwen documented defaults and region base URLs
  provider.ts             # QwenProvider
  provider-definition.ts  # provider definition for CLI/runtime composition
  types.ts                # provider options and option value types
```

`QwenProvider` is a thin provider shell over OpenAI-compatible Chat Completions. It creates or receives an OpenAI SDK client, builds OpenAI-compatible request parameters, delegates conversion/parsing/stream assembly to `agent-provider-openai-compatible`, and wraps failures with Qwen-owned error messages. `createQwenProviderDefinition()` returns an `IProviderDefinition` so CLI and SDK composition can inject Qwen without provider-specific branches.

## Type Ownership

| Type                                      | Location          | Purpose                                                     |
| ----------------------------------------- | ----------------- | ----------------------------------------------------------- |
| `IQwenProviderOptions`                    | `src/types.ts`    | Constructor options for `QwenProvider`.                     |
| `TQwenProviderOptionValue`                | `src/types.ts`    | Valid provider option value union.                          |
| `TQwenProviderRegion`                     | `src/defaults.ts` | Supported documented Qwen OpenAI-compatible regions.        |
| `QWEN_PROVIDER_BASE_URLS`                 | `src/defaults.ts` | Region to base URL map owned by this package.               |
| `DEFAULT_QWEN_PROVIDER_MODEL`             | `src/defaults.ts` | Package-owned default Qwen model for setup definition.      |
| `DEFAULT_QWEN_PROVIDER_API_KEY_ENV`       | `src/defaults.ts` | Package-owned default API-key environment variable name.    |
| `DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE` | `src/defaults.ts` | `$ENV:` provider profile reference for the default API key. |
| `DEFAULT_QWEN_PROVIDER_BASE_URL`          | `src/defaults.ts` | Package-owned default OpenAI-compatible base URL.           |

## Public API Surface

| Export                                    | Kind       | Description                                                               |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `QwenProvider`                            | class      | Primary provider class; extends `AbstractAIProvider`.                     |
| `createQwenProviderDefinition`            | function   | Returns an `IProviderDefinition` for branch-free CLI/runtime composition. |
| `QWEN_PROVIDER_BASE_URLS`                 | constant   | Documented Qwen OpenAI-compatible base URLs by region.                    |
| `DEFAULT_QWEN_PROVIDER_MODEL`             | constant   | Default setup model owned by this package.                                |
| `DEFAULT_QWEN_PROVIDER_API_KEY_ENV`       | constant   | Default API-key environment variable name.                                |
| `DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE` | constant   | Default `$ENV:` API-key reference for settings.                           |
| `DEFAULT_QWEN_PROVIDER_BASE_URL`          | constant   | Default setup base URL owned by this package.                             |
| `IQwenProviderOptions`                    | interface  | Provider constructor options.                                             |
| `TQwenProviderOptionValue`                | type alias | Valid provider option values.                                             |
| `TQwenProviderRegion`                     | type alias | Supported region keys for `QWEN_PROVIDER_BASE_URLS`.                      |

## Extension Points

- Consumers can provide a preconfigured OpenAI SDK `client` for custom Qwen-compatible endpoint behavior.
- Consumers can provide `apiKey`, `baseURL`, `timeout`, and `defaultModel`.
- Consumers can provide an executor to delegate provider execution without direct API calls.
- Consumers such as `agent-cli` can inject `createQwenProviderDefinition()` alongside other provider definitions. The CLI and SDK must not special-case Qwen by type string or model name.
- Future native DashScope or Responses API support must be added as explicit Qwen-owned transport capability, not as generic CLI/SDK branches.

## Error Taxonomy

| Condition                            | Error pattern                                         | Source                    |
| ------------------------------------ | ----------------------------------------------------- | ------------------------- |
| Missing client, apiKey, and executor | `Either Qwen client, apiKey, or executor is required` | `provider.ts` constructor |
| Missing API key in provider setup    | `Provider qwen requires apiKey`                       | `provider-definition.ts`  |
| Missing model                        | `Qwen chat/stream failed: Model is required...`       | `provider.ts`             |
| Client unavailable                   | `Qwen client not available...`                        | `provider.ts`             |
| Chat failure                         | `Qwen chat failed: <message>`                         | `provider.ts`             |
| Streaming failure                    | `Qwen stream failed: <message>`                       | `provider.ts`             |

## Test Strategy

- Unit tests verify `createQwenProviderDefinition()` exposes Qwen defaults, setup steps, endpoint probing, and provider creation behavior.
- Unit tests verify `QwenProvider` constructs an OpenAI SDK client with explicit or default Qwen base URL, API key, and timeout.
- Unit tests verify non-streaming chat sends OpenAI-compatible messages/tools and parses native tool calls into universal assistant messages.
- Unit tests verify streaming assembly emits `onTextDelta` values and returns the final assembled assistant response.
- Unit tests verify direct `chatStream` yields universal assistant stream chunks.
- Unit tests verify upstream chat and streaming failures are wrapped with Qwen-owned error messages.
- CLI tests verify Qwen is available through injected default provider definitions without CLI provider-specific branches.

## Class Contract Registry

### Interface Implementations

None.

### Inheritance Chains

| Base (Owner)                      | Derived        | Location          | Notes                                                   |
| --------------------------------- | -------------- | ----------------- | ------------------------------------------------------- |
| `AbstractAIProvider` (agent-core) | `QwenProvider` | `src/provider.ts` | Qwen provider using OpenAI-compatible Chat Completions. |

### Cross-Package Port Consumers

| Port (Owner)                           | Adapter                        | Location                     |
| -------------------------------------- | ------------------------------ | ---------------------------- |
| `AbstractAIProvider` (agent-core)      | `QwenProvider`                 | `src/provider.ts`            |
| `IProviderDefinition` (agent-core)     | `createQwenProviderDefinition` | `src/provider-definition.ts` |
| `TUniversalMessage` (agent-core)       | `QwenProvider`                 | `src/provider.ts`            |
| OpenAI-compatible transport primitives | `QwenProvider`                 | `src/provider.ts`            |
| OpenAI-compatible endpoint probe       | `createQwenProviderDefinition` | `src/provider-definition.ts` |
