# Sessions Docs Index

`@robota-sdk/agent-sessions` owns session lifecycle behavior: permission-aware execution, hooks, history persistence, compaction, and session-run orchestration.

## Current Capabilities

- Session execution emits provider usage and execution-boundary callbacks to SDK consumers.
- Session logs can include replay-oriented events, while deterministic `/resume` replay remains follow-up work.
- System prompt composition includes session-owned context sections supplied by the SDK.

## Documents

- [Package README](../README.md) — package usage overview.
- [SPEC.md](./SPEC.md) — session management scope and package boundaries.
