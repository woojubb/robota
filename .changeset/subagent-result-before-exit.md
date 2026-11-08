---
"@robota-sdk/agent-subagent-runner": patch
---

A subagent worker that sent its result and then exited is no longer reported as a crash, and a follow-up prompt it had already accepted is no longer reported as dropped. The parent used to fail the job, or reject the waiting prompt, as soon as it was told the worker had exited, even though an answer the worker had already written could still be unread; on Windows that surfaced as "Subagent worker exited before result: exit code 0". The parent now waits for the worker's channel to close, which happens after every message it holds has been delivered, before it concludes there is no answer.
