# @robota-sdk/agent-product

`@robota-sdk/agent-product` owns the product-assembly kernel: the `IProductProfile` declaration, the
`IAssembledProduct` result, and `assembleProduct(profile)`, a pure, deterministic, I/O-free fold that
turns a profile into runtime materials. It resolves presets in a per-call registry, merges capability
packs through `mergeCapabilityPacks`, constructs the provider from already-resolved settings, and
delegates runtime construction to `agent-framework`.

It hard-codes no product: identity is supplied by the host profile, and the package never imports a concrete
transport, the TUI, or the CLI.

## Documents

- [SPEC.md](./SPEC.md) — package contract, the pure-fold property, and boundaries.
- [Package README](../README.md) — installation and usage.
