---
'@robota-sdk/agent-core': patch
---

CORE-048: `resolveStructuredOutputCapability` is exported

`TStructuredOutputMechanism` and `TStructuredOutputProvenance` were already public while the function
that produces them was not — a caller could name the answer but not obtain it. Exporting it also lets
a consumer ask, before spending a call, what will happen to their schema against a given
`(provider, model)` pair.

No behaviour changed. This falls out of CORE-048, which asked whether a forced tool call should join
the mechanism vocabulary and answered no: the transport would need a provider that both lacks a
schema parameter and has enforceable strict tool arguments, and across this workspace that
intersection is empty.
