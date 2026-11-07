# agent-tool-defaults Docs

`@robota-sdk/agent-tool-defaults` owns the Robota SDK's default tool set. `createDefaultTools()`
returns nine tools, or seven when a `sandboxClient` with its own file system is supplied (`Glob` and
`Grep` are then left out). It is a separate leaf so that the tool set is chosen at a composition root;
`@robota-sdk/agent-framework` never imports it: the composition root passes `createDefaultTools` to
`createNodeFrameworkHost`, and a session built without a tool list of its own gets that tier.

## Documents

- [Package README](../README.md) — usage, the tool table and the options.
- [SPEC.md](./SPEC.md) — package contract and design decisions.
