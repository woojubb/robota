---
status: done
type: SCREEN
tags: [cli]
---

# SCREEN-004: Use a non-operator separator for status-bar activity counts

## Problem

The TUI status bar renders the active-activity counter as `Tools x7` (and `Background x7`). The `x` separator reads as a multiplication sign (`Tools × 7`), which misrepresents a simple count of in-flight items. The user expects a count glyph that does not look like an arithmetic operator — e.g. `Tools +7`.

Concrete symptom: `packages/agent-transport/src/tui/status-activity.ts` builds the label as `` `Tools x${count}` `` (line 33) and `` `Background x${count}` `` (line 47). During a run with N concurrent tools, the left status segment shows `Tools x{N}`.

Reproduction: `pnpm cli:dev` → submit a prompt that triggers one or more tool calls → observe the left segment of the status bar reads `Tools x1` (or higher).

## Architecture Review

### Affected Scope

- `packages/agent-transport/src/tui/status-activity.ts` — the only producer of the `Tools x{n}` / `Background x{n}` labels
- `packages/agent-transport/src/tui/__tests__/status-bar.test.tsx` — assertions on `Tools x2` / `Tools x12`
- `packages/agent-transport/src/tui/__tests__/status-activity.test.ts` (if present) — direct label assertions

### Alternatives Considered

**Alt A: `+N` additive separator — `Tools +7` / `Background +7`**

- Pro: compact; `+` reads as "and N more / N active", never as a multiplication operator
- Con: `+` can faintly imply "increment / add"

**Alt B: `×N` proper multiplication-sign glyph — `Tools ×7`**

- Pro: `×` (U+00D7) is the conventional "count/times" glyph in UI ("Items ×3")
- Con: the user explicitly rejected the multiplication reading; `×` is exactly the glyph they want to avoid, and is visually near-identical to `x`

**Alt C (chosen): parenthetical count — `Tools (7)` / `Background (2)`**

- Pro: unambiguous; no arithmetic-operator connotation at all; standard "count in parens" UI idiom
- Con: one character wider than `+N`; mild divergence from the prior compact single-token style — acceptable trade for zero ambiguity

### Decision

Alt C. The user selected the parenthetical form `(N)` over `+N` and `×N`. Parentheses carry no operator reading whatsoever, which is the user's core requirement (the `x` looked like multiplication). Apply `(N)` consistently to both the `tools` and `background` activity labels so the two counters stay visually uniform.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `status-activity.ts` is the sole label producer; `tools` and `background` are the only two count-bearing kinds (`thinking`/`queued`/`idle` carry no count), and both are updated together
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

In `packages/agent-transport/src/tui/status-activity.ts`:

1. Change the `tools` label from `` `Tools x${input.activeToolCount}` `` to `` `Tools (${input.activeToolCount})` ``.
2. Change the `background` label from `` `Background x${input.activeBackgroundTaskCount}` `` to `` `Background (${input.activeBackgroundTaskCount})` ``.

Update the corresponding test assertions (`Tools x2` → `Tools (2)`, `Tools x12` → `Tools (12)`).

## Affected Files

- `packages/agent-transport/src/tui/status-activity.ts`
- `packages/agent-transport/src/tui/__tests__/status-bar.test.tsx`
- `packages/agent-transport/src/tui/__tests__/status-activity.test.ts` (if it asserts the label literal)

## Completion Criteria

- [x] TC-01: `formatStatusActivity({ activeToolCount: 7, ... })` returns `label === 'Tools (7)'` and `text` begins with `Tools (7)`
- [x] TC-02: `formatStatusActivity({ activeToolCount: 0, activeBackgroundTaskCount: 3, ... })` returns `label === 'Background (3)'`
- [x] TC-03: rendering `StatusBar` with `activeToolCount={2}` produces a frame containing `Tools (2)` and no occurrence of `Tools x2`
- [x] TC-04: `pnpm --filter @robota-sdk/agent-transport test` exits 0 with no new failures
- [x] TC-05: `pnpm --filter @robota-sdk/agent-transport typecheck` exits 0

## Test Plan

