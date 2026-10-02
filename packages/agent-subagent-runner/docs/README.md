# agent-subagent-runner — Documentation

`@robota-sdk/agent-subagent-runner` is the optional child-process runner for agent runtime subagents. It
implements `agent-executor`'s `ISubagentRunner` by starting a copy of the running program in worker
mode, sending the job over a validated IPC protocol, and returning a lifecycle handle to the parent
session; worktree isolation wraps each job when enabled.

The runner composes nothing on its own: the composition root states how to start the worker, which
tools and provider registry the child gets, and which worktree adapter to use.

## Documents

- [SPEC.md](./SPEC.md) — package contract: required composition, IPC protocol guarantees, provider
  connection checks, and package boundaries.
- [Package README](../README.md) — installation, usage, and the exported API.
