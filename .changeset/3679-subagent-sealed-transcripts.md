---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-interface-execution': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-executor': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-subagent-runner': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

Subagent transcripts and fork jobs work with sealed conversation stores.

What breaks, and what to do:

- `createChildProcessSubagentRunnerFactory` and `ChildProcessSubagentRunner` require `logSealing`:
  how the children keep their logs, `{ sealer }` or `'plain'`. A host that seals passes its sealer
  and implements `bindWriteGrant(grant)` in its worker composition; any other host passes `'plain'`.
- `createSubagentLogger(parentSessionId, agentId, baseLogsDir, { sealing }, fs?)` requires `sealing`
  as its fourth argument, ahead of the optional file system; pass `'plain'` for a plain log.

What is new:

- A fork job's log is now read from the file the child writes. The child names its log after the
  session it runs (the forked record, else the task) and the parent read `<taskId>.jsonl`, so
  `/agent read` on a fork job showed "No log lines", and with worktree isolation (the default for
  `/fork`) the read was not offered at all. `resolveSubagentLogSessionId`,
  `resolveSubagentTranscriptPath` and `readSubagentTranscriptPage(path, { sealing })`
  (`@robota-sdk/agent-framework`) are the one rule both sides use.
- In a sealed log a page's offset counts stored records, so it names the same record whether or not
  the keys are locked. `IBackgroundTaskLogPage` gains an optional `unreadable` count of records the
  page could not show (`locked`, `noKeys`, `doesNotOpen`); a run of locked records shows as one fixed
  line, and `/agent read` and `/background read` say whether an unlock would read them.
- `IInteractiveSessionStore.save` takes optional `{ handoff }`, and the store port gains optional
  `exportHeld(id, { keep })` and `importHeld(id, token)`, implemented by `NodeSessionStore` and
  `WorkspaceProjectSessionStore`: a record written for a fork job is kept apart from the sessions a
  sealing store runs and handed to the job once. `restoreSessionRecordIntoSession` reads the way a
  writer does, so an in-process fork job restores the fork `/fork` just wrote while the keys are
  locked. A sealed record a write-only store cannot open loads as
  `{ status: 'locked', reason: 'no-keys' }`.
- `@robota-sdk/agent-subagent-runner`: with a sealer, the start payload carries the write grant (no
  secret) the sealer issues when the payload is sent and, for a fork job, the parent's held record as
  `resumeHeld` (at most 32 MiB; the job is refused before anything is made for it when none can be
  handed over, naming "unlock" only when locked keys are why). A child already sent its payload gets
  a newer grant as a `sealing_key` message, and one that cannot follow it stops. `bindWriteGrant`
  must return a sealer whose `writeGrant()` equals the grant, or the job fails. `ISubagentRunner`
  gains optional `preflight(job)`, which refuses what `start` would and changes nothing; the worktree
  runner calls it before it prepares a worktree. A job whose start payload cannot be built or sent
  after its child was spawned now cancels the child before it rejects.
- Job handles may say `transcriptSealed`, and the manager projects it into the task state beside
  `transcriptPath` (`IBackgroundTaskState`, `ISubagentJobState`), where the session record codec
  accepts it. A job-group result gets `transcriptSealed` too. SubagentStart/Stop hooks get
  `transcript_sealed: true` beside the transcript path, and `summarizeBackgroundJobGroup` points at
  `/agent read <taskId>` instead of the path, also for a group restored in a later session.
