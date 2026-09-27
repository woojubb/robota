# agent-tool-defaults Docs

`@robota-sdk/agent-tool-defaults` owns the Robota SDK's default tool set. `createDefaultTools()`
returns ten tools, or eight when a `sandboxClient` with its own file system is supplied (`Glob` and
`Grep` are then left out), and adds `CodebaseRetrieval` or the computer-use tools only when their
adapters are supplied. It is a separate leaf so that the tool set is chosen at a composition root;
`@robota-sdk/agent-framework` loads it only when a session is built without a tool list of its own.

## Documents

- [Package README](../README.md) — usage, the tool table and the options.
- [SPEC.md](./SPEC.md) — package contract and design decisions.
