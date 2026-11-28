---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-session': patch
---

Every tool call of a run now receives the run's session id in its `IToolExecutionContext.sessionId`, including calls in parallel batches and in journaled continuations (`resume`, `resumeToolCalls`, which gain an optional `sessionId`). Before, only plugin hooks saw an id, so a tool that records its source conversation, such as a saved wiki claim, recorded none. A `sessionId` a direct caller sets on the context still wins. A session passes its own id when it resumes a run.
