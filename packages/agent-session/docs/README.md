# Sessions Docs Index

`@robota-sdk/agent-session` owns session lifecycle behavior: permission-aware execution, hooks, history persistence, compaction, and session-run orchestration.

## Current Capabilities

- Session execution emits provider usage and execution-boundary callbacks to SDK consumers.
- Versioned session logs are decoded by event name before replay. Malformed or unknown events fail
  explicitly, including nested messages; unversioned logs are not treated as valid recovery data.
- System prompt composition includes session-owned context sections supplied by the SDK.

## Documents

- [Package README](../README.md) — package usage overview.
- [SPEC.md](./SPEC.md) — session management scope and package boundaries.
