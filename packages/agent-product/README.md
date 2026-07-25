# @robota-sdk/agent-product

The **product-assembly kernel** for the Robota SDK.

`assembleProduct(profile)` is a **pure, deterministic, IO-free fold** over an `IProductProfile` — the
composition mechanism a third party imports to build their OWN product on Robota's published runtime.
`robota` is one profile among many; an external repo brings its own.

```ts
import { assembleProduct } from '@robota-sdk/agent-product';

const product = assembleProduct({
  id: 'acme-assistant',
  agentName: 'acme',
  provider, // already-constructed, product-owned
  packs: [acmeJiraPack], // additive capability
  defaultPresetId: 'careful-reviewer', // Robota's built-in preset, reused
});

// The external repo binds product.buildRuntime(...) to ITS OWN presentation/transport.
const session = product.buildRuntime({ session: { cwd, provider } });
```

`assembleProduct` hard-codes no product's choices — everything product-specific arrives as `profile` data.
It resolves presets via a per-call instance-scoped registry (never mutating a global), merges additive
capability packs, and **delegates runtime construction** to `agent-framework`'s `buildRuntimeSession` seam
— it never re-implements runtime assembly, and never imports a concrete transport, the TUI, or the CLI
(those are injected via the profile). See [`docs/SPEC.md`](./docs/SPEC.md).

## License

AGPL-3.0-only OR LicenseRef-Commercial
