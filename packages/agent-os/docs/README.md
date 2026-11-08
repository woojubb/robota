# agent-os Docs

`@robota-sdk/agent-os` holds the Node host primitives of the Robota SDK, one subpath each: bounded
root-relative file reads and atomic UTF-8 writes through a retained native directory authority
(`file-authority`), nonblocking operation locks between cooperating processes (`node-lock`), and
termination of a spawned process and its descendants (`process`). The package has no `@robota-sdk`
dependencies, so any package can depend on it without a cycle. Session, workspace and trust policy
stay with callers.

## Documents

- [Package specification](./SPEC.md) — the package contract and, per subpath, scope, boundaries,
  invariants and design decisions.
- [Package README](../README.md) — installation, the subpaths and what to install for each, and usage.
