# ADR-003: Separate transport runner results from registry completion outcomes

## Status

accepted

## Context

Runner adapters observe their own terminal work and can truthfully report success or failure. The
transport registry also owns generation termination: normal stop or startup rollback may make a
runner's eventual result irrelevant before the runner settles. Returning only the already-settled
runner records made `waitForCompletion()` look complete while silently omitting pending runners.
Treating registry abandonment as a runner failure would instead turn normal signal-driven shutdown
into a process failure and would assign generation policy to individual adapters.

The registry also needs one lifecycle owner. Concurrent starts, stop during startup, or partial
startup failure must not replace an active generation or leave a transport alive after the registry
reports that it stopped.

## Alternatives Considered

1. **Return partial completion arrays on stop**: preserves the smallest API — consumers cannot tell
   whether a runner was never registered, still pending, or deliberately abandoned.
2. **Add `abandoned` to each runner's result**: gives one union everywhere — lets adapters invent a
   registry lifecycle result and conflates normal shutdown with execution failure.
3. **Separate adapter results from registry aggregate outcomes**: runner results remain
   `succeeded | failed`, while registry records may additionally be `abandoned` — adds one public
   type but keeps ownership and process-exit semantics honest.

## Decision

Use alternative 3. `ITransportRunnerAdapter.waitForCompletion()` returns only a validated
`succeeded | failed` result. The registry's completion record uses a wider outcome that additionally
permits `abandoned` with the stable reason `stopped` or `startup-rollback`. Registry abandonment has
no raw cause and is not returned by `waitForFailure()`; only an actual runner-produced `failed`
result drives runtime-host or CLI failure handling.

`waitForCompletion()` returns one terminal record for every runner in registration order. Normal
settlement supplies the runner result; stop or startup rollback supplies abandonment for every
pending slot. Late settlement cannot rewrite that snapshot. Registry lifecycle operations are
serialized: active restart rejects before mutation, partial startup rolls back from the currently
failing adapter through previously started adapters in reverse order, and stop during startup cannot
allow later readiness or resource publication after stop completes. The universal adapter contract
therefore requires bounded, generation-safe stop during pending start.

`startAll()` rejects a typed `TransportStartupError`. Its `transportName` identifies the failing
start, its non-enumerable `cause` preserves the original failure, and its ordered readonly
`rollbackErrors` exposes only safe `{ transportName, message }` details. A rollback failure never
replaces the primary failure. Unless a runner already returned a real failed result,
`waitForFailure()` resolves `undefined` after rollback.

## Consequences

- Consumers can distinguish execution results from registry-controlled termination without guessing
  from a missing array entry.
- Normal SIGINT/SIGTERM or command shutdown remains successful unless a runner actually failed.
- The registry needs explicit transition ownership, rollback bookkeeping, and late-settlement tests.
- Public adapter and registry result types are breaking changes and retain ARCH-011's coordinated
  major classification; CLI behavior remains a patch because normal-stop behavior is preserved.

## References

- `.agents/spec-docs/done/ARCH-011-transport-adapter-lifecycle-conformance.md`
- `.agents/tasks/completed/ARCH-011-transport-adapter-is-a-lifecycle-stub.md`
- `.agents/rules/code-quality.md`
