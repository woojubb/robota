---
'@robota-sdk/agent-interface-execution': minor
'@robota-sdk/agent-interface-command': minor
'@robota-sdk/agent-subagent-runner': minor
'@robota-sdk/agent-transport-tui': minor
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-executor': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

`/fork [name] [--same-dir]` copies the live conversation into a background session.

The session writes a copy of its own record under a fresh id — messages, system prompt, tool schemas
and full history, and deliberately not the sandbox snapshot, goal, plan or branch — then spawns a
background job carrying only `resumeSessionId`. The child restores that record itself, so no
conversation crosses the child-process boundary and the worker start payload's key set is unchanged.
The background panel gains an `attach` control that switches the terminal onto the forked session; it
is a view switch, never a merge, and a missing record or a terminal task is refused with the task's
own status.

**`@robota-sdk/agent-framework` is `major` for one reason: `ICommandHostSessionAccess` gains a
required member.** `forkSession({ name? })` is not optional, so an external implementation of that
role port stops compiling until it adds the method. Every other change in this set is additive:

- `agent-interface-execution` — `TExecutionControl` gains `'attach'`.
- `agent-interface-command` — `TCommandUiIntent` gains `{ type: 'switch-session'; sessionId }`.
- `agent-subagent-runner` — `ISubagentWorkerComposition` gains the optional `openSessionStore`, and
  the worker resumes a record when the job names one. A composition that registers no store and
  receives no `resumeSessionId` behaves exactly as before.
- `agent-framework` also gains the fork-record builder, `SessionTurnMemory`, and
  `IAgentBackgroundTaskRequest.resumeSessionId?`; `loadSessionRecord` now returns
  `restoredSystemPrompt`, which makes a record field that was written and never read take effect on
  restore.
- `agent-executor`, `agent-command`, `agent-transport-tui`, `agent-cli` — the spawn input, the
  `/fork` module and the attach control that carry it to the surface.
