# agent-session Docs

`@robota-sdk/agent-session` owns the session lifecycle of the Robota SDK: permission-gated tool
execution, lifecycle hooks, context-window tracking, compaction, versioned session logs and replay,
and session-record persistence. Session logs are validated event by event before replay; malformed,
unknown or unversioned logs fail explicitly instead of being treated as recovery data.

## Documents

- [Package README](../README.md) — usage, methods and exports.
- [SPEC.md](./SPEC.md) — package contract, invariants and boundaries.
