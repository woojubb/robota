---
'@robota-sdk/agent-framework': minor
---

A `context: fork` skill consults the parent's sandbox. Its session carries no background policy, so
the parent's own gate decides its calls, and its shell tools run under the parent's sandbox. A
confined command now runs without a prompt when `autoAllowBashIfSandboxed` is on, as it does in the
parent; before, the fork asked for approval, and a print run refused it. `createSubagentSession` takes
a `commandSandbox` option.
