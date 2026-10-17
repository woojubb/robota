# @robota-sdk/agent-transport-acp

The Agent Client Protocol transport for the Robota SDK. `createAcpTransport` serves one attached
session as an ACP v1 agent over stdio-style byte streams, so an editor that launches the process can
prompt it, watch its tool calls, answer its permission requests and cancel its turns.

The session, its permission model and the workspace trust decision belong to the host; this package
owns the protocol mapping, the carrier lifecycle and the refusals that keep an editor from widening
what the session can do.

## Documents

- [SPEC.md](./SPEC.md) — package contract, invariants and design decisions.
- [README](../README.md) — installation, usage and options.
