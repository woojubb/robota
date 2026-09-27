# @robota-sdk/agent-provider-anthropic

Anthropic Claude provider for the Robota SDK, built on the official `@anthropic-ai/sdk`.
`AnthropicProvider` implements the `@robota-sdk/agent-core` provider contract over the Anthropic
Messages API, so a `Robota` agent can run on Claude models with streaming and tool calling. It can
also attach Anthropic's server-side web search tool to requests when you turn it on.

## Installation

```bash
npm install @robota-sdk/agent-provider-anthropic @robota-sdk/agent-core
```

## Usage

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
});

const response = await agent.run('Hello!');
console.log(response);
```

The provider registers under the name `anthropic`, which is the value `defaultModel.provider` must
use. It has no default model of its own: every call must name one (a `Robota` agent passes
`defaultModel.model`), and a call without a model throws. `createAnthropicProvider(options)` is a
factory that returns the same provider typed as `IAIProvider`.

### Structured output and reasoning effort

A request that carries a `json_schema` response format (as a `Robota` run with an `output` schema
can) is sent through Anthropic's native structured output, `output_config.format`. Every object in
the schema is closed (`additionalProperties: false`) on the way out, because Anthropic rejects open
objects. The `text` and `json_object` formats have no Anthropic equivalent; they rely on the
agent-core validation loop instead.

A reasoning-effort selection (`defaultModel.effort` on a `Robota` agent, or `effort` on a chat call)
is sent as `output_config.effort` for models in the provider's verified effort table. The table
applies only when `baseURL` is not set: a gateway's behavior is not Anthropic's, so the provider
claims no effort support there.

### Server-side web search

```typescript
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
provider.configureNativeWebTools({ webSearch: true }); // or: provider.enableWebTools = true
```

Once enabled, Anthropic's `web_search` server tool is included in requests; the API runs it, so no
local tool is registered. A call with `toolChoice: 'none'` leaves it out. Web fetch is not offered
by this provider.

## Options

`new AnthropicProvider(options: IAnthropicProviderOptions)`. One of `apiKey`, `client` or
`executor` is required; the constructor throws otherwise.

| Option     | Type        | Description                                                                                                            |
| ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apiKey`   | `string`    | Anthropic API key used to create the SDK client.                                                                       |
| `baseURL`  | `string`    | Endpoint base URL (default: Anthropic's official endpoint). Any endpoint that speaks the Anthropic Messages API works. |
| `timeout`  | `number`    | Request timeout in milliseconds.                                                                                       |
| `client`   | `Anthropic` | A pre-built `@anthropic-ai/sdk` client, used instead of `apiKey` (for authentication set up outside the API-key flow). |
| `executor` | `IExecutor` | Delegates chat calls to an executor instead of calling the API directly.                                               |

For OpenAI-protocol gateways (Vercel AI Gateway, LiteLLM, OpenRouter), use
`@robota-sdk/agent-provider-openai` with the gateway's `baseURL` and model slug instead.

## Errors

A failed API call throws a typed error from `@robota-sdk/agent-core`: a `RateLimitError` for a rate
limit, otherwise a `ProviderError` that carries the HTTP `status` and Anthropic's error `type` (for
example `overloaded_error`) and keeps the SDK error as `originalError`. A failure Anthropic reports in
the middle of a stream is mapped the same way. An aborted call rethrows the abort unchanged.

## Exports

- `AnthropicProvider`, `createAnthropicProvider()` and the option types
  (`IAnthropicProviderOptions`, `TAnthropicProviderOptionValue`).
- `createAnthropicProviderDefinition()`: the provider definition used by Robota's built-in provider
  registry, with its default constants (for example `DEFAULT_ANTHROPIC_PROVIDER_MODEL`).

## Related packages

- [`@robota-sdk/agent-core`](../agent-core/README.md): the `Robota` agent and the provider contract.
- [`@robota-sdk/agent-provider-openai`](../agent-provider-openai/README.md),
  [`@robota-sdk/agent-provider-gemini`](../agent-provider-gemini/README.md) and
  [`@robota-sdk/agent-provider-openai-compatible`](../agent-provider-openai-compatible/README.md):
  other chat providers.
- [`@robota-sdk/agent-builtin-providers`](../agent-builtin-providers/README.md): the default provider
  definitions, including this one.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
