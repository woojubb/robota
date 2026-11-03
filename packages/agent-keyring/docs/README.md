# agent-keyring Docs

`@robota-sdk/agent-keyring` owns key custody and sealing for secure conversations: a passphrase and a
recovery key each unwrap one master key, the master key derives a sealing keypair, an attach
keypair and an authorship key, and artifacts are encrypted under data keys sealed to the public sealing key so a locked
process can still write. It runs on `node:crypto` only, with no `@robota-sdk` dependency, on Node.js
and Bun.

## Documents

- [Package README](../README.md) — installation and usage.
- [SPEC.md](./SPEC.md) — the contract, invariants, honest limits, non-goals and design decisions.
