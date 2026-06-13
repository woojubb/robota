# FLOW-003 Tasks (Layer 3 — resume re-arm + missed-wake)

- [x] TC-01: restored sleeping scheduled wake is re-armed (re-spawned), not killed
- [x] TC-02: elapsed nextFireAt surfaces exactly one missed-wake note
- [x] TC-03: future nextFireAt re-arms without a missed-wake note
- [x] TC-04: agent-framework test suite exits 0
- [x] TC-05: agent-framework typecheck exits 0 (executor too)

Foundation: persist `schedule` on IBackgroundTaskState (types + helpers).
