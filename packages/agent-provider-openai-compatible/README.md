# @robota-sdk/agent-provider-openai-compatible

OpenAI-compatible providers for the Robota SDK: `DeepSeekProvider`, `QwenProvider` and
`GemmaProvider`. Each one speaks the OpenAI-compatible protocol through the `openai` SDK and
implements the `@robota-sdk/agent-core` provider contract, so it can be passed to a `Robota` agent
like any other provider. The package also ships the shared OpenAI-compatible protocol code
(message and tool conversion, request building, response parsing, stream assembly) under its
`./shared` entry; these providers and `@robota-sdk/agent-provider-openai` are built on it.

## Installation

```bash
npm install @robota-sdk/agent-provider-openai-compatible @robota-sdk/agent-core
```

## Usage

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { DeepSeekProvider } from '@robota-sdk/agent-provider-openai-compatible';

const provider = new DeepSeekProvider({ apiKey: process.env.DEEPSEEK_API_KEY });

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'deepseek', model: 'deepseek-v4-flash' },
});

const response = await agent.run('Hello!');
console.log(response);
```

The other providers are constructed the same way:

```typescript
import { GemmaProvider, QwenProvider } from '@robota-sdk/agent-provider-openai-compatible';

const qwen = new QwenProvider({ apiKey: process.env.DASHSCOPE_API_KEY });

// A local OpenAI-compatible server, e.g. LM Studio
const gemma = new GemmaProvider({ apiKey: 'lm-studio', baseURL: 'http://localhost:1234/v1' });
```

## Providers

| Provider           | `defaultModel.provider` | Default endpoint                                               | Notes                                                                                                                                                                                             |
| ------------------ | ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DeepSeekProvider` | `'deepseek'`            | `https://api.deepseek.com`                                     | `thinking` (`'enabled' \| 'disabled'`) and `reasoningEffort` are sent as DeepSeek's `thinking` and `reasoning_effort` request fields.                                                             |
| `QwenProvider`     | `'qwen'`                | DashScope OpenAI-compatible endpoint (Singapore region)        | `builtInWebTools: { webSearch, webFetch }` switches requests to DashScope's Responses endpoint with its server-side web search / web extractor tools; `responsesBaseURL` overrides that endpoint. |
| `GemmaProvider`    | `'gemma'`               | None of its own: set `baseURL` to the server hosting the model | Removes Gemma's reasoning-channel text from visible output and turns tool calls the model writes as text into structured tool calls.                                                              |

## Common options

All three providers accept these options. One of `apiKey`, `client` or `executor` is required; the
constructor throws otherwise.

| Option         | Type        | Description                                                                                   |
| -------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `apiKey`       | `string`    | API key used to create the `openai` client.                                                   |
| `baseURL`      | `string`    | Endpoint base URL. Any OpenAI-compatible server works; model ids are passed through verbatim. |
| `timeout`      | `number`    | Request timeout in milliseconds.                                                              |
| `defaultModel` | `string`    | Model used when a call does not name one.                                                     |
| `client`       | `OpenAI`    | A pre-built `openai` client, used instead of `apiKey`.                                        |
| `executor`     | `IExecutor` | Delegates chat calls to an executor instead of calling the API directly.                      |
| `logger`       | `ILogger`   | Logger for internal provider messages (silent by default).                                    |

## Exports

- `DeepSeekProvider`, `QwenProvider`, `GemmaProvider` and their option types.
- `createDeepSeekProviderDefinition()`, `createQwenProviderDefinition()`,
  `createGemmaProviderDefinition()`: provider definitions used by Robota's built-in provider
  registry, with their default constants (for example `DEFAULT_DEEPSEEK_PROVIDER_BASE_URL`).
- `@robota-sdk/agent-provider-openai-compatible/shared`: the shared protocol layer, including
  `convertToOpenAICompatibleMessages`, `convertToOpenAICompatibleTools`,
  `buildOpenAICompatibleRequestParams`, `OpenAICompatibleResponseParser`,
  `assembleOpenAICompatibleStream` and `probeOpenAICompatibleProfile`.

## Related packages

- [`@robota-sdk/agent-core`](../agent-core/README.md): the `Robota` agent and the provider contract.
- [`@robota-sdk/agent-provider-openai`](../agent-provider-openai/README.md): the OpenAI provider,
  which also reaches OpenAI-compatible gateways through `baseURL`.
- [`@robota-sdk/agent-builtin-providers`](../agent-builtin-providers/README.md): the default provider
  definitions, including the ones exported here.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
