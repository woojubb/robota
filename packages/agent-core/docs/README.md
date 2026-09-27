# agent-core Docs

`@robota-sdk/agent-core` is the foundation package of the Robota SDK. It owns the `Robota` agent and
its execution loop, the provider, tool and plugin contracts, message and history types, permission
evaluation, the hook runner, event services, usage metadata and typed errors. It has no
`@robota-sdk/*` dependencies.

## Documents

- [Package README](../README.md) — installation, usage and the main exports.
- [SPEC.md](./SPEC.md) — package purpose, contract, invariants and design decisions.
- [HOOK-CATALOG.md](./HOOK-CATALOG.md) — every hook event, its input fields, where it fires and
  whether it can block.