Test strategy derived from type=SCREEN, tags=[cli]: process spawn + stdout assertion. The status label is produced by a pure function and rendered by an Ink component, so it is fully covered by unit + ink-testing-library render assertions (stronger and faster than process spawn for this string).

| TC-ID | Test Type | Tool / Approach                                                   | Notes                                              |
| ----- | --------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| TC-01 | automated | vitest unit on `formatStatusActivity`                             | Pure function; asserts exact label literal         |
| TC-02 | automated | vitest unit on `formatStatusActivity`                             | Background branch                                  |
| TC-03 | automated | ink-testing-library render of `StatusBar` (`status-bar.test.tsx`) | Asserts frame contains `Tools (2)`, not `Tools x2` |
| TC-04 | automated | `pnpm --filter @robota-sdk/agent-transport test`                  | Full suite, no regressions                         |
| TC-05 | automated | `pnpm --filter @robota-sdk/agent-transport typecheck`             | Must exit 0                                        |

## Tasks

- [x] `.agents/tasks/completed/SCREEN-004.md` — 완료 후 아카이브 (GATE-COMPLETE)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: SCREEN` (valid 11-prefix value); `tags: [cli]` present.
- Problem: concrete symptom (`status-activity.ts` builds `` `Tools x${count}` `` at line 33 / `` `Background x${count}` `` at line 47); reproduction condition (`pnpm cli:dev` → prompt with tool calls → `Tools x1`); no TBD/TODO/vague language.
- Architecture Review: Affected Scope listed; 3 alternatives (A/B/C) each with Pro+Con; Decision references the operator-reading trade-off; all 4 checklist items `[x]`; sibling-scan item `[x]` with completion evidence (sole label producer, both count-bearing kinds updated together).
- Completion Criteria: TC-01..TC-05 all TC-N prefixed; each concrete/observable (exact label literals, exit codes); no banned vague phrases.
- Test Plan: `## Test Plan` present; 5 rows (TC-01..TC-05) match 5 Completion Criteria; every row has non-empty Test Type and Tool/Approach; no "TBD"; no "manual" rows (all automated), Notes present on every row.
- Structure: Tasks section present with placeholder; Evidence Log was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count check: Completion Criteria = 5, Test Plan rows = 5 — match confirmed.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Prior gate: `[GATE-WRITE] — ✅ PASS | 2026-06-13` entry present and complete (draft → review-ready). No NON-COMPLIANCE.
- Explicit user approval: the user was presented both designs and, via a structured choice, explicitly selected the parenthetical form — quote: "괄호 (7)" → `Tools (N)` / `Background (N)`. This is a direct, unambiguous design selection directed at this spec (not a clarifying-question answer, not silence, not approval of a different item).
- Decision section reflects the approved choice: "Alt C (chosen): parenthetical count — `Tools (7)` / `Background (2)`" and the Decision paragraph states "Alt C. The user selected the parenthetical form `(N)`". Matches the approved separator.
- Architecture Review complete: all 4 checklist items `[x]`, including sibling-scan with completion evidence (sole label producer; both count-bearing kinds updated together).
- No Architecture Review or frontmatter `type`/`tags` modified after approval: `type: SCREEN`, `tags: [cli]` unchanged.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- Tasks complete: all 5 checkboxes in `.agents/tasks/SCREEN-004.md` (TC-01..TC-05) are `[x]`; none blocked or pending.
- TC-01/TC-02 (implementation): `packages/agent-transport/src/tui/status-activity.ts` line 33 produces `` `Tools (${input.activeToolCount})` `` and line 47 produces `` `Background (${input.activeBackgroundTaskCount})` `` — parenthetical `(N)` form, no `x` separator.
- TC-01/TC-02 (tests): `__tests__/status-activity.test.ts` asserts `activity.label).toBe('Tools (2)')` (line 14), `activity.text).toBe('Tools (2) · queued')` (line 17), and `activity.label).toBe('Background (1)')` (line 42) — `(N)` form confirmed.
- TC-03 (tests): `__tests__/status-bar.test.tsx` asserts `frame).toContain('Tools (2)')` and `frame).not.toContain('Tools x2')` (lines 112-113), plus `frame).toContain('Background (3)')` (line 123) and `activitySegment).toContain('Tools (12)')` (line 141). No `Tools x` literal remains anywhere.
- TC-04 (test suite): ran `pnpm --filter @robota-sdk/agent-transport test` → 61 test files passed, 473 tests passed, exit 0 (no failures, no regressions).
- TC-05 (typecheck): ran `pnpm --filter @robota-sdk/agent-transport typecheck` (`tsc --noEmit`) → exit 0, no type errors.

