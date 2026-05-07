# Qwen Provider Specification

## Scope

This package owns Qwen provider behavior for Robota when Qwen models are served through Alibaba Cloud Model Studio / DashScope OpenAI-compatible endpoints. It composes `agent-provider-openai-compatible` for Chat Completions message conversion, tool conversion, response parsing, streaming assembly, and endpoint probing while owning Qwen/DashScope defaults, setup labels, Responses API built-in web tools, and error framing.

## Boundaries

- Does not own generic OpenAI-compatible transport conversion, parser behavior, stream assembly, or endpoint probing. Those belong to `agent-provider-openai-compatible`.
- Does not own OpenAI-branded account semantics or OpenAI default models. Those belong to `agent-provider-openai`.
- Does not own Google Gemini/Gemma marker projection. That behavior belongs to provider packages for those model families.
- Owns the Qwen Responses API slice for provider-side `web_search` and `web_extractor`. Broader native DashScope behavior and non-web Responses built-in tools remain future work.
- Does not own CLI routing, session persistence, tool execution, or SDK orchestration.
- Owns provider-native replay payload selection for Qwen OpenAI-compatible Chat Completions and Qwen Responses API calls. Generic layers receive only the `IChatOptions.onProviderNativeRawPayload` callback contract and must not import concrete SDK types.

## Research

Official Qwen / Alibaba Cloud Model Studio documentation describes OpenAI-compatible Chat Completions as the mature migration path for Qwen chat, streaming, and tool-calling integration. It separately documents OpenAI-compatible Responses API support for built-in tools, including `web_search` and `web_extractor`. Web extractor documentation recommends Responses API for new integrations and says it exposes intermediate tool execution status. The documented base URLs are region-specific, and API keys are region-bound. This package therefore defaults to the international Singapore compatible endpoints and exposes provider-specific Responses options through the generic provider-definition `options` bag instead of adding CLI branches.

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
  responses-converter.ts  # Qwen Responses API input/tool conversion
  responses-parser.ts     # Qwen Responses API response/event parsing
  types.ts                # provider options and option value types
