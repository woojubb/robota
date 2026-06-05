---
status: in-progress
type: SCREEN
tags: [cli]
---

# SCREEN-002: Move status bar below input area

## Problem

Currently the TUI renders components in this order (top → bottom):

1. MessageList
2. ContextWarningBanner
3. **SessionStatusBar** ← status bar
4. **InputArea** ← input box

The user wants to see the status bar below the input area so that status info (model, branch, context%) is visible immediately after typing — without the eye needing to jump over the input box.

Reproduction: launch `pnpm cli:dev` and observe the bottom of the terminal.

## Architecture Review

### Affected Scope

- `packages/agent-transport/src/tui/App.tsx` — swap render order of `<SessionStatusBar>` and `<InputArea>`

### Alternatives Considered

**Alt A (chosen): Swap render order in JSX**

- Pro: single-line change, zero logic change, zero prop change
- Con: none

**Alt B: Absolute positioning of StatusBar**

- Pro: layout-independent placement
- Con: breaks Yoga flow height calculation; prior session had issues with absolute positioning (RESUME-001 blank line bug)

### Decision

Alt A. Only the JSX render order changes — `<InputArea>` comes before `<SessionStatusBar>`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: only App.tsx render order changes; no other component depends on StatusBar/InputArea relative position
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

In `App.tsx`, move the `<InputArea ... />` block to appear **before** `<SessionStatusBar ... />`:

```tsx
// Before
<SessionStatusBar ... />
<InputArea ... />

// After
<InputArea ... />
<SessionStatusBar ... />
```

## Affected Files

- `packages/agent-transport/src/tui/App.tsx`

## Completion Criteria

- [ ] TC-01: `pnpm cli:dev` renders the status bar row below the input box bottom line
- [ ] TC-02: `pnpm cli:dev` renders the input box above the status bar with no visual gap or overlap
- [ ] TC-03: `pnpm --filter @robota-sdk/agent-transport typecheck` exits 0
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-transport test` exits 0 with no new failures
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-transport build` exits 0

## Test Plan

Test strategy derived from type=SCREEN, tags=[cli]: process spawn + stdout assertion.

| TC-ID | Test Type | Tool / Approach                  | Notes                                                                     |
| ----- | --------- | -------------------------------- | ------------------------------------------------------------------------- |
| TC-01 | manual    | `pnpm cli:dev` visual inspection | No automated snapshot test for Ink TUI; render order not assertable in CI |
| TC-02 | manual    | `pnpm cli:dev` visual inspection | Same as TC-01                                                             |
| TC-03 | automated | `pnpm typecheck`                 | Must exit 0                                                               |
| TC-04 | automated | `pnpm test` (vitest)             | Must pass with no regressions                                             |
| TC-05 | automated | `pnpm build`                     | Must exit 0                                                               |

## Tasks

- [ ] `.agents/tasks/SCREEN-002.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-05

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: SCREEN` is valid from the 11-prefix list; `tags: [cli]` present.
- Problem section: concrete symptom (component render order 1–4 listed); reproduction condition present (`pnpm cli:dev`); no TBD/TODO/vague language.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with explicit `N/A: only App.tsx render order changes; no other component depends on StatusBar/InputArea relative position`; 2 alternatives (Alt A, Alt B) with pro/con for each; decision references the trade-off (Yoga absolute positioning issues from RESUME-001).
- Completion Criteria: 5 criteria (TC-01–TC-05) all have TC-N prefix; cover distinct features (visual render ×2, typecheck, test, build); use command form (`pnpm ...`) or observable behavior; no vague language found.
- Test Plan: `## Test Plan` section present; 5 rows matching TC-01–TC-05 (count matches); all rows have non-empty Test Type and Tool/Approach; TC-01 and TC-02 (manual) both have non-empty Notes explaining why automated test is not possible.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty before this entry; no `## Status` or `## Classification` sections found in body.
- TC-N count: Completion Criteria = 5 (TC-01–TC-05); Test Plan rows = 5 (TC-01–TC-05) — counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-05

**Status upgrade:** review-ready → approved

- User explicitly approved: "승인함"
- Approved scope: swap `<SessionStatusBar>` and `<InputArea>` render order in App.tsx
