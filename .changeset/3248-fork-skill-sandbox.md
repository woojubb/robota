---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-subagent-runner': minor
---

A subagent consults the sandbox its shell tools run under, as its parent does. With
`autoAllowBashIfSandboxed` on, a confined command the subagent's gate leaves to the mode now runs
without a prompt. Before, a `context: fork` skill asked for approval, and a print run refused it.
An Agent-tool subagent in `auto` mode sent a command allowed by a broad rule like `Bash(npm *)` to
its classifier instead. A background policy's ceiling is still checked first: nothing outside it
runs.

- `agent-framework` (minor): `createSubagentSession` takes a `commandSandbox` option. The fork and the
  in-process runner derive it from the parent's sandbox, the instance their inherited tools run
  under. `sandboxApprovalFor` is exported.
- `agent-subagent-runner` (minor): `ISubagentWorkerComposition` takes an optional `createSandbox`. The
  worker builds that sandbox once and hands the same instance to `createTools` and to the session.
- `agent-cli` (patch): robota's worker composition builds the OS sandbox through `createSandbox`, so
  a child-process subagent approves what its parent approves.
