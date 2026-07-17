---
status: done
completed: 2026-07-17
type: FLOW
tags: [plan-mode, hitl, agent-framework, agent-interface-transport, cli, selfhost]
---

# SELFHOST-002: explicit plan-mode (plan → review → approve → act)

## Problem

Promotes backlog [SELFHOST-002](../../backlog/SELFHOST-002-plan-mode.md) toward [VISION.md](../../../VISION.md).
Robota already ships a `plan` **permission mode** (`agent-core/src/permissions/permission-mode.ts`: Read/Glob/Grep/
WebFetch/WebSearch auto-allowed, Write/Edit/Bash denied) reachable via `/mode plan` and `--dry-run`. **The concrete
gap:** there is **no plan/todo artifact, no approval event, and no plan→act phase transition** — going from planning
to acting is a manual `/mode` toggle with no recorded approval. For Robota to safely develop Robota, it should
produce a reviewable plan, capture an explicit approval, and only then flip out of `plan` mode to mutate.

## Prior Art Research

Claude Code plan mode — research vs execution, approve-then-implement (https://code.claude.com/docs/); Devin
plan → review → act with dynamic re-planning (https://www.deployhq.com/guides/devin); Cline Plan & Act
(https://docs.cline.bot/core-workflows/plan-and-act); GitHub Copilot cloud agent research → plan → code
(https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent). Common shape: a plan/todo
artifact + an approval gate that blocks mutation until granted; read-only exploration allowed while planning.
Robota constraint: the mutation-block is **already delivered** by `plan` mode (single enforcement point via
`PermissionEnforcer`/`evaluatePermission`); the missing pieces are a plan-artifact + approval-event **contract**
(a cross-cutting type → `agent-interface-transport`, alongside `IGoalState`) and a **phase controller**
(→ `agent-framework`, mirroring the existing `GoalController` state machine).

**Post-approval semantics (pinned to the actual `MODE_POLICY`).** Approval flips the mode `plan → acceptEdits`.
Per `MODE_POLICY.acceptEdits` (`permission-mode.ts`): `Write/Edit` become `auto` but **`Bash`/`Shell` stay
`approve`** — i.e. approving the plan **auto-applies file edits while every shell step is still confirmed
per-call**. This partial autonomy is the intended contract for self-hosting, not a limitation to paper over: when
Robota develops Robota the mutating steps are shell-heavy (`pnpm build`/`test`, `git`), and keeping a HITL
confirmation on each shell call is the correct safety posture for a self-improving harness — full unattended
execution (`bypassPermissions`) would over-grant. "Approved" therefore means "edits flow, shell stays gated," and
that is what TC-03 asserts. (A future approval-scoped shell allowance keyed to the approved plan is out of scope.)

## Architecture Review

### Affected Scope

- **`agent-core`**: NO new gate — reuse the existing `plan` permission mode as the mutation block (single
  enforcement point stays `PermissionEnforcer`/`evaluatePermission`).
- **`agent-interface-transport`**: new pure-type **plan/todo artifact + approval-event contract**, owner files
  pinned: the **plan/todo artifact type in `session-contracts.ts`** (beside `IGoalState`), the **approval event in
  `event-contracts.ts`** (beside the other session events). Type-only, no runtime.
- **`agent-framework`**: a **plan-phase controller mirroring `GoalController`** (planning → awaiting-approval →
  executing). Critically, the controller stays **pure like `GoalController`**: it returns a decision
  (`{ action: 'approve', nextMode: 'acceptEdits' }` / `{ action: 'revert', nextMode: 'plan' }` / `{ action:
'continue' }`) and **never calls `setPermissionMode` itself** — `InteractiveSession` applies the mode flip, exactly
  as it applies `GoalController`'s decisions today. This preserves the controller's testability-in-isolation (the
  whole reason `GoalController` is side-effect-free). Approval → `nextMode: 'acceptEdits'` (edits auto-apply, shell
  stays per-call confirmed — see Post-approval semantics); after execution the controller emits `{ action: 'revert',
nextMode: 'plan' }` for the next cycle.
- **`agent-cli` / `apps/agent-app`**: `/plan` renders the artifact + emits the approval event (product-local).

### Alternatives Considered

1. **Reuse `plan` mode + artifact/event contract in interface-transport + phase controller in framework (CHOSEN).**
   - ✅ No duplicate gate (single enforcement point preserved); contract in the correct interface package; controller
     mirrors the proven `GoalController`; product policy stays in shells.
   - ❌ Touches interface + framework + two surfaces (correct radius, but multi-package).
2. **Add a new mutation gate in agent-core `.../plan/`.**
   - ✅ Self-contained.
   - ❌ Creates a **second enforcement path** for mutation (SSOT violation) when `plan` mode already blocks mutation.
     REJECTED.
3. **Implement plan-mode only in agent-cli.**
   - ✅ Fast.
   - ❌ The artifact/event contract + phase transition would not be inherited by app/web surfaces; per-surface
     duplication. REJECTED (VISION forbids surface-skinning).

### Decision

Adopt (1): reuse `plan` permission mode as the mutation gate; add the plan/todo-artifact type (`session-contracts.ts`)

- approval-event (`event-contracts.ts`) **contract in `agent-interface-transport`**; add a **pure plan-phase
  controller in `agent-framework` mirroring `GoalController`** that returns an `{ action, nextMode }` decision (approval
  → `acceptEdits`, post-execution → revert to `plan`) which `InteractiveSession` applies — the controller never calls
  `setPermissionMode` itself. Surfaces render `/plan` + emit approval. No new permission gate; no per-surface duplication.
  Post-approval semantics are pinned to `MODE_POLICY.acceptEdits` (edits auto-apply, shell/Bash stay per-call confirmed).

### Validated Recommendation

- **Reachability:** the mutation block is reachable today via `plan` mode + `PermissionEnforcer`; the missing
  transition is reachable because `InteractiveSession` already owns `setPermissionMode` (threaded through
  `interactive-session-init.ts`) and already applies `GoalController` decisions — the pure plan controller's
  `nextMode` decision plugs into that same apply-point. Verified.
- **Capability preservation:** existing `/mode plan` + `--dry-run` behavior is unchanged; this adds the
  artifact/approval/transition on top.
- **Adversarial:** risk = a second mutation gate drifting from `plan` mode → designed out by reusing `plan` mode.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: reuse agent-core `plan` mode; contract in agent-interface-transport; controller in agent-framework; `/plan` in cli/app.
- [x] Sibling scan 완료 — reuses `plan` permission mode + `GoalController` analog + `IGoalState`/event-contracts home; NO new permission gate (single enforcement point preserved).
- [x] 대안 최소 2개 — 3 considered (reuse-plan-mode CHOSEN; new-core-gate REJECTED SSOT; cli-only REJECTED skinning), each Pro+Con.
- [x] 결정 근거 — reuse existing gate (no second enforcement path) + contract in interface package + mirror GoalController; GATE-APPROVAL PASSED (ENDORSE).

## Solution

Reuse `plan` mode as the mutation block. Add a plan/todo-artifact type + approval-event contract in
`agent-interface-transport`. Add a **pure** plan-phase controller in `agent-framework` mirroring `GoalController`:
`planning` (in `plan` mode, read-only tools, produce the artifact) → `awaiting-approval` → on approval it returns
`{ action: 'approve', nextMode: 'acceptEdits' }` → `executing`; on completion it returns `{ action: 'revert',
nextMode: 'plan' }`. `InteractiveSession` applies each `nextMode` via `setPermissionMode` (the controller does not).
Approving auto-applies edits; shell/Bash steps stay per-call confirmed. Surfaces (`/plan`, app view) render the
artifact and emit the approval event.

## Affected Files

| File                                                               | Change                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `packages/agent-interface-transport/src/session-contracts.ts`      | plan/todo-artifact type, beside `IGoalState` (type-only)              |
| `packages/agent-interface-transport/src/event-contracts.ts`        | approval event, beside the other session events (type-only)           |
| `packages/agent-framework/src/` (mirror `goal/goal-controller.ts`) | pure plan-phase controller returning `{ action, nextMode }` decisions |
| `packages/agent-framework/src/interactive/interactive-session*.ts` | applies the controller's `nextMode` via `setPermissionMode`           |
| `packages/agent-cli/`, `apps/agent-app/`                           | `/plan` + plan/todo view + emit approval                              |

## Completion Criteria

- [x] TC-01: while the session is in `plan` mode, a mutating tool call is denied **by the existing `PermissionEnforcer`** (unit test asserting the denial reason is the plan mode, not a new gate).
- [x] TC-02: read-only tools are permitted during the plan phase (unit test).
- [x] TC-03: the **pure** plan-phase controller, on approval, RETURNS `{ action: 'approve', nextMode: 'acceptEdits' }` (asserted without any session/permission side-effect — mirroring GoalController's decision-only unit tests); `InteractiveSession` applying that mode then makes `Write/Edit` auto while `Bash/Shell` stay per-call `approve` (asserted against `MODE_POLICY.acceptEdits`) — i.e. approved plan edits flow, shell stays confirmed.
- [x] TC-04: a plan/todo artifact + approval event round-trip through the interface-transport contract (unit test); `/plan` renders it (headless CLI verification per verification.md, injected provider fixture).
- [x] TC-05: no second mutation-enforcement path is added — the only mutation gate remains `PermissionEnforcer`/`plan` mode (verified: grep shows no new gate in `agent-core/.../plan/`).

## Test Plan

| TC    | Verification                           | Type/Tool                                                           |
| ----- | -------------------------------------- | ------------------------------------------------------------------- |
| TC-01 | mutation denied by plan mode           | vitest unit (agent-session PermissionEnforcer)                      |
| TC-02 | read-only allowed in plan              | vitest unit                                                         |
| TC-03 | approval flips mode → execute          | framework functional test                                           |
| TC-04 | artifact/approval round-trip + `/plan` | interface unit + **headless CLI verification** (verification.md:50) |
| TC-05 | no second gate                         | grep/placement check                                                |

**Test references (delivered across P1–P2):**

- TC-01 / TC-02 → `packages/agent-framework/src/plan/__tests__/plan-controller.test.ts` ("plan mode denies mutating
  tools via the existing permission gate" / "plan mode permits read-only tools", over `evaluatePermission`/`MODE_POLICY.plan`).
- TC-03 → same file ("approve() returns { approve, acceptEdits } with no side-effect" + "applying acceptEdits flows
  edits but keeps shell per-call confirmed"), plus the session-level flip in
  `packages/agent-framework/src/interactive/__tests__/plan-mode-wiring.test.ts`.
- TC-04 → `plan-mode-wiring.test.ts` (real InteractiveSession + injected provider: plan_event round-trip + mode flip),
  `packages/agent-framework/src/interactive/__tests__/session-persistence-roundtrip.test.ts` (plan record round-trip),
  `packages/agent-command/src/plan/__tests__/plan-command.test.ts` (the `/plan` verbs), and the CLI print-mode
  UET in `packages/agent-cli/src/__tests__/e2e/slash-smoke.test.ts` ("SELFHOST-002: /plan …").
- TC-05 → no `agent-core/src/plan` gate; the P1/P2 diffs add no mutation-enforcement path (deps + grep).

## User Execution Test Scenarios

**Scenario UET-01 — draft a plan through the `robota` CLI.** `agent-executable`.

- **Prerequisite state:** build the CLI (`pnpm --filter @robota-sdk/agent-cli build`); a scripted provider fixture
  (no API key), as set up by the e2e harness.
- **Surface:** the real `robota` CLI in print mode (`-p '<slash-command>' --output-format json`), driven by
  `runPrintJson` in `packages/agent-cli/src/__tests__/e2e/slash-smoke.test.ts` — the same product entry a user runs.
- **Exact command (agent-executable):** `pnpm --filter @robota-sdk/agent-cli test -- --run src/__tests__/e2e/slash-smoke.test.ts -t "SELFHOST-002"`
- **Expected observable result:** exit 0; `robota -p '/plan draft the release notes' --output-format json` emits a
  `type: 'result'` envelope whose `result` contains `/plan approve` (the plan was drafted, read-only until approved);
  `/plan status` in a fresh session reports `No plan is active.`
- **Evidence:** executed 2026-07-17 — **2 passed** (1 TC-06 sibling skipped by the `-t` filter). The `/plan` command
  is registered and reachable through the product CLI; the draft envelope + the no-plan status both observed as
  asserted. (The full approve→`acceptEdits` mode-flip lifecycle is additionally proven headlessly on a real
  `InteractiveSession` by `plan-mode-wiring.test.ts`.)
- **Cleanup:** none (print mode runs `--no-session-persistence` in an isolated temp workspace).

## Tasks

Archived: [`.agents/tasks/completed/SELFHOST-002.md`](../../tasks/completed/SELFHOST-002.md) — P1 (contract + pure
`PlanController`) and P2 (InteractiveSession wiring + `/plan` surface) both `[x]`.

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Flagged: `plan` mode already
  blocks mutation (proposed a duplicate gate); artifact/event contract mis-placed in agent-core (belongs in
  agent-interface-transport); should mirror `GoalController`; weak Problem; TC-05 not falsifiable; missing headless path.
- 2026-07-16 — **Revisions applied (this draft):** reuse `plan` mode (no new gate; single enforcement point);
  contract moved to `agent-interface-transport`; phase controller mirrors `GoalController`; Problem now names the
  concrete gap; TC-05 falsifiable (grep no new gate); headless CLI verification added (verification.md:50). Re-review pending.
- 2026-07-16 — **iteration 2: RE-REVIEW → one-fix bounce, applied.** Re-reviewer confirmed all 5 fixes RESOLVED;
  the one new blocker (approval target-mode unpinned/inconsistent) fixed: approval flips `plan → acceptEdits`,
  reverts to `plan` after executing; TC-01 relabeled agent-session PermissionEnforcer.
- 2026-07-17 — **iteration 3: RE-REVIEW → REVISE, applied.** Re-reviewer flagged two blockers: (1) the
  `acceptEdits` rationale was inconsistent with `MODE_POLICY` — `acceptEdits` keeps `Bash/Shell = approve`, so
  "executes without a per-tool re-prompt" was false; (2) making the controller flip the mode itself broke the
  "mirror `GoalController`" claim (GoalController is pure). Fixes: **Post-approval semantics** section pins the
  honest contract (edits auto-apply, shell/Bash stay per-call confirmed) and justifies that partial autonomy for the
  Bash-heavy self-host case (vs over-granting `bypassPermissions`); the controller is now **pure** — returns
  `{ action, nextMode }`, `InteractiveSession` applies `setPermissionMode`; approval-event/artifact owner files
  pinned (`event-contracts.ts` / `session-contracts.ts`); TC-03 asserts the decision-only return + the
  `MODE_POLICY.acceptEdits` effect; dropped the false "GoalController re-seeds" analogy.
- 2026-07-17 — **iteration 4: RE-REVIEW → ENDORSE** (independent proposal-reviewer). Both iteration-3 blockers
  verified resolved against the code: `MODE_POLICY.acceptEdits` matches (Write/Edit auto, Bash/Shell per-call
  `approve`); the controller is a faithful pure mirror of `GoalController` (decision-only `TGoalDecision`, applied at
  `interactive-session.ts:777-785`); owner files pinned beside `IGoalState` (`session-contracts.ts:359`); re-seed
  analogy gone. Single enforcement point + placement + dependency direction all clean; no new defect.
  **GATE-APPROVAL PASSED.**
- 2026-07-17 — **GATE-IMPLEMENT: P1 implemented** (moved todo/ → active/, status in-progress; task file created + split
  into P1/P2 work units). Shipped the pure-type contract in `agent-interface-transport` — `IPlanStep`/`TPlanStepStatus`/
  `TPlanPhase`/`IPlanArtifact` in `session-contracts.ts` (beside `IGoalState`, + `plan?` on `IInteractiveSessionRecord`
  for resume) and `IPlanApprovalEvent` in `event-contracts.ts` — and the **pure** `PlanController` in
  `agent-framework/src/plan/plan-controller.ts` mirroring `GoalController` (phase machine planning→awaiting-approval→
  executing→completed; `approve()` returns `{ action:'approve', nextMode:'acceptEdits' }`, `revert()`/`complete()`
  return `{ action:'revert', nextMode:'plan' }`; decision-only, never calls `setPermissionMode`). TC-01/02/03/05 satisfied:
  TC-01/02 assert `evaluatePermission(..., 'plan')` denies Write/Edit/Bash + allows Read/Glob/Grep (the EXISTING gate);
  TC-03 asserts the decision-only `approve()` return + `MODE_POLICY.acceptEdits` (Write/Edit `auto`, Bash/Shell `approve`);
  TC-05 verified no `agent-core/src/plan` gate exists and P1 touched zero agent-core source. Verified locally: build +
  typecheck + tests (plan-controller 8/8; full agent-framework 1126/1126, agent-interface-transport 10/10) + lint
  (0 errors) + `pnpm harness:scan` (all 54 pass). **P2** (InteractiveSession wiring + `/plan` surface + artifact
  round-trip, TC-04) remains.
- 2026-07-17 — **GATE-IMPLEMENT: P2 implemented (TC-04) — spec feature-complete.** Wired the surfaces:
  `agent-interface-transport` added `plan_event` to `IInteractiveSessionEvents`; `InteractiveSession` gained
  `setPlan`/`getPlanState`/`approvePlan`/`revertPlan` that APPLY the pure controller's `nextMode` via
  `getSessionOrThrow().setPermissionMode(...)` (controller stays pure) and emit `plan_event`; the plan artifact
  persists into the session record + restores on resume; `ICommandHostContext` exposes the optional plan methods;
  `agent-command` ships the `/plan` command (verbs `<objective>`/`status`/`approve`/`revert`) mirroring `/goal`,
  registered in `default-command-modules` (only the module factory is a package export, per the siblings' pattern +
  the `spec-public-surface` baseline). **TC-04 proven headlessly** on a REAL `InteractiveSession` driven by an
  injected scripted provider (no API key): `plan-mode-wiring.test.ts` asserts the plan_event round-trip AND the
  permission-mode flip (`plan → acceptEdits` on approve, back to `plan` on revert); `session-persistence-roundtrip`
  preserves the `plan` record field; `plan-command.test.ts` (9) covers the `/plan` verbs. No new mutation gate.
  `apps/agent-app` UI view deferred (no goal/plan view consumer exists there; not required for the SDK/CLI flow —
  recorded to avoid a silent scope gap). Verified: build + typecheck + full suites (agent-interface-transport 10/10,
  agent-framework 1130/1130, agent-command 234/234) + lint (0 errors) + `pnpm harness:scan` (54/54) + `harness:test`
  (303/303). **Both slices implemented.** Next: GATE-VERIFY + GATE-COMPLETE.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-17

**Status upgrade:** approved → in-progress (recorded at P1; consolidated here across the two work units)

- Both work units landed via reviewed PRs merged to `develop`: P1 (contract + pure `PlanController`, PR #1197) and
  P2 (InteractiveSession wiring + `/plan` command, PR #1198). Tasks file `.agents/tasks/SELFHOST-002.md` created; both
  slice checklists `[x]`; `## Tasks` records the path.
- Reused the existing `plan` permission mode as the single mutation block (no second gate); the controller is a pure
  `GoalController` mirror; the contract lives in `agent-interface-transport` beside `IGoalState`.
- NON-COMPLIANCE check: no implementation ahead of GATE-APPROVAL; each slice landed via its own reviewed PR.

### [GATE-VERIFY] — ✅ PASS | 2026-07-17

**Status upgrade:** in-progress → verifying

- Tasks completion: every checklist item in `.agents/tasks/SELFHOST-002.md` is `[x]` (P1 + P2); none blocked.
- Build: `pnpm --filter @robota-sdk/agent-interface-transport --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-command --filter @robota-sdk/agent-cli build` → exit 0.
- Tests: agent-interface-transport **10/10**, agent-framework **1130/1130**, agent-command **234/234**,
  agent-cli slash-smoke e2e **3/3** (incl. the two `/plan` print-mode UET cases). exit 0.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-17

**Status upgrade:** verifying → done

- **[GATE-COMPLETE: TC-01]** Verified: `plan-controller.test.ts` "plan mode denies mutating tools via the existing
  permission gate" → `evaluatePermission('Write'|'Edit'|'Bash'|'Shell', {}, 'plan') === 'deny'`. Checkbox `[x]`.
  Test reference: `packages/agent-framework/src/plan/__tests__/plan-controller.test.ts`.
- **[GATE-COMPLETE: TC-02]** Verified: same file, "plan mode permits read-only tools" →
  `evaluatePermission('Read'|'Glob'|'Grep'|'WebFetch', {}, 'plan') === 'auto'`. Checkbox `[x]`.
- **[GATE-COMPLETE: TC-03]** Verified: the pure `approve()` returns `{ action:'approve', nextMode:'acceptEdits' }`
  with no side-effect, and `MODE_POLICY.acceptEdits` makes Write/Edit `auto` while Bash/Shell stay `approve`
  (`plan-controller.test.ts`); the session-level flip is proven in `plan-mode-wiring.test.ts`. Checkbox `[x]`.
- **[GATE-COMPLETE: TC-04]** Verified: `plan-mode-wiring.test.ts` (real `InteractiveSession` + injected provider):
  `plan_event` round-trip (`plan_created`/`plan_approved`/`plan_reverted`) + the actual mode flip
  (`plan → acceptEdits → plan`) via `getSession().getPermissionMode()`; `session-persistence-roundtrip.test.ts`
  preserves the `plan` record field; `plan-command.test.ts` (9) covers the `/plan` verbs; and the CLI print-mode
  UET (`slash-smoke.test.ts`, "SELFHOST-002: /plan …") drafts a plan through the real `robota` CLI. Checkbox `[x]`.
- **[GATE-COMPLETE: TC-05]** Verified: no `agent-core/src/plan` gate exists and the P1/P2 diffs add no
  mutation-enforcement path — the only mutation gate remains `evaluatePermission`/`MODE_POLICY`/`plan` mode
  (`deps` scan green; grep clean). Checkbox `[x]`.
- **Test Plan coverage:** all 5 rows have concrete test references (recorded under `## Test Plan`); no unaddressed row.
- **User-Execution done-gate:** PASS — `## User Execution Test Scenarios` UET-01 (`agent-executable`, the real
  `robota` CLI print-mode surface) executed 2026-07-17 (2 passed), observing the drafted-plan envelope (`/plan approve`)
  and the no-plan status through the product command.
- **Artifact actions:** tasks file archived `.agents/tasks/SELFHOST-002.md` → `.agents/tasks/completed/SELFHOST-002.md`;
  spec `## Tasks` updated to the archived path. Spec moved `spec-docs/active/` → `spec-docs/done/`, frontmatter
  `status: done` + `completed: 2026-07-17`.
- **Summary:** all 5 Completion Criteria `[x]` with matching GATE-COMPLETE evidence; Test Plan fully covered;
  User-Execution gate passed with captured evidence; tasks archived. Status upgrade verifying → done authorized.
