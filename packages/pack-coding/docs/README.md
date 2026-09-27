# @robota-sdk/pack-coding

`@robota-sdk/pack-coding` owns `createCodingPack(options)`, which bundles Robota's coding capability
into one `ICapabilityPack`: the default coding tools from `agent-tool-defaults`, the `/shell`, `/editor`,
and `/git` command modules from `agent-command`, and the built-in `general-purpose`, `Explore`, and
`Plan` subagents. It re-implements none of them.

The pack is built per session: `cwd` is required so its file tools are always scoped to the session
that constructs it, and each call returns fresh instances.

## Documents

- [SPEC.md](./SPEC.md) — package contract, non-goals, and why the pack is a factory.
- [Package README](../README.md) — installation and usage with `assembleProduct`.
