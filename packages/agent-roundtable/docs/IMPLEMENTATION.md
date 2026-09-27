# Roundtable implementation evidence

Tracking: [Robota #3273](https://github.com/woojubb/robota/issues/3273).
This checklist tracks the full issue; passing one slice is not completion of the public library.

| Workstream | Weight | Evidence |
| --- | ---: | --- |
| Reviewed contracts and ownership | 5% | Issue design and package SPEC |
| Independent sessions, parallel groups, input and context | 20% | Barrier-tested parallel dispatch, ordered publication, session isolation, external input receipts; context policy and member waits remain |
| Store, checkpoints, fencing and effect recovery | 20% | Memory store and scheduler integration, fenced ownership, renewal, CAS, operation receipts, versioned loading, private checkpoints and prepared-group recovery tested; effect reconciliation and durable recovery remain |
| Awaited SDK execution/approval boundaries | 15% | Core request/response/tool journals, Session forwarding, compaction and permission-aware tool-effect barriers tested; provider-free tool-batch recovery and no-input Core/Session continuation verified; serializable approval continuation remains |
| Robota/Session/selector adapters and usage/budgets | 10% | Pending |
| Existing group-chat convergence | 5% | Pending |
| External-consumer integration and real runtime verification | 15% | Pending |
| Public artifacts, examples, CI, review and integration | 10% | Pending |

Progress estimates use verified work within these weights. The complete acceptance matrix remains in
the issue, including real providers, browser/audio verification, all repository checks and PR review.

Public evidence contains only publishable SDK and integration results. Private consumer identities,
repository details, and product plans are maintained outside this repository.

Roundtable passes 47 tests, including 21 loader tests, plus type checking, lint, scoped dependency
validation and ESM/CJS/declaration builds. Core's full suite passes 1,878 tests. Session's full suite
passes 609 tests with one skipped. Core and Session builds and type checks also pass. The
unsupported durable mode is rejected before execution. Current loading preserves committed state,
validates registry/checkpoint versions, reuses prepared members and dispatches only members that have
not started. Interrupted selector or runtime execution still requires reconciliation and is rejected.
Defects found during implementation and
existing SDK gaps are tracked together in the issue's
[consolidated findings comment](https://github.com/woojubb/robota/issues/3273#issuecomment-5854469605).

Core now passes 21 public tool-batch recovery tests. Recovery reuses the latest saved model response,
settled results and action identities through the existing tool executor. It preserves original
execution restrictions and context-budget projection, rejects conflicting history and uncertain
effects, and serializes with ordinary runs. It requires exclusive host journal ownership.

Core also passes 17 no-input continuation tests, and Session passes 10 continuation tests. Recovery
retains the original round and repeated-input limits, deferred tool residency and peer-turn authority,
then continues through the normal model loop under current permissions. A different active provider,
model, session or workspace is refused before effects. Settled terminal responses and cache hits are
reused; canonical restored history remains available and follows the existing log replay contract.
Shutdown drains ordinary and resumed turns before persisting their final history. Review regressions
cover empty summaries, stateless rejection, reused provider IDs and failing/mutating observers.

Turn-level lifecycle hooks are omitted during continuation because their effects have no durable
receipts. Structured-output validators and unknown model/tool effects remain unsupported recovery
states. Serializable approval waits, reconciliation and durable Roundtable mode remain open.
