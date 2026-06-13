# FLOW-001 Tasks (Layer 1 — agent-executor wake-event foundation)

Generated from Completion Criteria. Re-scoped 2026-06-13 to Layer 1 only (6-layer decomposition).

- [x] TC-01: `IScheduledBackgroundTaskRequest` accepts `agentInstruction`, `command` optional; instruction-only request typechecks and is accepted by the scheduled runner
- [x] TC-02: scheduled task with `agentInstruction` fires → manager emits `background_task_waking { taskId, instruction }` (was swallowed)
- [x] TC-03: shell-only scheduled task still fires command, no instruction-bearing wake (no regression)
- [x] TC-04: `pnpm --filter @robota-sdk/agent-executor test` exits 0 (78 passed)
- [x] TC-05: `pnpm --filter @robota-sdk/agent-executor typecheck` exits 0 (also framework + transport typecheck green — new event variant breaks no consumer)

Upper layers tracked separately: FLOW-002..FLOW-006 (backlog, review-ready).
