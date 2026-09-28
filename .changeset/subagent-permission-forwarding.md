---
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/agent-interface-execution': patch
---

A background agent's tool call that needs approval now reaches a person instead of being refused
automatically. The child process asks the parent session's own approver, identified as a background
agent naming its task, and parks the call until an answer arrives; cancelling the task dismisses any
still-parked ask immediately rather than leaving it outstanding. A parent with no approver attached
(print mode, a truly headless run) still fails every such call closed, the same default as before.

An agent task's result and its background-task-workspace entry now report how many of its tool calls
were refused and why (denied by a person, no approver attached, the approver itself failed, or the
task ended before an attached approver answered) — present only when at least one call was refused, so
a task that finished as it always did carries no new field.

A workspace entry for a `/loop`-managed iteration now carries a stable `loopId`, so a surface can stop
the loop itself rather than only cancelling its disposable wake timer, and a snapshot can include a
self-paced loop summary for an iteration that has no background-task entry of its own yet.
