---
status: draft
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
- [x] 결정 근거 — reuse existing gate (no second enforcement path) + contract in interface package + mirror GoalController; independent GATE-APPROVAL re-review pending.

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

- [ ] TC-01: while the session is in `plan` mode, a mutating tool call is denied **by the existing `PermissionEnforcer`** (unit test asserting the denial reason is the plan mode, not a new gate).
- [ ] TC-02: read-only tools are permitted during the plan phase (unit test).
- [ ] TC-03: the **pure** plan-phase controller, on approval, RETURNS `{ action: 'approve', nextMode: 'acceptEdits' }` (asserted without any session/permission side-effect — mirroring GoalController's decision-only unit tests); `InteractiveSession` applying that mode then makes `Write/Edit` auto while `Bash/Shell` stay per-call `approve` (asserted against `MODE_POLICY.acceptEdits`) — i.e. approved plan edits flow, shell stays confirmed.
- [ ] TC-04: a plan/todo artifact + approval event round-trip through the interface-transport contract (unit test); `/plan` renders it (headless CLI verification per verification.md, injected provider fixture).
- [ ] TC-05: no second mutation-enforcement path is added — the only mutation gate remains `PermissionEnforcer`/`plan` mode (verified: grep shows no new gate in `agent-core/.../plan/`).

## Test Plan

| TC    | Verification                           | Type/Tool                                                           |
| ----- | -------------------------------------- | ------------------------------------------------------------------- |
| TC-01 | mutation denied by plan mode           | vitest unit (agent-session PermissionEnforcer)                      |
| TC-02 | read-only allowed in plan              | vitest unit                                                         |
| TC-03 | approval flips mode → execute          | framework functional test                                           |
| TC-04 | artifact/approval round-trip + `/plan` | interface unit + **headless CLI verification** (verification.md:50) |
| TC-05 | no second gate                         | grep/placement check                                                |

## Tasks

`.agents/tasks/SELFHOST-002.md` — 미생성 (GATE-APPROVAL 통과 후 생성).

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
  `MODE_POLICY.acceptEdits` effect; dropped the false "GoalController re-seeds" analogy. Iteration-4 re-review pending.
