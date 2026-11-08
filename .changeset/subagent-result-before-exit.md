---
"@robota-sdk/agent-subagent-runner": patch
---

A subagent worker that sent its result and then exited is no longer reported as a crash. The parent used to fail the job as soon as it was told the worker had exited, even though the result the worker had already written could still be unread; on Windows that surfaced as "Subagent worker exited before result: exit code 0". The parent now waits for the worker's channel to close, which happens after every message it holds has been delivered, before it concludes there is no result.
