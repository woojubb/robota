---
'@robota-sdk/agent-framework': patch
---

`runGroupChat` runs on the Roundtable core; behaviour unchanged.

`runGroupChat`'s own `while` loop is replaced by a facade over `@robota-sdk/agent-roundtable`'s
`Roundtable`: one step id becomes one participant, the caller's `selectNextStep` policy is adapted
into a `TurnSelector`, and the core runs the only turn loop. The public contract
(`IGroupChatOrchestrationSpec`, `SelectNextStep`, `IGroupChatOrchestratorDeps`,
`IOrchestrationRunResult`) is unchanged, and so is every observable behavior: the first speaker,
threaded whole-transcript prompts, the `maxTurns` bound and its error message and check order, empty
steps, the STARTED/STEP_STARTED/STEP_COMPLETED/COMPLETED/FAILED event sequence, usage, and the
original error object thrown on failure.
