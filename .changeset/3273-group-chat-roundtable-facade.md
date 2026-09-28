---
'@robota-sdk/agent-framework': patch
---

`runGroupChat` runs on the Roundtable core.

`runGroupChat`'s own `while` loop is replaced by a facade over `@robota-sdk/agent-roundtable`'s
`Roundtable`: one step id becomes one participant, the caller's `selectNextStep` policy is adapted
into a `TurnSelector`, and the core runs the only turn loop. The public contract
(`IGroupChatOrchestrationSpec`, `SelectNextStep`, `IGroupChatOrchestratorDeps`,
`IOrchestrationRunResult`) is unchanged, and so is the behavior it describes: the first speaker,
threaded whole-transcript prompts, the `maxTurns` bound and its error message and check order, empty
steps, the STARTED/STEP_STARTED/STEP_COMPLETED/COMPLETED/FAILED event sequence, per-step usage, and
the original error object thrown on failure — including for inputs the old loop tolerated only
because it never validated them, such as a non-finite or extremely large `maxTurns` or a step with no
usable model id.

A few differences are deliberate and small: the selector now receives a freshly built history array
on every call rather than a reference into a mutated one; a duplicate step id keeps only its last
definition and an empty step id can never be reached (both were already-unreachable edge cases in
the old loop); and a non-integer `maxTurns` is rounded up for the core's own internal turn ceiling,
though the selector's own bound check still compares the caller's exact value first. Reported step
usage comes back as a plain-data copy (same values; undefined-valued keys omitted), and a reading that
cannot be stored as finite JSON, such as one containing `NaN`, is left out of the step result instead
of failing the run. Each call keeps a small in-memory operation log for its conversation; it is bounded
per call and negligible at the default `maxTurns` (the step count).
