---
'@robota-sdk/agent-core': patch
---

A run's answer now comes from its own turn. A turn run with `allowToolOnlyCompletion` that ends in
tool calls resolves with `''` instead of throwing a `[STRICT-POLICY]` error, and a later turn that
produces no text no longer resolves with the previous turn's answer. An aborted run resolves with the
text it committed before the abort (the same text history keeps, marked `interrupted`) instead of
`''`, and its result lists the tools that ran before the abort. `tokensUsed`, which plugins receive
after each run, counts only that run's provider calls instead of the whole conversation's.
