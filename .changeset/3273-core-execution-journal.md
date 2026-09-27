---
'@robota-sdk/agent-core': minor
---

A run can record its model calls and tool effects in a journal the host owns, and continue from it
later. Pass `executionJournal` in the run options: each model request and response, and each tool
call's intent, start and result, is written and awaited before the run moves on. If a write fails,
the run stops with an `ExecutionJournalError`, even when it is also being cancelled; the model never
sees it as a tool failure it could retry. A journaled run waits for a cancelled model call to
finish, because its late reply can still carry usage or tool calls that must be recorded.

With a journal that can also read its records back (`IRecoverableExecutionJournal`), a new `Robota`
for the same conversation continues where the old one stopped, without new user input and without
repeating calls whose results were saved:

- `Robota.resumeToolCalls()` runs the latest saved batch of tool calls without calling the model.
- `Robota.resume()` continues the whole execution, keeping its remaining round and repeated-input
  limits. It refuses a different provider or model. Turn-level lifecycle hooks do not run again, and
  structured output cannot be recovered. A deferred tool the execution had loaded that is no longer
  registered raises `ExecutionRecoveryError`.

A tool can ask for an answer before it acts, through `continuation` on its execution context. The
request is saved and the run ends with `ExecutionSuspendedError`, without a completion or failure.
Tools already running beside it finish and save their real results; only calls not yet started wait.
Answering it through `toolResponses` on a later `resume()` continues the same action; an unanswered
request never lets the tool act. A tool call that may have started without a saved result raises
`ExecutionRecoveryError` and must be reconciled by the host: it is never run again automatically.
`isExecutionControlError` recognizes these errors. `callJournaledProvider`, with an
`IModelJournalContext`, journals a model call made outside a run.
