# agent-local-host Docs

`@robota-sdk/agent-local-host` is the private Node-only authority for owner-controlled local runtime state: the keyring file store, the owner-private session directory and control carrier through which a supervised runtime is registered and reached, and the proof that a registered runtime is the daemon serving a workspace. Product hosts supply the paths and keep responsibility for secrets and admission. The package is not published to npm.

## Documents

- [Package README](../README.md) — what the package provides.
- [SPEC.md](./SPEC.md) — the contract, invariants, non-goals and design decisions.
