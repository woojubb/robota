# agent-process Docs

`@robota-sdk/agent-process` is the one place the Robota SDK terminates a spawned process and its
descendants (`killProcessTree`: SIGTERM → grace → SIGKILL, process-group aware). It has no
`@robota-sdk` dependencies, so `agent-executor`, `agent-tools`, `agent-subagent-runner` and external
consumers can depend on it without a cycle.

## Documents

- [Package README](../README.md) — usage and the API.
- [SPEC.md](./SPEC.md) — the termination contract, package boundary and cross-platform behaviour.