### [GATE-COMPLETE] — ❌ FAIL | 2026-06-13

**Status remains:** verifying
**Failed criteria:**

- Tasks file archival: GATE-COMPLETE requires the tasks file archived to `.agents/tasks/completed/SCREEN-004.md`, but it still resides at `.agents/tasks/SCREEN-004.md` (active) and is absent from `completed/`. The `## Tasks` section still references the active path (GATE-IMPLEMENT placeholder), not the archived path.
  **Required action:** Archive `.agents/tasks/SCREEN-004.md` → `.agents/tasks/completed/SCREEN-004.md` and update the `## Tasks` section to reflect the archived path, then re-run GATE-COMPLETE.

**Criteria that passed (recorded for the re-run):**

- Entry state: frontmatter `status: verifying`; prior `[GATE-VERIFY] — ✅ PASS | 2026-06-13` entry present and complete (in-progress → verifying). No NON-COMPLIANCE.
- User Execution Test Scenarios: section is absent (`grep "User Execution"` → not found). All 5 TCs are automated unit/render/typecheck tests, so the done-gate user-execution evidence requirement does not apply; automated TC evidence + GATE-VERIFY PASS is the completion evidence.
- Completion Criteria checkboxes: TC-01..TC-05 all `[x]`.
- Per-TC verification evidence (commands, outputs, exit codes) is recorded in the GATE-VERIFY entry: TC-01/TC-02 label literals in `status-activity.ts` + `status-activity.test.ts`; TC-03 frame assertions in `status-bar.test.tsx` (`Tools (2)`, not `Tools x2`); TC-04 test suite exit 0 (61 files / 473 tests); TC-05 typecheck exit 0.
- Test Plan TC-N references: each of TC-01..TC-05 maps to a concrete automated test (`status-activity.test.ts`, `status-bar.test.tsx`, full suite, typecheck) — no TC-N silently unaddressed.
- Tasks file checkboxes: all 5 TCs `[x]` in `.agents/tasks/SCREEN-004.md`; no open TODO.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- Re-run after prior FAIL (tasks file not archived). Prior gate: `[GATE-VERIFY] — ✅ PASS | 2026-06-13` entry present and complete (in-progress → verifying). No NON-COMPLIANCE.
- Tasks file archival (the prior failing criterion): tasks file is now archived at `.agents/tasks/completed/SCREEN-004.md` (confirmed present, contains all 5 TCs `[x]`); the active `.agents/tasks/SCREEN-004.md` no longer exists. FIXED.
- `## Tasks` section: now references the archived path `.agents/tasks/completed/SCREEN-004.md` with `[x]` (no longer the active GATE-IMPLEMENT placeholder). FIXED.
- Completion Criteria checkboxes: TC-01..TC-05 all `[x]`.
- Per-TC verification evidence (commands, outputs, exit codes) recorded in the GATE-VERIFY entry: TC-01/TC-02 label literals in `status-activity.ts` + `status-activity.test.ts`; TC-03 frame assertions in `status-bar.test.tsx` (`Tools (2)`, not `Tools x2`); TC-04 test suite exit 0 (61 files / 473 tests); TC-05 typecheck exit 0.
- Test Plan TC-N references: TC-01..TC-05 each map to a concrete automated test (`status-activity.test.ts`, `status-bar.test.tsx`, full suite, typecheck) — no TC-N silently unaddressed.
- User Execution Test Scenarios: no `## User Execution Test Scenarios` section header exists in the spec body (only a prose mention inside the prior FAIL entry); done-gate user-execution evidence requirement is N/A — all 5 TCs are automated tests, covered by GATE-VERIFY PASS + automated TC evidence.
