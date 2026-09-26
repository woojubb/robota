---
'@robota-sdk/agent-core': patch
---

When the round cap ends a run on a tool round and the follow-up summary call fails, `run()` and
`runStream()` now reject with that call's own provider error (for example a `RateLimitError` with
`recoverable: true`, or the provider's 400 error) instead of a generic
`[STRICT-POLICY] Failed execution result missing error field` error. The failure is recorded in
history like a failed round. An aborted summary call now resolves the run as interrupted, like an aborted round, instead of failing.
