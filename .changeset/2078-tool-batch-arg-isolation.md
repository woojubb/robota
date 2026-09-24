---
'@robota-sdk/agent-core': patch
---

A tool call whose arguments failed to decode to a JSON object (invalid JSON, or a `null`/scalar/array
root) no longer aborts the rest of its batch. `decodeToolCallArguments` used to throw inside
`createExecutionRequestsWithContext`'s `.map()`, before `executeTools` ran at all — so one malformed
call in a provider's batch rejected `Robota.run()` outright: every other call in that batch, however
well-formed, never executed and never got a tool result.

The malformed call is now refused the same way an unknown tool name already is: a normal per-call
failed result (`argument_decode_error`), naming the tool and call id, without ever invoking the tool.
Every other call in the batch still executes, and every call — malformed or not — gets a tool-result
message in history, so the provider is called again with a result for each id it sent.
