---
'@robota-sdk/dag-worker': patch
---

Worker admission now checks a composite child task's persisted ancestry, not just its own run's
status: if the run's persisted root or immediate parent run is committed `cancelled`, the task
never reaches the executor. The worker also commits this run's own cancellation through the same
state-transition path `RunCancelService` uses, so a queued task under a cancelled root or parent
ends `cancelled` and its run does too, even across a worker restart or a separate process that
never observed this run's own cancellation. A persisted root or parent id that resolves to no run
is left alone rather than treated as a cancellation signal, since lineage is not always backed by a
persisted ancestor row.
