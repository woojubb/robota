# @robota-sdk/agent-capability-pack

`@robota-sdk/agent-capability-pack` owns the additive capability-bundle contract: the `ICapabilityPack`
shape (command modules, tools, and subagents a consumer adds to a product), the `IMergedCapabilities`
result, and the pure `mergeCapabilityPacks` merger that folds packs onto a product's base command
modules and reports every collision instead of overriding it.

It performs no session assembly and no I/O, and never executes contributed code. `@robota-sdk/agent-product`
consumes the merger when it assembles a product; `@robota-sdk/pack-coding` is the built-in pack.

## Documents

- [SPEC.md](./SPEC.md) — package contract, collision rules, and why a pack is executable code rather
  than declarative JSON.
- [Package README](../README.md) — installation and usage.
