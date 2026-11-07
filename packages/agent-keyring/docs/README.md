# agent-keyring Docs

`@robota-sdk/agent-keyring` owns key custody and sealing for secure conversations: a passphrase and a
recovery key each unwrap one master key, the master key derives a sealing keypair, an attach
keypair and an authorship key, and artifacts are encrypted under data keys sealed to the public sealing key so a locked
process can still write. An unlock yields the read keys; the attach key stays in a short-lived owner
handover, which certifies served runtimes and proves the owner on the owner link, the handshake and
frame protection by which a runtime receives the read keys. It runs on `node:crypto` only, with no
`@robota-sdk` dependency, on Node.js and Bun.

## Documents

- [Package README](../README.md) — installation and usage.
- [SPEC.md](./SPEC.md) — the contract, invariants, honest limits, non-goals and design decisions.
