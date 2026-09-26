# @robota-sdk/agent-provider-gemini

Google Gemini provider for the Robota SDK, built on the official `@google/genai` SDK.
`GeminiProvider` implements the `@robota-sdk/agent-core` provider contract, so a `Robota` agent can
run on Gemini models with streaming and tool calling. It also implements agent-core's
`IImageGenerationProvider` (`generateImage`, `editImage`, `composeImage`).

## Installation

```bash
npm install @robota-sdk/agent-provider-gemini @robota-sdk/agent-core
```

## Usage

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';

const provider = new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY ?? '' });

const agent = new Robota({
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

Image methods return a result object (`{ ok: true, value }` or `{ ok: false, error }`) instead of
throwing.

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

## Exports

- `GeminiProvider` and its option types (`IGeminiProviderOptions`, `IGeminiThinkingConfig`,
  `IGeminiSafetySetting`).
- `createGeminiProviderDefinition()`: the provider definition used by Robota's built-in provider
  registry (type `gemini`, alias `google`), with its default constants (for example
  `DEFAULT_GEMINI_PROVIDER_MODEL`).
- `@robota-sdk/agent-provider-gemini/google`: the deprecated `GoogleProvider` compatibility alias
  (registers as `google`). New code should use `GeminiProvider`.

## Related packages

- [`@robota-sdk/agent-core`](../agent-core/README.md): the `Robota` agent, the provider contract and
  the media provider interfaces.
- [`@robota-sdk/agent-provider-openai`](../agent-provider-openai/README.md),
  [`@robota-sdk/agent-provider-anthropic`](../agent-provider-anthropic/README.md) and
  [`@robota-sdk/agent-provider-openai-compatible`](../agent-provider-openai-compatible/README.md):
  other chat providers.
- [`@robota-sdk/agent-builtin-providers`](../agent-builtin-providers/README.md): the default provider
  definitions, including this one.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
