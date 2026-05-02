# Agent Runtime Docs

`@robota-sdk/agent-runtime` owns background task and subagent lifecycle primitives shared by CLI, SDK, and transports.

## Current Capabilities

- Background task state machine, task snapshots, terminal state tracking, and watchdog behavior.
- Subagent manager contracts for spawning, tracking, and collecting background agent work.
- Runtime-owned summaries used by CLI tree rows and transport status surfaces.

## Documents

- [Package README](../README.md) — package overview.
- [SPEC.md](SPEC.md) — package contract, ownership, public API, and verification expectations.
