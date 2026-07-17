<!-- archival-exempt: spec in progress — P1 (contract + pure PlanController + mutation-gate assertions) is the first of two named work units; P2 (InteractiveSession wiring + /plan surface + artifact round-trip, TC-04) remains, so the spec stays in spec-docs/active/ until both land and GATE-VERIFY/GATE-COMPLETE run. -->

# SELFHOST-002 — explicit plan-mode (plan → review → approve → act)

Spec: [`.agents/spec-docs/active/SELFHOST-002-plan-mode.md`](../spec-docs/active/SELFHOST-002-plan-mode.md)
GATE-APPROVAL: PASSED (iteration 4 ENDORSE). GATE-IMPLEMENT in progress.

## Recommendation (gate)

Reuse the existing `plan` permission mode as the single mutation block (no second gate). Add the reviewable
plan/todo artifact type beside `IGoalState` (`session-contracts.ts`) + the approval event in `event-contracts.ts`
(type-only, `agent-interface-transport`). Add a **pure** `PlanController` in `agent-framework` mirroring
`GoalController` — it returns `{ action, nextMode }` decisions and never calls `setPermissionMode` itself
(`InteractiveSession` applies the flip, exactly as it applies `GoalController` decisions). Split into two work units
so each is independently testable/mergeable.

## P1 — contract + pure PlanController + mutation-gate assertions (this slice)

- [x] `agent-interface-transport`: `IPlanStep` / `IPlanArtifact` / `TPlanPhase` in `session-contracts.ts` (beside
      `IGoalState`); `IPlanApprovalEvent` in `event-contracts.ts`. Type-only, no runtime. Exported from the barrel.
- [x] `agent-framework`: pure `PlanController` (`plan/plan-controller.ts`) mirroring `GoalController` — `start` →
      `requestApproval` (planning → awaiting-approval) → `approve` returns `{ action: 'approve', nextMode: 'acceptEdits', plan }`,
      `revert` returns `{ action: 'revert', nextMode: 'plan', plan }`, `complete` reverts to `plan` for the next cycle.
      Decision-only (no session/permission side-effect). Exported from the barrel.
- [x] Tests: TC-01 (plan mode denies a mutating tool via the existing `PermissionEnforcer`), TC-02 (read-only tools
      permitted in plan), TC-03 (controller `approve` RETURNS the decision with no side-effect + `MODE_POLICY.acceptEdits`
      makes Write/Edit `auto` while Bash/Shell stay `approve`), TC-05 (no second mutation gate — grep asserts no new
      gate in `agent-core/.../plan/`).
- [x] Verify: build + typecheck + tests + lint + `pnpm harness:scan`.

## P2 — InteractiveSession wiring + `/plan` surface + artifact round-trip — PENDING

- InteractiveSession applies the controller's `nextMode` via `setPermissionMode` + emits the approval event;
  `agent-cli` `/plan` renders the artifact + emits approval; `apps/agent-app` view. TC-04 (artifact/approval
  round-trip + headless CLI `/plan` verification per verification.md).

## Test Plan

Maps the spec's Completion Criteria to the planned verification:

- **TC-01** (mutation denied by plan mode) → vitest unit over the existing `PermissionEnforcer`/`MODE_POLICY.plan`.
- **TC-02** (read-only allowed in plan) → vitest unit over `MODE_POLICY.plan`.
- **TC-03** (approval decision + acceptEdits effect) → `plan-controller.test.ts` (decision-only return) +
  assertion against `MODE_POLICY.acceptEdits` (Write/Edit `auto`, Bash/Shell `approve`).
- **TC-04** (artifact/approval round-trip + `/plan`) → P2 (interface unit + headless CLI verification).
- **TC-05** (no second gate) → grep/placement check that no new mutation gate exists under `agent-core/.../plan/`.
