# @robota-sdk/agent-provider-openai

OpenAI provider for the Robota SDK, built on the official `openai` SDK. `OpenAIProvider` implements
the `@robota-sdk/agent-core` provider contract, so a `Robota` agent can run on OpenAI models with
streaming and tool calling. It is a protocol client rather than a vendor lock: set `baseURL` and the
same provider talks to any OpenAI-compatible endpoint (AI gateways such as Vercel AI Gateway,
LiteLLM or OpenRouter, Azure OpenAI, vLLM, Ollama, LM Studio), with model ids passed through
verbatim.

## Installation

```bash
npm install @robota-sdk/agent-provider-openai @robota-sdk/agent-core
```

## Usage

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'openai', model: 'gpt-4o' },
});

const response = await agent.run('Hello!');
console.log(response);
```

The provider registers under the name `openai`, which is the value `defaultModel.provider` must use.

### OpenAI-compatible endpoints

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

// An OpenAI-protocol gateway serving a non-OpenAI model
const provider = new OpenAIProvider({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: 'https://ai-gateway.vercel.sh/v1',
});
// then: defaultModel: { provider: 'openai', model: 'anthropic/claude-sonnet-4-5' }
```

The API surface follows `baseURL` unless `apiSurface` is set:

| Configuration         | API surface                             |
| --------------------- | --------------------------------------- |
| No `baseURL`          | Responses API (`'responses'`)           |
| `baseURL` set         | Chat Completions (`'chat-completions'`) |
| `apiSurface` provided | The surface you set, either way         |

### Strict tools

`strictTools: true` closes tool object schemas and requests OpenAI strict function calling. Every
object node of a tool's parameter schema, nested ones included, gets `additionalProperties: false`
and a complete `required` list, with optional properties turned into nullable ones, and each function
tool is sent with `strict: true` on both the Responses and Chat Completions surfaces. An
OpenAI-compatible endpoint that rejects the `strict` field needs `strictTools` left off. With
`strictTools` off (the default) tool schemas are forwarded as authored and no `strict` field is sent.

## Options

`new OpenAIProvider(options: IOpenAIProviderOptions)`. One of `apiKey`, `client` or `executor` is
required; the constructor throws otherwise.

| Option               | Type                                       | Description                                                                                                     |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `apiKey`             | `string`                                   | API key used to create the `openai` client.                                                                     |
| `baseURL`            | `string`                                   | Endpoint base URL (default `https://api.openai.com/v1`). Also switches the default surface to Chat Completions. |
| `apiSurface`         | `'responses' \| 'chat-completions'`        | Forces the API surface instead of deriving it from `baseURL`.                                                   |
| `defaultModel`       | `string`                                   | Model used when a call does not name one.                                                                       |
| `organization`       | `string`                                   | OpenAI organization ID.                                                                                         |
| `timeout`            | `number`                                   | Request timeout in milliseconds.                                                                                |
| `strictTools`        | `boolean`                                  | Closes tool object schemas and requests OpenAI strict function calling (see above).                             |
| `responseFormat`     | `'text' \| 'json_object' \| 'json_schema'` | Response format; `'json_schema'` uses `jsonSchema`.                                                             |
| `jsonSchema`         | `IOpenAIJsonSchemaDefinition`              | Schema for Structured Outputs when `responseFormat` is `'json_schema'`.                                         |
| `reasoning`          | `IOpenAIResponsesReasoningOptions`         | Responses API reasoning controls (`effort`, `summary`).                                                         |
| `includeStreamUsage` | `boolean`                                  | Requests token usage on streaming Chat Completions turns (default `true`).                                      |
| `client`             | `OpenAI`                                   | A pre-built `openai` client, used instead of `apiKey`.                                                          |
| `executor`           | `IExecutor`                                | Delegates chat calls to an executor instead of calling the API directly.                                        |
| `payloadLogger`      | `IPayloadLogger`                           | Logs a summary of each Chat Completions request (model, message count, tools present, temperature, max tokens). |
| `logger`             | `ILogger`                                  | Logger for internal provider messages (silent by default).                                                      |

## Exports

- `OpenAIProvider` and its option types (`IOpenAIProviderOptions`, `TOpenAIApiSurface`, and others).
- `createOpenAIProviderDefinition()`: the provider definition used by Robota's built-in provider
  registry.
- `@robota-sdk/agent-provider-openai/loggers`: `FilePayloadLogger` (Node.js, writes log files with
  owner-only permissions) and `ConsolePayloadLogger` (browser console).

## Related packages

- [`@robota-sdk/agent-core`](../agent-core/README.md): the `Robota` agent and the provider contract.
- [`@robota-sdk/agent-provider-openai-compatible`](../agent-provider-openai-compatible/README.md):
  DeepSeek, Qwen and Gemma providers, plus the shared OpenAI-compatible protocol code this package
  uses.
- [`@robota-sdk/agent-provider-anthropic`](../agent-provider-anthropic/README.md) and
  [`@robota-sdk/agent-provider-gemini`](../agent-provider-gemini/README.md): other chat providers.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
