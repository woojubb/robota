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

- A fork job's log is now read from the file the child writes. The child names its log after the
  session it runs (the forked record, else the task) and the parent read `<taskId>.jsonl`, so
  `/agent read` on a fork job showed "No log lines"; with worktree isolation (the default for
  `/fork`) the read was not offered at all. `resolveSubagentLogSessionId`,
  `resolveSubagentTranscriptPath` and `readSubagentTranscriptPage` (`@robota-sdk/agent-framework`)
  are the one rule both sides use, and `createSubagentLogger` takes an optional last argument
  `{ sealing }`.
- A log with no sealed record pages and reads exactly as before. In a sealed log a page's offset
  counts stored records, so it names the same record whether or not the keys are locked.
  `IBackgroundTaskLogPage` gains an optional `unreadable: { locked, noKeys, doesNotOpen }`; a run of
  locked records shows as one fixed line, and `/agent read` and `/background read` say whether an
  unlock would read them.
- `IInteractiveSessionStore.save` takes optional `{ handoff }`, and the store port gains optional
  `exportHeld(id, { keep })` and `importHeld(id, token)`, implemented by `NodeSessionStore` and
  `WorkspaceProjectSessionStore`: a record written for a fork job is kept apart from the sessions a
  sealing store runs and handed to the job once; an export with `keep` only checks, and leaves it
  for the export that hands it over. `restoreSessionRecordIntoSession` reads the way a
  writer does (`loadSessionForUpdate`), so a fork job run in-process restores the fork `/fork` just
  wrote while the keys are locked. A sealed record a write-only store cannot open loads as
  `{ status: 'locked', reason: 'no-keys' }`.
- `@robota-sdk/agent-subagent-runner`: the runner takes optional `logSealing` and
  `watchSealingKey` and has `refreshWriteGrant()`; with a sealer, the start payload carries the write
  grant (no secret) the sealer issues when the payload is sent and, for a fork job, the parent's held
  record as `resumeHeld` (at most 32 MiB, refused before anything is made for the job otherwise or
  when nothing can be handed over, naming "unlock" only when locked keys are why); a child already
  sent its payload gets a newer grant as a `sealing_key` message. `ISubagentWorkerComposition` gains
  optional `bindWriteGrant(grant)`, which must return a sealer whose `writeGrant()` equals `grant`: a
  payload with a grant and a composition without it, or whose bind returns `'plain'` or a sealer with
  another grant, fails the job, and a child that cannot follow a newer grant stops (before its run
  starts when it is still being built). `ISubagentRunner` gains optional `preflight(job)`, which
  refuses what `start` would and changes nothing: the worktree runner calls it before it prepares a
  worktree, so a refused job leaves no worktree and fires no hook, and the fork record is handed over
  only in `start`, so a job refused before its child is spawned can be run again. A job whose start
  payload cannot be built or sent after its child was spawned now cancels the child before it
  rejects, instead of leaving it waiting.
- Job handles may say `transcriptSealed` (kept in memory, never on task state), which the worktree
  runner forwards with `readLog` and the transcript paths; `IBackgroundTaskManager` gains optional
  `isTranscriptSealed(taskId)`, and `BackgroundJobOrchestrator` an `isTranscriptSealed(taskId)` that
  remembers it after the task closes. SubagentStart/Stop hooks then get `transcript_sealed: true`
  beside the transcript path. `summarizeBackgroundJobGroup` takes optional `{ isTranscriptSealed }`
  (the agent-job host's optional `isBackgroundTaskTranscriptSealed` supplies it) and then points at
  `/agent read <taskId>` instead of the path; a group's saved results keep the path.

What to do: nothing; plain stores, logs and payloads are unchanged. A host that seals passes its
sealing to the child-process runner as `logSealing` and implements `bindWriteGrant` in its worker
composition.
