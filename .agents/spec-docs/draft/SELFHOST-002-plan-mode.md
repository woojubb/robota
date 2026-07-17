---
status: draft
type: FLOW
tags: [plan-mode, hitl, agent-core, agent-framework, cli, selfhost]
---

# SELFHOST-002: explicit plan-mode (plan → review → approve → act)

## Problem

Promotes backlog [SELFHOST-002](../../backlog/SELFHOST-002-plan-mode.md) toward [VISION.md](../../../VISION.md).
Robota has permissions/HITL but **no dedicated plan-first-then-execute gate** — a near-universal advantage of
coding agents. For Robota to safely develop Robota, it should produce a reviewable plan, get approval, and only
then mutate — mirroring the harness's own spec-first gate at the product level.

## Prior Art Research

Claude Code plan mode — research vs execution, approve-then-implement (https://code.claude.com/docs/); Devin
plan → review → act with dynamic re-planning (https://www.deployhq.com/guides/devin); Cline Plan & Act
(https://docs.cline.bot/core-workflows/plan-and-act); GitHub Copilot cloud agent research → plan → code
(https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent). Common shape: a plan/todo
artifact + an approval gate that blocks mutation until granted; read-only exploration allowed during planning.
Robota constraint: model the plan/approval as a neutral event + permission gate in `agent-core` (reuse the
existing permissions engine), surfaced by product shells.

## Architecture Review

### Affected Scope

- **`agent-core`**: a plan/approval **event** + a permission gate that blocks mutating tools until the plan is
  approved (reuse the existing permissions engine).
- **`agent-framework`**: wire the plan phase into `InteractiveSession` (framework already has a `goal` module).
- **`agent-cli` / `apps/agent-app`**: a `/plan` flow + plan/todo view (product surface).

### Alternatives Considered

1. **Neutral plan/approval event + permission gate in agent-core, surfaced by shells (CHOSEN).**
   - ✅ Reuses the permissions engine; neutral; correct layer; product policy stays in surfaces.
   - ❌ Must define a clean plan-artifact contract without domain assumptions.
2. **Implement plan-mode only in agent-cli.**
   - ✅ Fast, product-local.
   - ❌ The gate mechanism (block-mutation-until-approved) belongs in core so every surface (app/web) inherits it.
     REJECTED (wrong layer, duplicated per surface).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core (event+gate), agent-framework (InteractiveSession wiring), cli/app (surface).
- [x] Sibling scan 완료 — reuses agent-core permissions engine + framework `goal` module; no new permission tier.
- [x] 대안 최소 2개 — 2 considered (core-gate CHOSEN; cli-only REJECTED wrong-layer), each Pro+Con.
- [x] 결정 근거 — the block-until-approved gate must live in core so all surfaces inherit it; independent GATE-APPROVAL to run.

## Solution

A plan phase: during planning the agent may use read-only tools + produces a plan/todo artifact; a mutating tool
is blocked by the permission gate until the plan is approved; on approval, execution proceeds. Neutral plan
artifact + approval event in agent-core; `InteractiveSession` transition in agent-framework; `/plan` + a plan view
in agent-cli/agent-app.

## Affected Files

| File                                                       | Change                                         |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `packages/agent-core/src/permissions/` + `.../plan/` (new) | plan artifact + approval event + mutation gate |
| `packages/agent-framework/src/interactive/`                | plan-phase transition                          |
| `packages/agent-cli/`, `apps/agent-app/`                   | `/plan` + plan/todo view                       |

## Completion Criteria

- [ ] TC-01: during plan phase, a mutating tool call is blocked until approval (unit test on the permission gate).
- [ ] TC-02: read-only tools are permitted during the plan phase (unit test).
- [ ] TC-03: on approval, the session transitions to execution and mutations are allowed (framework functional test).
- [ ] TC-04: a plan/todo artifact is produced and viewable via `/plan` (CLI behavior test + User Execution Scenario).
- [ ] TC-05: the gate lives in agent-core (no per-surface duplication) — verified by placement (only surfaces call it).

## Test Plan

| TC    | Verification                  | Type/Tool                          |
| ----- | ----------------------------- | ---------------------------------- |
| TC-01 | mutation blocked pre-approval | vitest unit                        |
| TC-02 | read-only allowed in plan     | vitest unit                        |
| TC-03 | approve → execute transition  | framework functional test          |
| TC-04 | `/plan` shows artifact        | CLI test + User Execution Scenario |
| TC-05 | gate in core                  | placement review                   |

## Tasks

`.agents/tasks/SELFHOST-002.md` — 미생성 (GATE-APPROVAL 통과 후 생성).

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Required before ENDORSE:
  (a) **reuse the existing `plan` permission mode** (`agent-core/src/permissions/permission-mode.ts` + `/mode plan`
  - `--dry-run`) as the mutation gate — do NOT add a parallel `agent-core/.../plan/` gate (single-enforcement-point
    SSOT via `PermissionEnforcer`/`evaluatePermission`). (b) the plan/approval **artifact + event contract belongs in
    `agent-interface-transport`** (Interface Package Rule: no interface packages in agent-core; sits with `IGoalState`),
    NOT agent-core. (c) add a plan-phase controller in `agent-framework` **mirroring `GoalController`** (planning →
    awaiting-approval → executing; approval flips permission mode plan→default). (d) fix Problem to a concrete symptom
    (`/mode plan` blocks mutation but there is no plan artifact/approval event; the transition is a manual toggle);
    make TC-05 falsifiable; add the headless verification path (`verification.md:50`). **Revision pending.**
