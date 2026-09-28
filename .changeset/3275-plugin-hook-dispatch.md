---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-plugin': patch
---

A `Robota` run now calls every plugin hook it declares. `beforeConversation` runs with
`beforeExecution`; `beforeToolCall` and `beforeToolExecution` run for each tool call before the
batch starts, and `afterToolCall` after it settles; `onStreamingChunk` runs for each streamed piece
of text, in order, before the round goes on. A call whose arguments could not be read never runs
and gets none of the tool-call hooks.

So `EventEmitterPlugin` now emits `CONVERSATION_START` and `TOOL_BEFORE_EXECUTE`, and `TOOL_ERROR`
for a tool call that failed: the run result's `toolCalls` now carry each call's id and
`result: null` for a failure. `ExecutionAnalyticsPlugin` records tool-call timings and failures,
which it never received before. `EXECUTION_START`, `EXECUTION_COMPLETE` and `EXECUTION_ERROR` are
marked deprecated: no run emits them; the `AGENT_EXECUTION_*` events are the ones a run emits.
