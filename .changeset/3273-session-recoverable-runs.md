---
'@robota-sdk/agent-session': minor
---

A session can save a pending tool approval and answer it after it is reopened.
`Session.runRecoverable()` runs a prompt with a host-owned execution journal from
`@robota-sdk/agent-core`. When a tool call needs approval, it returns `waiting` with the saved
request (the exact action and its arguments) instead of asking a live approver.
`Session.resumeRecoverable()` takes the answer and continues that execution without adding another
user message; a session recreated with the same session ID, workspace, provider and model can do the
same. Ordinary `run()` keeps asking for approval live.

An approval covers only the action and arguments it was given; it never grants session-wide consent.
Current permissions, hooks and task restrictions are still checked when the tool runs, and a saved
denial holds even if the policy has since become more permissive. Reusing a response ID with
different content is refused.

While an execution waits, the session refuses new prompts. `Session.getPendingExecution()` returns
its `executionId` and saved requests, also after a cancellation that ended the turn once the wait
was saved. A resume refused before it continues, such as a stale response or a storage failure,
leaves the execution pending for another attempt; once it has continued, a later failure ends it
like an ordinary turn. `Session.abandonPendingExecution(executionId)` gives it up so the session
accepts new input: nothing runs and nothing is written to the journal, its open tool calls are
closed as failed in history, and that execution can no longer be resumed. The same journal also
records compaction's model call before history changes, and a journal write failure stays a failure
even when the turn is being cancelled.
