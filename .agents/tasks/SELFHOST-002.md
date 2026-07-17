<!-- archival-exempt: spec in progress — P1 (contract + pure PlanController) and P2 (InteractiveSession wiring + /plan surface, TC-04) both implemented; the spec stays in spec-docs/active/ until GATE-VERIFY/GATE-COMPLETE run and move it to done/. -->

# SELFHOST-002 — explicit plan-mode (plan → review → approve → act)

Spec: [`.agents/spec-docs/active/SELFHOST-002-plan-mode.md`](../spec-docs/active/SELFHOST-002-plan-mode.md)
GATE-APPROVAL: PASSED (iteration 4 ENDORSE). GATE-IMPLEMENT: P1+P2 implemented; GATE-VERIFY/GATE-COMPLETE next.

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

## P2 — InteractiveSession wiring + `/plan` surface + artifact round-trip ✅ IMPLEMENTED

- [x] `agent-interface-transport`: added `plan_event` to `IInteractiveSessionEvents` (beside `goal_event`).
- [x] `agent-framework`: `InteractiveSession` gained `setPlan`/`getPlanState`/`approvePlan`/`revertPlan` — mirroring
      the goal wiring. `approvePlan`/`revertPlan` APPLY the controller's `nextMode` via
      `getSessionOrThrow().setPermissionMode(...)` (the controller stays pure) and emit `plan_event`
      (`plan_created`/`plan_approved`/`plan_reverted`). The plan artifact persists into the session record
      (`interactive-session-persistence.ts` + restore threading) so it survives resume. `ICommandHostContext`
      exposes the optional `setPlan`/`getPlanState`/`approvePlan`/`revertPlan` so the command reaches them.
- [x] `agent-command`: `/plan` command (`src/plan/`, verbs `<objective>`/`status`/`approve`/`revert`) mirroring
      `/goal`; registered in `default-command-modules`. Only the module factory is a package export (siblings'
      pattern).
- [x] TC-04: artifact/approval round-trip + mode flip proven headlessly on a REAL `InteractiveSession` driven by an
      injected (scripted) provider — `plan-mode-wiring.test.ts` asserts `plan_created` (stays `plan` mode),
      `approvePlan` → mode `acceptEdits` + `plan_approved`, `revertPlan` → mode `plan` + `plan_reverted`; the
      record round-trip (`session-persistence-roundtrip.test.ts`) preserves the `plan` field; the `/plan` command
      renders/dispatches (`plan-command.test.ts`, 9 tests).
- [x] `apps/agent-app` view: NOT added — there is no existing goal/plan view consumer in `apps/agent-app` either
      (the only runtime `goal_event`/`plan_event` consumer is the headless runner); a UI surface is deferred to a
      product-UI slice, not required for the SDK/CLI plan-mode flow. (Recorded here to avoid a silent scope gap.)
- [x] Verify: build + typecheck + tests + lint (0 errors) + `pnpm harness:scan` (54/54) + `harness:test` (303/303).

## Test Plan

Maps the spec's Completion Criteria to the planned verification:

- **TC-01** (mutation denied by plan mode) → vitest unit over the existing `PermissionEnforcer`/`MODE_POLICY.plan`.
- **TC-02** (read-only allowed in plan) → vitest unit over `MODE_POLICY.plan`.
- **TC-03** (approval decision + acceptEdits effect) → `plan-controller.test.ts` (decision-only return) +
  assertion against `MODE_POLICY.acceptEdits` (Write/Edit `auto`, Bash/Shell `approve`).
- **TC-04** (artifact/approval round-trip + `/plan`) → P2 (interface unit + headless CLI verification).
- **TC-05** (no second gate) → grep/placement check that no new mutation gate exists under `agent-core/.../plan/`.
