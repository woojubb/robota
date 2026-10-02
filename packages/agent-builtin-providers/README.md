# @robota-sdk/agent-builtin-providers

Robota's default provider set. This package gathers the provider definitions of every built-in chat
provider into one list, supplies the two default media providers (Gemini image generation and
Seedance video generation), and holds Robota's default role-to-model mapping. A host that lets its
users pick a provider by name, such as `@robota-sdk/agent-cli`, reads this package instead of
importing each provider package itself.

## Installation

```bash
npm install @robota-sdk/agent-builtin-providers @robota-sdk/agent-core
```

The provider packages (`@robota-sdk/agent-provider-anthropic`, `-openai`, `-gemini`,
`-openai-compatible` and `-bytedance`) and their vendor SDKs are installed as dependencies.

## Usage

Look up a chat provider definition by type and build the provider from it:

```typescript
import { ConversationAgent, findProviderDefinition, resolveEnvReference } from '@robota-sdk/agent-core';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';

const definition = findProviderDefinition(createDefaultProviderDefinitions(), 'anthropic');
if (definition === undefined) throw new Error('Unknown provider type');

const model = definition.defaults?.model ?? 'claude-sonnet-4-6';
// defaults.apiKey is a reference such as '$ENV:ANTHROPIC_API_KEY'; resolve it to the key itself.
const apiKey = resolveEnvReference(definition.defaults?.apiKey ?? '');

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

| `type`                    | Provider package                               | `defaults.apiKey`                                                          |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| `anthropic`               | `@robota-sdk/agent-provider-anthropic`         | `$ENV:ANTHROPIC_API_KEY`                                                   |
| `openai`                  | `@robota-sdk/agent-provider-openai`            | `$ENV:OPENAI_API_KEY`                                                      |
| `gemini` (alias `google`) | `@robota-sdk/agent-provider-gemini`            | `$ENV:GEMINI_API_KEY`                                                      |
| `gemma`                   | `@robota-sdk/agent-provider-openai-compatible` | `lm-studio` (placeholder for a local server at `http://localhost:1234/v1`) |
| `qwen`                    | `@robota-sdk/agent-provider-openai-compatible` | `$ENV:DASHSCOPE_API_KEY`                                                   |
| `deepseek`                | `@robota-sdk/agent-provider-openai-compatible` | `$ENV:DEEPSEEK_API_KEY`                                                    |

A definition describes a provider for setup and configuration: its `type` and `aliases`, display
name, `defaults` (model, API-key reference, base URL), model catalog and setup steps. Its
`createProvider(config)` builds the provider and uses the `apiKey` it is given as-is, so resolve a
`$ENV:` reference first. `findProviderDefinition(definitions, type)` from `@robota-sdk/agent-core`
matches a type or an alias.

The ByteDance video provider is not in this list: it is a media provider (see below).

## Default media provider definitions

`createDefaultMediaProviderDefinitions()` returns two `IMediaProviderDefinition`s. A media definition
creates its provider only when it is used, from credentials it reads from environment variables, so a
host can list the definitions before any key is set.

| `type`                                                  | Factory                                   | Builds                                                                | Default model            | Environment                                               |
| ------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------- |
| `gemini-image` (`GEMINI_IMAGE_MEDIA_PROVIDER_TYPE`)     | `createGeminiImageProviderDefinition()`   | An image generation provider from `@robota-sdk/agent-provider-gemini` | `gemini-2.5-flash-image` | `GEMINI_API_KEY`                                          |
| `seedance-video` (`SEEDANCE_VIDEO_MEDIA_PROVIDER_TYPE`) | `createSeedanceVideoProviderDefinition()` | A `BytedanceProvider` from `@robota-sdk/agent-provider-bytedance`     | `seedance-2.0`           | `SEEDANCE_API_KEY` and `SEEDANCE_BASE_URL`, both required |

Build a provider from a definition with `createImageProviderFromDefinition()` or
`createVideoProviderFromDefinition()` from `@robota-sdk/agent-core`. They return `undefined` when a
required variable is missing; `resolveMediaProviderConfig(definition)` reports which ones.

```typescript
import {
  createImageProviderFromDefinition,
  findMediaProviderDefinition,
} from '@robota-sdk/agent-core';
import {
  createDefaultMediaProviderDefinitions,
  GEMINI_IMAGE_MEDIA_PROVIDER_TYPE,
} from '@robota-sdk/agent-builtin-providers';

const definition = findMediaProviderDefinition(
  createDefaultMediaProviderDefinitions(),
  GEMINI_IMAGE_MEDIA_PROVIDER_TYPE,
);
if (definition === undefined) throw new Error('Unknown media provider type');

// Reads GEMINI_API_KEY from the environment.
const imageProvider = createImageProviderFromDefinition(definition);
if (imageProvider === undefined) throw new Error('Set GEMINI_API_KEY');

const result = await imageProvider.generateImage({
  prompt: 'A watercolor lighthouse at dusk',
  model: definition.defaults?.model ?? 'gemini-2.5-flash-image',
});
if (result.ok) console.log(result.value.outputs);
```

Robota's default DAG node catalog loads these definitions for its image and video nodes.

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
import { DEFAULT_ROLE_MODELS } from '@robota-sdk/agent-builtin-providers';
import { resolveRoleModel } from '@robota-sdk/agent-framework';

const roleModels: TRoleModelMap = {
  ...DEFAULT_ROLE_MODELS,
  reviewer: [{ provider: 'gemini', model: 'gemini-3-flash-preview' }],
};

resolveRoleModel(roleModels, 'planner'); // { provider: 'anthropic', model: 'claude-opus-4-5' }
```

## Exports

- `createDefaultProviderDefinitions()`: the built-in chat provider definitions.
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

It checks the DeepSeek definition from `@robota-sdk/agent-provider-openai-compatible` (type, display
name, default model, API-key reference and base URL, active and deprecated catalog models) and
DeepSeek's place in `createDefaultProviderDefinitions()`. It creates no provider and sends no
request; a failed check exits nonzero. The CLI's use of the same definitions is tested separately in
[`product-assembly-equivalence.test.ts`](../agent-cli/src/__tests__/product-assembly-equivalence.test.ts),
under `offers the same provider surface`.

## Related packages

- [`@robota-sdk/agent-core`](../agent-core/README.md): the provider and media provider definition
  contracts, `TRoleModelMap`, and the lookup and factory helpers used above.
- [`@robota-sdk/agent-provider-anthropic`](../agent-provider-anthropic/README.md),
  [`@robota-sdk/agent-provider-openai`](../agent-provider-openai/README.md),
  [`@robota-sdk/agent-provider-gemini`](../agent-provider-gemini/README.md),
  [`@robota-sdk/agent-provider-openai-compatible`](../agent-provider-openai-compatible/README.md) and
  [`@robota-sdk/agent-provider-bytedance`](../agent-provider-bytedance/README.md): the providers these
  definitions build.
- [`@robota-sdk/agent-framework`](../agent-framework/README.md): the role routing helpers.
- [`@robota-sdk/agent-cli`](../agent-cli/README.md): uses these definitions for provider setup and
  startup.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
