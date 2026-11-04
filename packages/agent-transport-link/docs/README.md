# agent-transport-link Docs

`@robota-sdk/agent-transport-link` carries the owner link over a local byte stream: the
`agent-keyring` handshake and sealed frames, the unchanged session protocol of `agent-transport`,
and the owner vocabulary (trust-root install, read grants, lock, the accept question and control
commands). A runtime answers through domain-typed ports and decides there what each link's standing
may do.

## Documents

- [SPEC.md](./SPEC.md) — the contract, invariants, non-goals and design decisions.
- [README](../README.md) — installation, usage and API.
