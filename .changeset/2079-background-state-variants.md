---
'@robota-sdk/agent-interface-execution': major
'@robota-sdk/agent-executor': major
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-command': patch
---

Discriminate `IBackgroundTaskState` by kind, the same way `TBackgroundTaskRequest` and (as of the
prior change) `TBackgroundTaskResult` already are. Fields only one runner ever produces now live
only on that kind's member instead of being optional-and-cross-kind-reachable on every kind:

- `agent`-only: `agentType`, `isolation`, `resumeSessionId`, `promptPreview`, and the
  worktree-isolation fields (`worktreePath`, `branchName`, `worktreeStatus`, `worktreeNextAction`,
  `worktreeBaseRevision`, `parentWorktreeStatus`).
- `scheduled`-only: `schedule`, `nextFireAt`.
- Every kind except `agent`: `commandPreview` (a process command, an MCP tool-invocation summary, or
  a schedule's shell command / wake instruction).
- `state.result` is now `IBackgroundTaskResult<K>` — correlated with `state.kind`, not the free
  full-result union.

`pid`, `logPath`, and `transcriptPath` stay on the shared base rather than becoming agent- or
process-exclusive: the runner handle SPI already reports them for whichever runner's process
happens to produce them, and a subagent run via the worktree/child-process runner carries a `pid`
exactly as a `process`-kind task does. `timeoutReason` also stays base — session restore sets
`'stale_worker'` on any non-terminal, non-rearmable task regardless of kind, not only agent ones.

`IBackgroundTaskState<K>` narrows to the kind-specific member; called with no type argument it is
still the full union. The session-record decoder (`agent-session`) now rejects a persisted task
state carrying a field outside its own kind as corrupt, reported at that field's own path, the same
way it already rejects a `state.result` whose kind disagrees with `state.kind`.

**Breaking for `@robota-sdk/agent-interface-execution` and `@robota-sdk/agent-executor`**: code that
read a kind-specific field (e.g. `state.agentType`, `state.schedule`, `state.commandPreview`) off an
unnarrowed `IBackgroundTaskState` needs to narrow on `state.kind` first, since the fallback default
no longer carries every field on every kind. `agent-session`, `agent-framework`, and `agent-command`
land the corresponding narrowing at every read site the type change touched; no runtime behavior
changes there beyond the state decoder's new corruption checks.
