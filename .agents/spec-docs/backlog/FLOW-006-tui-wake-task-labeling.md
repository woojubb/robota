---
status: review-ready
type: SCREEN
tags: [cli]
---

# FLOW-006: TUI labeling of agent-wake tasks (Layer 6)

> Layer 6 of the agent-wakeup epic (see FLOW-001 "Epic & Layering"). Depends on **FLOW-002** (wake tasks exist and inject turns). Note: type is SCREEN (visual output) though it belongs to the FLOW epic.

## Problem

Once agent-wake tasks exist (scheduled wakes, monitors), the TUI background-task workspace renders them the same as plain shell-only scheduled/process tasks. The user cannot tell, at a glance, which background tasks will **wake the agent** (run an instruction) versus which only run a shell command. The workspace already shows `next: Xm` for sleeping tasks (`execution-workspace-projection.ts` → `background-task-row-format.ts`) but carries no agent-wake indicator.

Reproduction (post-FLOW-002): create a scheduled wake (with `agentInstruction`) and a shell-only scheduled task; the TUI rows are visually indistinguishable.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/background-tasks/execution-workspace-projection.ts` — include an agent-wake flag/subtitle in the projected entry
- `packages/agent-transport/src/tui/background-task-row-format.ts` — render a distinct label (e.g. `↻ wake` or an instruction preview) for agent-wake tasks
- `packages/agent-transport/src/tui/__tests__/` — row-format assertions

### Alternatives Considered

**Alt A (chosen): add an agent-wake marker + instruction preview to the projected entry and render it in the row**

- The projection reads whether the task carries an `agentInstruction`; the row shows a distinct marker and a short instruction preview alongside the existing `next: Xm`.
- Pro: minimal, reuses the existing projection→row pipeline; one glance distinguishes wake vs shell-only
- Con: row width — instruction preview must be truncated to keep the row compact

**Alt B: a separate workspace section for wake tasks**

- Pro: strong separation
- Con: larger TUI restructure for marginal benefit; rejected in favor of an inline marker

### Decision

Alt A. Add an agent-wake marker + truncated instruction preview to the projected entry and render it inline in the background-task row, beside the existing `next: Xm`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `execution-workspace-projection` is the sole projector; `background-task-row-format` the sole row renderer
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `execution-workspace-projection`: set an `isAgentWake` flag + `instructionPreview` on the projected entry when the task has `agentInstruction`.
2. `background-task-row-format`: render a distinct marker and truncated instruction preview for agent-wake rows, alongside `next: Xm`.

## Affected Files

- `packages/agent-framework/src/background-tasks/execution-workspace-projection.ts`
- `packages/agent-transport/src/tui/background-task-row-format.ts`
- `packages/agent-transport/src/tui/__tests__/background-task-row-format.test.ts`

## Completion Criteria

- [ ] TC-01: an agent-wake task (has `agentInstruction`) renders a distinct marker and a truncated instruction preview in its workspace row
- [ ] TC-02: a shell-only scheduled/process task renders without the agent-wake marker (visual distinction preserved)
- [ ] TC-03: the instruction preview is truncated so the row stays within the existing width budget
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-transport test` exits 0
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-transport typecheck` exits 0

## Test Plan

Test strategy derived from type=SCREEN, tags=[cli]: render/format unit assertion on the row formatter.

| TC-ID | Test Type | Tool / Approach                                          | Notes                                 |
| ----- | --------- | -------------------------------------------------------- | ------------------------------------- |
| TC-01 | automated | vitest on `background-task-row-format` (agent-wake task) | Marker + truncated preview present    |
| TC-02 | automated | vitest on `background-task-row-format` (shell-only task) | No agent-wake marker                  |
| TC-03 | automated | vitest: long instruction                                 | Preview truncated within width budget |
| TC-04 | automated | `pnpm --filter @robota-sdk/agent-transport test`         | No regressions                        |
| TC-05 | automated | `pnpm --filter @robota-sdk/agent-transport typecheck`    | Must exit 0                           |

## Tasks

- [ ] `.agents/tasks/FLOW-006.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: SCREEN` (valid 11-prefix value); `tags: [cli]` present.
- Problem: concrete symptom (wake tasks render identically to shell-only tasks in the TUI workspace row) + reproduction condition (create a scheduled wake with `agentInstruction` and a shell-only scheduled task → rows are visually indistinguishable); no TBD/TODO/vague single-sentence.
- Architecture Review: all 4 checklist items `[x]`; sibling scan `[x]` with completion evidence (sole projector + sole row renderer); 2 alternatives (Alt A, Alt B) each with Pro+Con; Decision references the trade-off (inline marker vs. larger TUI restructure).
- Completion Criteria: all items TC-N prefixed (TC-01..TC-05); each is command form or observable behavior; no forbidden vague language.
- Test Plan: `## Test Plan` present; one row per TC-N (5 rows ↔ 5 criteria, count matches); every row has non-empty Test Type + Tool/Approach with no TBD; no "manual" rows so Notes-for-manual requirement is N/A.
- Structure: Tasks section present with placeholder; Evidence Log present and empty prior to this entry; no `## Status` or `## Classification` body sections.
- TC-N count match confirmed: Completion Criteria = 5, Test Plan = 5.
