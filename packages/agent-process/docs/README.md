# agent-process Docs Index

- `SPEC.md`: The child-process termination contract (`killProcessTree`: SIGTERM → grace → SIGKILL,
  process-group aware), package boundary, and cross-platform behavior.

`@robota-sdk/agent-process` is the single source of truth for terminating a spawned process and its
descendants. It has zero `@robota-sdk` dependencies, so `agent-executor`, `agent-tools`,
`agent-subagent-runner`, and external consumers can depend down onto it without a cycle.
