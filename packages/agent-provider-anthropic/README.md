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
use. `createAnthropicProvider(options)` is a factory that returns the same provider typed as
`IAIProvider`.

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
