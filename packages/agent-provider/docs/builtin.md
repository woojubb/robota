# @robota-sdk/agent-provider/builtin

Robota's default provider set. This package gathers the provider definitions of every built-in chat
provider into one list, supplies the two default media providers (Gemini image generation and
Seedance video generation), and holds Robota's default role-to-model mapping. A host that lets its
users pick a provider by name, such as `@robota-sdk/agent-cli`, reads this package instead of
importing each provider subpath itself.

## Installation

```bash
npm install @robota-sdk/agent-provider @robota-sdk/agent-core openai @anthropic-ai/sdk @google/genai
```

`./builtin` imports every provider subpath, so the three vendor SDKs, which are optional peers of the
package (`openai` `^6.0.0`, `@anthropic-ai/sdk` `^0.114.0`, `@google/genai` `^1.52.0`), are installed
alongside it.

## Usage

Look up a chat provider definition by type and build the provider from it:

```typescript
import {
  ConversationAgent,
  findProviderDefinition,
  resolveEnvReference,
} from '@robota-sdk/agent-core';
import { processEnvResolver } from '@robota-sdk/agent-core/node';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider/builtin';

const definition = findProviderDefinition(createDefaultProviderDefinitions(), 'anthropic');
if (definition === undefined) throw new Error('Unknown provider type');

const model = definition.defaults?.model ?? 'claude-sonnet-4-6';
// defaults.apiKey is a reference such as '$ENV:ANTHROPIC_API_KEY'; resolve it to the key itself.
const apiKey = resolveEnvReference(definition.defaults?.apiKey ?? '', processEnvResolver);

const provider = definition.createProvider({ name: definition.type, model, apiKey });

const agent = new ConversationAgent({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: { provider: provider.name, model },
});

console.log(await agent.run('Hello!'));
```

## Chat provider definitions

`createDefaultProviderDefinitions()` returns one `IProviderDefinition` (the provider contract from
`@robota-sdk/agent-core`) per built-in chat provider:

| `type`                    | Provider subpath                       | `defaults.model`                | `defaults.apiKey`                                                    |
| ------------------------- | -------------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| `anthropic`               | `@robota-sdk/agent-provider/anthropic` | `claude-sonnet-4-6`             | `$ENV:ANTHROPIC_API_KEY`                                             |
| `openai`                  | `@robota-sdk/agent-provider/openai`    | none (a profile names one)      | `$ENV:OPENAI_API_KEY`                                                |
| `gemini` (alias `google`) | `@robota-sdk/agent-provider/gemini`    | `gemini-3-flash-preview`        | `$ENV:GEMINI_API_KEY`                                                |
| `gemma`                   | `@robota-sdk/agent-provider/gemma`     | `supergemma4-26b-uncensored-v2` | none (a local server at `http://localhost:1234/v1`; no key required) |
| `qwen`                    | `@robota-sdk/agent-provider/qwen`      | `qwen-plus`                     | `$ENV:DASHSCOPE_API_KEY`                                             |
| `deepseek`                | `@robota-sdk/agent-provider/deepseek`  | `deepseek-v4-flash`             | `$ENV:DEEPSEEK_API_KEY`                                              |
| `openrouter`              | `@robota-sdk/agent-provider/openai`    | `anthropic/claude-sonnet-4.6`   | `$ENV:OPENROUTER_API_KEY`                                            |

A definition describes a provider for setup and configuration: its `type` and `aliases`, display
name, `defaults` (model, API-key reference, base URL), model catalog and setup steps. Its
`createProvider(config)` builds the provider and uses the `apiKey` it is given as-is, so resolve a
`$ENV:` reference first; `resolveEnvReference(value, resolve)` takes the environment resolver, and
`processEnvResolver` from `@robota-sdk/agent-core/node` reads `process.env`.
`findProviderDefinition(definitions, type)` from `@robota-sdk/agent-core` matches a type or an alias.

