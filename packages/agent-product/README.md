# @robota-sdk/agent-product

The **product-assembly kernel** for the Robota SDK.

`assembleProduct(profile)` is a **pure, deterministic, IO-free fold** over an `IProductProfile` — the
composition mechanism a third party imports to build their OWN product on Robota's published runtime.
`robota` is one profile among many; an external repo brings its own.

```ts
import { assembleProduct } from '@robota-sdk/agent-product';
import type { ICapabilityPack } from '@robota-sdk/agent-capability-pack';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

declare const providerDefinitions: readonly IProviderDefinition[]; // e.g. agent-builtin-providers
declare const provider: IAIProvider;
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
const session = product.buildRuntime({ session: { cwd, provider } });
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
(those are injected via the profile). See [`docs/SPEC.md`](./docs/SPEC.md).

## License

AGPL-3.0-only OR LicenseRef-Commercial
