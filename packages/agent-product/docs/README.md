# @robota-sdk/agent-product

`@robota-sdk/agent-product` owns the product-assembly kernel: the `IProductProfile` declaration, the
`IAssembledProduct` result, and `assembleProduct(profile)`, a pure, deterministic, I/O-free fold that
turns a profile into runtime materials. It resolves presets in a per-call registry, merges capability
packs through `mergeCapabilityPacks`, constructs the provider from already-resolved settings, and
delegates runtime construction to `agent-framework`.

It hard-codes no product: identity is supplied by the host profile, and the package never imports a concrete
transport, the TUI, or the CLI.

The pieces a product is assembled from are subpaths of the same package, each documented beside the
contract: the capability-pack contract, presets and output styles, the slash-command modules, and
Robota's coding pack.

## Documents

- [SPEC.md](./SPEC.md) — package contract, the pure-fold property, boundaries and the contract of each subpath.
- [Package README](../README.md) — installation, entry points and usage.
- [capability-pack.md](./capability-pack.md) — the additive capability-bundle contract and its merger.
- [preset.md](./preset.md) — presets, output styles and their registries.
- [command.md](./command.md) — the slash-command modules.
- [coding.md](./coding.md) — Robota's coding capability pack.