A definition also says whether an API key is required (`requiresApiKey`), lists the environment
variables its vendor SDK reads to decide where a request goes or which credential it carries
(`destinationEnvironment`), and may supply a live `probeProfile` check (every definition here except
`anthropic` and `gemini` does). `anthropic` and `openai` also declare, through `nativeWebTools`, the
hosted web tools a host may turn on by default.

OpenRouter exposes browser and API-key connection methods to the host. Both build the same
Chat Completions client at `https://openrouter.ai/api/v1`, with `anthropic/claude-sonnet-4.6` as the
default model; browser authorization and credential storage belong to the CLI/App host, rather than
this definition package. `createOpenRouterProviderDefinition()` builds its provider through the
OpenAI definition.

The ByteDance video provider is not in this list: it is a media provider (see below).

## Default media provider definitions

`createDefaultMediaProviderDefinitions()` returns two `IMediaProviderDefinition`s. A media definition
creates its provider only when it is used, from credentials it reads from environment variables, so a
host can list the definitions before any key is set.

| `type`                                                  | Factory                                   | Builds                                                            | Default model            | Environment                                               |
| ------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- | ------------------------ | --------------------------------------------------------- |
| `gemini-image` (`GEMINI_IMAGE_MEDIA_PROVIDER_TYPE`)     | `createGeminiImageProviderDefinition()`   | A `GoogleProvider` from `@robota-sdk/agent-provider/google`       | `gemini-2.5-flash-image` | `GEMINI_API_KEY`                                          |
| `seedance-video` (`SEEDANCE_VIDEO_MEDIA_PROVIDER_TYPE`) | `createSeedanceVideoProviderDefinition()` | A `BytedanceProvider` from `@robota-sdk/agent-provider/bytedance` | `seedance-2.0`           | `SEEDANCE_API_KEY` and `SEEDANCE_BASE_URL`, both required |

Build a provider from a definition with `createImageProviderFromDefinition(definition, overrides,
resolve)` or `createVideoProviderFromDefinition(definition, overrides, resolve)` from
`@robota-sdk/agent-core`; `resolve` is the environment resolver, such as `processEnvResolver` from
`@robota-sdk/agent-core/node`. They return `undefined` when a required variable is missing;
`resolveMediaProviderConfig(definition, overrides, resolve)` reports which ones.

```typescript
import {
  createImageProviderFromDefinition,
  findMediaProviderDefinition,
} from '@robota-sdk/agent-core';
import { processEnvResolver } from '@robota-sdk/agent-core/node';
import {
  createDefaultMediaProviderDefinitions,
  GEMINI_IMAGE_MEDIA_PROVIDER_TYPE,
} from '@robota-sdk/agent-provider/builtin';

const definition = findMediaProviderDefinition(
  createDefaultMediaProviderDefinitions(),
  GEMINI_IMAGE_MEDIA_PROVIDER_TYPE,
);
if (definition === undefined) throw new Error('Unknown media provider type');

// Reads GEMINI_API_KEY from the environment.
const imageProvider = createImageProviderFromDefinition(definition, {}, processEnvResolver);
if (imageProvider === undefined) throw new Error('Set GEMINI_API_KEY');

const result = await imageProvider.generateImage({
  prompt: 'A watercolor lighthouse at dusk',
  model: definition.defaults?.model ?? 'gemini-2.5-flash-image',
});
if (result.ok) console.log(result.value.outputs);
```

## Default role-to-model mapping

`DEFAULT_ROLE_MODELS` maps a role to an ordered fallback chain of `{ provider, model }` targets,
primary first. Its type, `TRoleModelMap` from `@robota-sdk/agent-core`, fixes no role names; this
constant is Robota's default set:

| Role       | Primary                           | Fallback            |
| ---------- | --------------------------------- | ------------------- |
| `planner`  | `anthropic` / `claude-opus-4-5`   | `openai` / `o3`     |
| `editor`   | `anthropic` / `claude-sonnet-4-5` | `openai` / `gpt-4o` |
| `reviewer` | `anthropic` / `claude-sonnet-4-5` | `openai` / `gpt-4o` |

