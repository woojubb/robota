# @robota-sdk/agent-provider-gemini

Google Gemini provider for the Robota SDK, built on the official `@google/genai` SDK.
`GeminiProvider` implements the `@robota-sdk/agent-core` provider contract, so a `ConversationAgent` agent can
run on Gemini models with streaming and tool calling. It also implements agent-core's
`IImageGenerationProvider` (`generateImage`, `editImage`, `composeImage`).

## Installation

```bash
npm install @robota-sdk/agent-provider-gemini @robota-sdk/agent-core
```

## Usage

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';

const provider = new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY ?? '' });

const agent = new ConversationAgent({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'gemini', model: 'gemini-3-flash-preview' },
});

const response = await agent.run('Hello!');
console.log(response);
```

The provider registers under the name `gemini`, which is the value `defaultModel.provider` must use.

### Image generation

```typescript
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';

const provider = new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY ?? '' });

const result = await provider.generateImage({
  prompt: 'A watercolor lighthouse at dusk',
  model: 'gemini-2.5-flash-image',
});
if (result.ok) {
  // Each output is a `data:` URI reference with its MIME type.
  console.log(result.value.outputs);
} else {
  console.error(result.error.code, result.error.message);
}
```

`editImage` takes one input image and `composeImage` two or more, each with a prompt and a model.
Image methods return a result object instead of throwing (see Errors).

### Reasoning effort and web tools

A reasoning-effort selection (`defaultModel.effort` on a `ConversationAgent` agent, or `effort` on a chat call)
is sent as Gemini's `thinkingConfig.thinkingLevel` for models in the provider's verified effort
table; other models report the effort as not applied. Other `thinkingConfig` fields are kept. When a
call selects an effort, a static `thinkingConfig.thinkingLevel` must equal the level sent and a static
`thinkingBudget` is rejected; if the selection sends no native effort (`auto`, or a model outside
the table), either static field is rejected.

Gemini offers no native web search or web fetch through this provider. A request that asks for them
(`nativeWebTools`) fails with an error instead of being silently ignored.

### Endpoint

There is no `baseURL` option: the `@google/genai` client is created from `apiKey` alone. The SDK
reads its own environment variables to choose where it connects, such as `GOOGLE_GENAI_USE_VERTEXAI`,
`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GEMINI_BASE_URL` and `GOOGLE_VERTEX_BASE_URL`,
so set those to reach Vertex AI or another endpoint.

## Options

`new GeminiProvider(options: IGeminiProviderOptions)`.

| Option                      | Type                                         | Description                                                                                      |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `apiKey`                    | `string`                                     | Google AI API key (required).                                                                    |
| `defaultModel`              | `string`                                     | Model used when a call does not name one.                                                        |
| `responseMimeType`          | `'text/plain' \| 'application/json'`         | Response MIME type.                                                                              |
| `responseSchema`            | `Record<string, TGeminiProviderOptionValue>` | Response schema for JSON output. Mutually exclusive with `responseJsonSchema`.                   |
| `responseJsonSchema`        | `Record<string, TGeminiProviderOptionValue>` | JSON Schema for structured output. Mutually exclusive with `responseSchema`.                     |
| `safetySettings`            | `IGeminiSafetySetting[]`                     | Default safety settings for every request; a per-request `google.safetySettings` overrides them. |
| `thinkingConfig`            | `IGeminiThinkingConfig`                      | Default thinking configuration (`includeThoughts`, `thinkingBudget`, `thinkingLevel`).           |
| `toolConfig`                | `Record<string, TGeminiProviderOptionValue>` | Function-calling config passed through to Gemini.                                                |
| `defaultResponseModalities` | `Array<'TEXT' \| 'IMAGE'>`                   | Default response modalities.                                                                     |
| `imageCapableModels`        | `string[]`                                   | When set, a request for image output is rejected unless its model is in this list.               |
| `executor`                  | `IExecutor`                                  | Delegates chat calls to an executor instead of calling the API directly.                         |

## Errors

A failed chat or stream call throws a typed error from `@robota-sdk/agent-core`: `RateLimitError`,
`AuthenticationError`, `ModelNotAvailableError` or `NetworkError` when the failure is one of those,
otherwise a `ProviderError` that carries the HTTP `status` and keeps the SDK error as
`originalError`. The Google SDK exposes no response headers, so `RateLimitError.retryAfter` is always
undefined. An aborted call rethrows the abort unchanged. See [Provider failures](../../content/guide/error-handling.md#provider-failures).

Image methods never throw. A request with missing input (empty prompt or model, too few images for
`composeImage`, an unusable image source) returns `PROVIDER_INVALID_REQUEST`; a failed call, or a
response without an image, returns `PROVIDER_UPSTREAM_ERROR`.

## Exports

- `GeminiProvider` and its option types (`IGeminiProviderOptions`, `IGeminiThinkingConfig`,
  `IGeminiSafetySetting`).
- `createGeminiProviderDefinition()`: the provider definition used by Robota's built-in provider
  registry (type `gemini`, alias `google`), with its default constants (for example
  `DEFAULT_GEMINI_PROVIDER_MODEL`).
- `@robota-sdk/agent-provider-gemini/google`: the deprecated `GoogleProvider` compatibility alias
  (registers as `google`). New code should use `GeminiProvider`.

## Related packages

- [`@robota-sdk/agent-core`](../agent-core/README.md): the `ConversationAgent` agent, the provider contract and
  the media provider interfaces.
- [`@robota-sdk/agent-provider-openai`](../agent-provider-openai/README.md),
  [`@robota-sdk/agent-provider-anthropic`](../agent-provider-anthropic/README.md) and
  [`@robota-sdk/agent-provider-openai-compatible`](../agent-provider-openai-compatible/README.md):
  other chat providers.
- [`@robota-sdk/agent-builtin-providers`](../agent-builtin-providers/README.md): the default provider
  definitions, including this one.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
