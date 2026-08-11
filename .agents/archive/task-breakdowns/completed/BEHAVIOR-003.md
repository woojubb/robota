# BEHAVIOR-003 Tasks

Generated from Completion Criteria.

- [x] TC-01: root cause documented (test-only baseline race; runtime emits strictly-future nextFireAt)
- [x] TC-02: test controls the clock (fake timers / fixed system time), asserts the real invariant
- [x] TC-03: scheduled-task-runner test run 20× consecutively → 0 failures
- [x] TC-04: `pnpm --filter @robota-sdk/agent-executor typecheck` exits 0
- [N/A] TC-05: conditional runtime fix — root cause is test-only, no runtime change needed
