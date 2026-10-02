---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-plugin': patch
---

A `the agent runtime` run now calls `beforeConversation`, with `beforeExecution`, and `onStreamingChunk` for
each streamed piece of text, in order; the round waits for those chunk hooks before it goes on,
whether the provider call returned, failed or was interrupted. `EventEmitterPlugin` therefore emits
`CONVERSATION_START`.

The run result's `toolCalls` now carry each executed call's id and `result: null` for one that
failed, so `EventEmitterPlugin` emits `TOOL_ERROR` instead of `TOOL_SUCCESS` for a failed call, and
`WebhookPlugin`'s `tool.executed` payload reports it as failed with its call id.

`EXECUTION_START`, `EXECUTION_COMPLETE` and `EXECUTION_ERROR` are marked deprecated: no run emits
them; the `AGENT_EXECUTION_*` events are the ones a run emits. `beforeToolCall`,
`beforeToolExecution` and `afterToolCall` are still not called.
