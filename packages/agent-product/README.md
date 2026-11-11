# @robota-sdk/agent-product

The **product-assembly kernel** for the Robota SDK.

`assembleProduct(profile)` is a **pure, deterministic, IO-free fold** over an `IProductProfile` — the
composition mechanism a third party imports to build their OWN product on Robota's published runtime.
Product identity and its runtime settings are supplied by the host; an external repo can define its own profile.
The root entry is platform-neutral: it runs in a browser, a Web Worker, Node, Deno and Bun, and has no
Node adapter. The pieces a product is assembled from are subpaths of the same package: the capability-pack
contract, presets, the slash-command modules and Robota's coding pack. The ones that need a Node host are
marked below.

## Installation

```bash
npm install @robota-sdk/agent-product
```

## Entry points

| Import path                                 | Environment      | What it contains                                                                                     |
| ------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-product`                 | browser and Node | `assembleProduct`, `IProductProfile`, `IAssembledProduct`                                            |
| `@robota-sdk/agent-product/capability-pack` | browser and Node | `ICapabilityPack`, `mergeCapabilityPacks` ([docs/capability-pack.md](docs/capability-pack.md))       |
| `@robota-sdk/agent-product/preset`          | browser and Node | `IPreset`, the built-in presets and output styles, the registries ([docs/preset.md](docs/preset.md)) |
| `@robota-sdk/agent-product/preset/node`     | Node only        | `loadExternalPresetsFromDir`                                                                         |
| `@robota-sdk/agent-product/command`         | browser and Node | The slash-command modules, `createDefaultCommandModules` ([docs/command.md](docs/command.md))        |
| `@robota-sdk/agent-product/command/node`    | Node only        | The host commands (`/shell`, `/editor`) and the Node adapters the commands take by injection         |
| `@robota-sdk/agent-product/coding`          | Node only        | `createCodingPack`, Robota's coding capability pack ([docs/coding.md](docs/coding.md))               |

## Usage

```ts
import { createNodeFrameworkHost } from '@robota-sdk/agent-framework/node';
import { assembleProduct } from '@robota-sdk/agent-product';
import { createDefaultTools } from '@robota-sdk/agent-tools/defaults';
import type { ICapabilityPack } from '@robota-sdk/agent-product/capability-pack';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

declare const providerDefinitions: readonly IProviderDefinition[]; // e.g. from @robota-sdk/agent-provider/builtin
declare const acmeJiraPack: ICapabilityPack;
declare const cwd: string;

const product = assembleProduct({
  id: 'acme-assistant',
  agentName: 'acme',
  providerDefinitions,
  // The SHELL resolves settings/env and passes the result in as data; the kernel constructs the
  // provider from it. Omit `providerSettings` and pass a pre-built `provider` to override.
  providerSettings: { name: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-…' },
  packs: [acmeJiraPack], // additive capability
  defaultPresetId: 'careful-reviewer', // Robota's built-in preset, reused
});

// The external repo binds product.buildRuntime(...) to ITS OWN presentation/transport.
// A provider passed in the session options would take precedence over the constructed one.
if (product.provider === undefined) throw new Error('no provider configured');
// The platform the session runs on, and the directory it works in: the kernel assumes neither.
const host = createNodeFrameworkHost({ createDefaultTools });
const session = product.buildRuntime({ session: { host, cwd, provider: product.provider } });
void product.acceptedPacks;
void product.rejectedCapabilities;
void product.rejectedPacks;
void session;
```

`assembleProduct` hard-codes no product's choices — everything product-specific arrives as `profile` data.
It resolves presets via a per-call instance-scoped registry (never mutating a global), merges additive
capability packs while preserving accepted metadata and both rejection channels, and **delegates runtime
construction** to `agent-framework`'s `buildRuntimeSession` seam
— it never re-implements runtime assembly, and never imports a concrete transport, the TUI, or the CLI
(those are injected via the profile).

## Exports

- `assembleProduct(profile)` — the fold.
- `IProductProfile` — the product declaration: identity, provider surface, presets, capability packs, base
  command modules, and injected plumbing.
- `IAssembledProduct` — the result: the constructed provider, the merged command modules, tools, and
  subagents, accepted pack metadata and both rejection channels, the preset registry and resolved
  default preset, `buildRuntimeOptions(input)` (the session options with the product's materials laid
  on top, for inspection), and `buildRuntime(input)`.
- `IBuildRuntimeInput` — the session options the shell resolves and passes to `buildRuntime`.

Capability packs come from the [`capability-pack`](docs/capability-pack.md) subpath;
[`coding`](docs/coding.md) is Robota's coding pack. See [`docs/SPEC.md`](./docs/SPEC.md) for the full
contract.

## License

AGPL-3.0-only OR LicenseRef-Commercial