```

`QwenProvider` is a provider shell over OpenAI-compatible Chat Completions plus a Qwen-owned Responses API path. Normal chat uses `agent-provider-openai-compatible`. When `builtInWebTools.webSearch` or `builtInWebTools.webFetch` is enabled, the provider switches to Responses API, sends provider-side built-in tool declarations, parses provider-side tool events, and records provenance in assistant-message metadata. `createQwenProviderDefinition()` returns an `IProviderDefinition` with official setup help links so CLI and SDK composition can inject Qwen without provider-specific branches.

## Type Ownership

| Type                                      | Location          | Purpose                                                     |
| ----------------------------------------- | ----------------- | ----------------------------------------------------------- |
| `IQwenProviderOptions`                    | `src/types.ts`    | Constructor options for `QwenProvider`.                     |
| `TQwenProviderOptionValue`                | `src/types.ts`    | Valid provider option value union.                          |
| `TQwenProviderRegion`                     | `src/defaults.ts` | Supported documented Qwen OpenAI-compatible regions.        |
| `TQwenProviderResponsesRegion`            | `src/defaults.ts` | Supported documented Qwen Responses API regions.            |
| `QWEN_PROVIDER_BASE_URLS`                 | `src/defaults.ts` | Region to base URL map owned by this package.               |
| `QWEN_PROVIDER_RESPONSES_BASE_URLS`       | `src/defaults.ts` | Region to Responses API base URL map owned by this package. |
| `IQwenBuiltInWebToolsOptions`             | `src/types.ts`    | Qwen-owned switch for provider-side web search/fetch tools. |
| `DEFAULT_QWEN_PROVIDER_MODEL`             | `src/defaults.ts` | Package-owned default Qwen model for setup definition.      |
| `DEFAULT_QWEN_PROVIDER_API_KEY_ENV`       | `src/defaults.ts` | Package-owned default API-key environment variable name.    |
| `DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE` | `src/defaults.ts` | `$ENV:` provider profile reference for the default API key. |
| `DEFAULT_QWEN_PROVIDER_BASE_URL`          | `src/defaults.ts` | Package-owned default OpenAI-compatible base URL.           |

## Public API Surface

| Export                                     | Kind       | Description                                                                                                                   |
| ------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `QwenProvider`                             | class      | Primary provider class; extends `AbstractAIProvider`.                                                                         |
| `createQwenProviderDefinition`             | function   | Returns an `IProviderDefinition` with Qwen setup prompts, official setup help links, and branch-free CLI/runtime composition. |
| `QWEN_PROVIDER_BASE_URLS`                  | constant   | Documented Qwen OpenAI-compatible base URLs by region.                                                                        |
| `QWEN_PROVIDER_RESPONSES_BASE_URLS`        | constant   | Documented Qwen Responses API base URLs by region.                                                                            |
| `DEFAULT_QWEN_PROVIDER_MODEL`              | constant   | Default setup model owned by this package.                                                                                    |
| `DEFAULT_QWEN_PROVIDER_API_KEY_ENV`        | constant   | Default API-key environment variable name.                                                                                    |
| `DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE`  | constant   | Default `$ENV:` API-key reference for settings.                                                                               |
| `DEFAULT_QWEN_PROVIDER_BASE_URL`           | constant   | Default setup base URL owned by this package.                                                                                 |
| `DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL` | constant   | Default Responses API base URL owned by this package.                                                                         |
| `IQwenBuiltInWebToolsOptions`              | interface  | Provider-side web search/fetch configuration.                                                                                 |
| `IQwenProviderOptions`                     | interface  | Provider constructor options.                                                                                                 |
| `TQwenProviderOptionValue`                 | type alias | Valid provider option values.                                                                                                 |
| `TQwenProviderRegion`                      | type alias | Supported region keys for `QWEN_PROVIDER_BASE_URLS`.                                                                          |

## Extension Points

- Consumers can provide a preconfigured OpenAI SDK `client` for custom Qwen-compatible endpoint behavior.
- Consumers can provide `apiKey`, `baseURL`, `responsesBaseURL`, `timeout`, `defaultModel`, and `builtInWebTools`.
- Consumers can provide an executor to delegate provider execution without direct API calls.
- Consumers such as `agent-cli` can inject `createQwenProviderDefinition()` alongside other provider definitions. The CLI and SDK must not special-case Qwen by type string or model name.
- Future native DashScope or non-web Responses API support must be added as explicit Qwen-owned transport capability, not as generic CLI/SDK branches.
- When `IChatOptions.onProviderNativeRawPayload` is provided, `QwenProvider` emits provider-native `request`, non-streaming `response`, and ordered streaming `stream_event` payloads before universal normalization. Chat Completions events use the `chat-completions` API surface label; built-in web tool Responses events use the `responses` API surface label. Session logging owns redaction and payload externalization.

### Built-in Web Tools

Qwen built-in web tools are provider-side capabilities, not Robota local tools. When enabled:

- `builtInWebTools.webSearch: true` sends `web_search`.
- `builtInWebTools.webFetch: true` sends both `web_search` and `web_extractor`, matching Alibaba's Responses API web extractor guidance.
- `builtInWebTools.enableThinking` maps to Qwen's `enable_thinking` request field.
- Provider-side tool usage is recorded in assistant metadata as `providerToolMode`, `providerBuiltInToolsEnabled`, `providerBuiltInToolsUsed`, `qwenWebSearchCalls`, and `qwenWebExtractorCalls`.

`QwenProvider.getCapabilities()` reports provider-native web search and fetch as supported. The enabled state follows `builtInWebTools`: `webSearch` is enabled when `webSearch` or `webFetch` is true, and `webFetch` is enabled only when `webFetch` is true. Request-level `IChatOptions.nativeWebTools` must fail before transport execution if the requested tool is supported but not enabled by provider-owned configuration.

`code_interpreter` is intentionally unsupported in this package slice. If Qwen returns unsupported provider-side tool metadata, the parser records it as `qwenUnsupportedProviderToolTypes`; it does not execute or emulate that tool locally.

## Error Taxonomy

| Condition                            | Error pattern                                         | Source                    |
| ------------------------------------ | ----------------------------------------------------- | ------------------------- |
| Missing client, apiKey, and executor | `Either Qwen client, apiKey, or executor is required` | `provider.ts` constructor |
| Missing API key in provider setup    | `Provider qwen requires apiKey`                       | `provider-definition.ts`  |
| Missing model                        | `Qwen chat/stream failed: Model is required...`       | `provider.ts`             |
| Client unavailable                   | `Qwen client not available...`                        | `provider.ts`             |
| Responses client unavailable         | `Qwen Responses client not available...`              | `provider.ts`             |
| Chat failure                         | `Qwen chat failed: <message>`                         | `provider.ts`             |
| Streaming failure                    | `Qwen stream failed: <message>`                       | `provider.ts`             |
| Responses failure                    | `Qwen responses failed: <message>`                    | `provider.ts`             |

## Test Strategy

- Unit tests verify `createQwenProviderDefinition()` exposes Qwen defaults, setup steps, endpoint probing, and provider creation behavior.
- Unit tests verify `QwenProvider` constructs an OpenAI SDK client with explicit or default Qwen base URL, API key, and timeout.
- Unit tests verify non-streaming chat sends OpenAI-compatible messages/tools and parses native tool calls into universal assistant messages.
- Unit tests verify streaming assembly emits `onTextDelta` values and returns the final assembled assistant response.
- Unit tests verify direct `chatStream` yields universal assistant stream chunks.
- Unit tests verify Responses API requests include `web_search` and `web_extractor` according to provider options.
- Unit tests verify capability reporting for disabled and enabled built-in web tool configuration.
- Unit tests verify streamed `response.output_text.delta` events emit visible deltas and final metadata records provider-side tool provenance.
- Unit tests verify Responses API `function_call` output remains a local Robota tool call and is not logged as provider-side built-in tool execution.
- Unit tests verify upstream chat and streaming failures are wrapped with Qwen-owned error messages.
- CLI tests verify Qwen is available through injected default provider definitions without CLI provider-specific branches.
- CLI tests verify provider-owned `options` are passed through the generic provider config bag.

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
| Qwen Responses API conversion/parsing  | `QwenProvider`                 | `src/responses-*.ts`         |