The map is plain data. The routing helpers that read it live in `@robota-sdk/agent-framework`:

- `resolveRoleModel(map, role)` returns a role's primary target, or `undefined` for an unmapped role.
- `resolveRoleFallbackChain(map, role)` returns the whole chain (empty for an unmapped role).
- `runWithRoleFallback(chain, run, shouldRetry?)` calls `run` with each target in order until one
  succeeds, and rethrows the last error when the chain runs out.
- `createSubagentSession({ roleModels, ... })` gives a subagent without an explicit `model` the first
  model in its role's chain whose provider matches the session's provider. The role is the agent
  definition's `role`, or its `name`.

Nothing passes this map by default: the reference CLI's subagents run on the session's model unless
their agent definition names one. A host opts in to role routing by passing a map as `roleModels`.

To change a role, build your own map from the default:

```typescript
import type { TRoleModelMap } from '@robota-sdk/agent-core';
import { DEFAULT_ROLE_MODELS } from '@robota-sdk/agent-provider/builtin';
import { resolveRoleModel } from '@robota-sdk/agent-framework';

const roleModels: TRoleModelMap = {
  ...DEFAULT_ROLE_MODELS,
  reviewer: [{ provider: 'gemini', model: 'gemini-3-flash-preview' }],
};

resolveRoleModel(roleModels, 'planner'); // { provider: 'anthropic', model: 'claude-opus-4-5' }
```

## Exports

- `createDefaultProviderDefinitions()`: the built-in chat provider definitions.
- `createOpenRouterProviderDefinition()`: the OpenRouter definition, also part of that list.
- `createDefaultMediaProviderDefinitions()`, `createGeminiImageProviderDefinition()`,
  `createSeedanceVideoProviderDefinition()`, and the type constants
  `GEMINI_IMAGE_MEDIA_PROVIDER_TYPE` (`'gemini-image'`) and `SEEDANCE_VIDEO_MEDIA_PROVIDER_TYPE`
  (`'seedance-video'`).
- `DEFAULT_ROLE_MODELS`: the default role-to-model mapping.

## Offline verification

`examples/deepseek-provider-demo.mjs` checks the default composition without API keys or network
access. After building this package and its provider dependencies, run it from this package
directory:

```sh
node examples/deepseek-provider-demo.mjs
```

It checks the DeepSeek definition from `@robota-sdk/agent-provider/deepseek` (type, display
name, default model, API-key reference and base URL, active and deprecated catalog models) and
DeepSeek's place in `createDefaultProviderDefinitions()`. It creates no provider and sends no
request; a failed check exits nonzero. The CLI's use of the same definitions is tested separately in
[`product-assembly-equivalence.test.ts`](../../agent-cli/src/__tests__/product-assembly-equivalence.test.ts),
under `offers the same provider surface`.

## Related packages

- [`@robota-sdk/agent-core`](../../agent-core/README.md): the provider and media provider definition
  contracts, `TRoleModelMap`, and the lookup and factory helpers used above.
- [`@robota-sdk/agent-provider/anthropic`](./anthropic.md),
  [`@robota-sdk/agent-provider/openai`](./openai.md),
  [`@robota-sdk/agent-provider/gemini`](./gemini.md),
  [`deepseek`, `qwen` and `gemma`](./openai-compatible.md) and
  [`@robota-sdk/agent-provider/bytedance`](./bytedance.md): the providers these
  definitions build.
- [`@robota-sdk/agent-framework`](../../agent-framework/README.md): the role routing helpers.
- [`@robota-sdk/agent-cli`](../../agent-cli/README.md): uses these definitions for provider setup and
  startup.

See [SPEC.md](SPEC.md) for the package contract.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../../LICENSE) or a [commercial license](../../../COMMERCIAL.md). See [LICENSING.md](../../../LICENSING.md).
