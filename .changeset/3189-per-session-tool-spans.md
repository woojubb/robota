---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': patch
---

A tool instance shared by several sessions sends each call's span to the session that made the call.

- **Before:** each session set its event service on the shared instance, so the span went to whichever session had set it last.
- **`agent-core`:** `IToolExecutionContext` gains an optional `instanceEventService`. `FunctionTool` emits its span there when a call carries one.
- **`agent-session`:** the permission wrapper keeps its session's service and passes it with every call.
