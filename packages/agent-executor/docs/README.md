# agent-executor Docs

`@robota-sdk/agent-executor` owns the runtime layer for long-running agent runtime work: the background
task manager and its state machine, snapshots, watchdogs and log pages; the shell, scheduled and
tool-invocation runners; the subagent manager and runner ports with worktree isolation; and helpers
that build providers from serializable profiles. The task data contracts belong to
`@robota-sdk/agent-interface-execution`.

## Documents

- [Package README](../README.md) — usage and the main exports.
- [SPEC.md](./SPEC.md) — package contract, ownership and boundaries.
