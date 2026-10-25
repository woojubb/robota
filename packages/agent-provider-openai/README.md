# @robota-sdk/agent-provider-openai

OpenAI provider for the Robota SDK, built on the official `openai` SDK. `OpenAIProvider` implements
the `@robota-sdk/agent-core` provider contract, so a `ConversationAgent` agent can run on OpenAI models with
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
import { ConversationAgent } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

const agent = new ConversationAgent({
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
// (a gateway model slug, passed through to the gateway as written)
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

### Parallel function-call generation

Set `parallelToolCalls` on the provider to send the exact boolean as `parallel_tool_calls`:
Chat Completions sends it only on requests that include tools, the only requests it constrains,
while Responses sends it on every request. This holds for plain `chat()`,
callback-driven `chat()` and `chatStream()`:

```typescript
const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  parallelToolCalls: false,
});
```

The policy is captured at construction; later changes to the options object do not change it.
Omitting it leaves the native field absent and retains existing behavior. Provider profiles can
set the same boolean in `options.parallelToolCalls`; `null` and other non-boolean values are rejected.
An explicit policy with an invalid `apiSurface` is also rejected before a profile can fall back to
its default surface. Explicit policies cannot be used with an executor: constructor injection fails
immediately, and a later `configure()` injection makes calls fail before dispatch or callbacks.

This requests a generation policy, independently of `toolChoice` and `strictTools`. It does not
guarantee exactly one call, valid arguments or execution order, and it does not schedule tool
handlers. All returned calls and usage remain visible, even if an endpoint returns multiple calls
under `false`. A compatible endpoint may reject or ignore the field; verify support for the endpoint
and model you use.

### Extra request-body fields

Only the fields this provider manages, and those in `extraBody`, are sent; other unknown constructor
or chat-option keys never reach the endpoint. Set `extraBody` for endpoint-specific options the
provider does not model, such as a gateway's upstream settings. Its fields are merged as top-level
fields into every request body on both API surfaces, with or without tools, for plain `chat()`,
callback-driven `chat()` and `chatStream()`, and raw-payload request events show the merged body:

```typescript
const provider = new OpenAIProvider({
  apiKey: process.env.GATEWAY_API_KEY,
  baseURL: 'https://gateway.example.com/v1',
  parallelToolCalls: false,
  extraBody: { providerOptions: { upstream: { disableParallelToolUse: true } } },
});
```

The value is copied at construction; later changes to the object do not change requests, and an
empty object is the same as omitting it. It must be JSON data: `null`, booleans, strings, finite
numbers, arrays and plain objects; anything JSON serialization would drop or alter (`undefined`,
functions, `NaN`, `Date`, class instances, cycles) makes the constructor throw. So does a field
the provider writes on either surface, or one that would change the response shape it parses or
add server-side history to the full history it already sends: `model`, `messages`, `input`,
`previous_response_id`, `conversation`, `tools`, `tool_choice`, `parallel_tool_calls`,
`functions`, `function_call`, `web_search_options`, `stream`, `stream_options`, `n`,
`background`, `modalities`, `audio`, `response_format`, `text`, `max_tokens`,
`max_completion_tokens`, `max_output_tokens`, `temperature`, `reasoning`, `reasoning_effort`,
`include` and `store`. Use the typed provider or chat option where one exists; the list applies to
both surfaces, so a field the provider writes only on the other surface is refused too. Provider
profiles accept the same object in `options.extraBody`. Like an explicit `parallelToolCalls`, it
cannot be used with an executor; set it on the provider the executor runs instead. The endpoint
decides what the fields do, and they are sent, like the rest of the body, to the configured
endpoint.

### Reasoning effort and web tools

A reasoning-effort selection (`defaultModel.effort` on a `ConversationAgent` agent, or `effort` on a chat call)
is sent as `reasoning.effort` only on the official Responses API (no `baseURL`) and only for models
in the provider's verified effort table. On Chat Completions, behind a custom `baseURL`, or for other
models, the effort is reported as not applied and no native field is sent. When a call selects an
effort, a static `reasoning` option's `effort` must equal the value sent; a different value, or any
value when no native effort is sent, is rejected.

Native web search and web fetch are not available through this provider on either surface. Setting
`nativeWebTools.webSearch` or `nativeWebTools.webFetch` to `true` makes the constructor throw.

## Options

`new OpenAIProvider(options: IOpenAIProviderOptions)`. One of `apiKey`, `client` or `executor` is
required; the constructor throws otherwise.

| Option                      | Type                                       | Description                                                                                                     |
| --------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `apiKey`                    | `string`                                   | API key used to create the `openai` client.                                                                     |
| `baseURL`                   | `string`                                   | Endpoint base URL (default `https://api.openai.com/v1`). Also switches the default surface to Chat Completions. |
| `apiSurface`                | `'responses' \| 'chat-completions'`        | Forces the API surface instead of deriving it from `baseURL`.                                                   |
| `defaultModel`              | `string`                                   | Model used when a call does not name one.                                                                       |
| `organization`              | `string`                                   | OpenAI organization ID.                                                                                         |
| `timeout`                   | `number`                                   | Request timeout in milliseconds.                                                                                |
| `strictTools`               | `boolean`                                  | Closes tool object schemas and requests OpenAI strict function calling (see above).                             |
| `parallelToolCalls`         | `boolean`                                  | Captured native parallel function-call generation policy; omitted by default and incompatible with executors.   |
| `extraBody`                 | `TOpenAIExtraBody`                         | JSON fields merged into every request body; provider-managed fields are rejected (see above).                   |
| `responseFormat`            | `'text' \| 'json_object' \| 'json_schema'` | Response format; `'json_schema'` uses `jsonSchema`.                                                             |
| `jsonSchema`                | `IOpenAIJsonSchemaDefinition`              | Schema for Structured Outputs when `responseFormat` is `'json_schema'`.                                         |
| `reasoning`                 | `IOpenAIResponsesReasoningOptions`         | Responses API reasoning controls (`effort`, `summary`).                                                         |
| `store`                     | `boolean`                                  | Responses API only: whether OpenAI stores the response; when unset, OpenAI's default applies.                   |
| `includeEncryptedReasoning` | `boolean`                                  | Responses API only: asks for encrypted reasoning items, so reasoning can continue without server-side state.    |
| `nativeWebTools`            | `IOpenAINativeWebToolsOptions`             | Not supported: `true` for `webSearch` or `webFetch` throws (see above).                                         |
| `includeStreamUsage`        | `boolean`                                  | Requests token usage on streaming Chat Completions turns (default `true`).                                      |
| `client`                    | `OpenAI`                                   | A pre-built `openai` client, used instead of `apiKey`.                                                          |
| `executor`                  | `IExecutor`                                | Delegates chat calls to an executor instead of calling the API directly.                                        |
| `payloadLogger`             | `IPayloadLogger`                           | Logs a summary of each Chat Completions request (model, message count, tools present, temperature, max tokens). |
| `logger`                    | `ILogger`                                  | Logger for internal provider messages (silent by default).                                                      |

## Errors

A failed API call throws a typed error from `@robota-sdk/agent-core`: `RateLimitError` (with
`retryAfter` from the `retry-after` header), `AuthenticationError`, `ModelNotAvailableError` or
`NetworkError` when the failure is one of those, otherwise a `ProviderError` that carries the HTTP
`status` and the error `type` the endpoint reported and keeps the SDK error as `originalError`. Both
API surfaces, streaming included, map failures the same way. An aborted call rethrows the abort
unchanged. See [Provider failures](../../content/guide/error-handling.md#provider-failures).

## Exports

- `OpenAIProvider` and its option types (`IOpenAIProviderOptions`, `TOpenAIApiSurface`, and others).
- `createOpenAIProviderDefinition()`: the provider definition used by Robota's built-in provider
  registry.
- `@robota-sdk/agent-provider-openai/loggers`: `FilePayloadLogger` (Node.js, writes log files with
  owner-only permissions) and `ConsolePayloadLogger` (browser console).

## Related packages

- [`@robota-sdk/agent-core`](../agent-core/README.md): the `ConversationAgent` agent and the provider contract.
- [`@robota-sdk/agent-provider-openai-compatible`](../agent-provider-openai-compatible/README.md):
  DeepSeek, Qwen and Gemma providers, plus the shared OpenAI-compatible protocol code this package
  uses.
- [`@robota-sdk/agent-provider-anthropic`](../agent-provider-anthropic/README.md) and
  [`@robota-sdk/agent-provider-gemini`](../agent-provider-gemini/README.md): other chat providers.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
