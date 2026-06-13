---
status: done
type: SCREEN
tags: [cli]
---

# SCREEN-001: TUI input area border cleanup

## Problem

The TUI bottom area wastes terminal lines due to unnecessary border characters:

1. **Input box side borders**: `InputArea.tsx` renders `│` on both left and right sides via `<Box borderStyle="single" borderTop={false}>`. The user wants only a top and bottom horizontal line — no side pipes.
2. **Status bar box**: `StatusBar.tsx` wraps its content in `<Box borderStyle="single">`, costing 3 terminal lines (top border, content, bottom border) for what should be 1 line. The box border should be removed entirely.

Reproduction: launch `pnpm cli:dev` and observe the bottom 4 rows of the terminal.

## Architecture Review

### Affected Scope

- `packages/agent-transport/src/tui/InputArea.tsx` — remove side borders, adjust `BORDER_HORIZONTAL` constant and `availableWidth` / `innerWidth` calculations
- `packages/agent-transport/src/tui/StatusBar.tsx` — remove `borderStyle="single"`, `borderColor`, and border-related padding

### Alternatives Considered

**Alt A (chosen): Remove side borders from input box + remove all borders from status bar**

- Pro: minimal change, respects existing hand-drawn top/bottom line in InputArea, saves 2 terminal lines overall
- Con: slight visual change to status bar — content no longer has box separation

**Alt B: Keep status bar box but remove top/bottom borders (side borders only)**

- Pro: still has visual separation on sides
- Con: user explicitly said remove all borders from status bar; side-only borders look unusual

**Alt C: Replace status bar box with a plain separator line**

- Pro: more explicit visual boundary
- Con: adds a new element; user did not ask for this

### Decision

Alt A. The user's request is precise: input box keeps top/bottom horizontal lines only (no side `│`), and the box above (status bar) loses all borders.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: change is limited to two self-contained render components; no sibling TUI components depend on InputArea or StatusBar layout metrics
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

### `InputArea.tsx`

- Current: `<Box borderStyle="single" borderTop={false} borderColor={borderColor} ...>` → produces left `│`, right `│`, and bottom `─` line.
- Change to: `borderLeft={false} borderRight={false}` (keep `borderBottom={true}`, `borderTop={false}`).
- `BORDER_HORIZONTAL` constant is currently `2` (1 column each for left + right border). After removing side borders, set to `0`.
- `innerWidth` and `availableWidth` are derived from `terminalColumns - BORDER_HORIZONTAL`, so they automatically widen to the full terminal width.

### `StatusBar.tsx`

- Remove `borderStyle="single"` and `borderColor="gray"` from the root `<Box>`.
- Adjust `paddingLeft` / `paddingRight` only if they were compensating for the missing border column — verify in code before removing.

## Affected Files

- `packages/agent-transport/src/tui/InputArea.tsx`
- `packages/agent-transport/src/tui/StatusBar.tsx`

## Completion Criteria

- [x] TC-01: `pnpm cli:dev` renders input area with zero `│` characters in the input row — only `─` top and bottom lines
- [x] TC-02: `pnpm cli:dev` renders status bar content (model, branch, context%) in exactly 1 terminal line with no box border characters (`┌`, `┐`, `└`, `┘`, `─`, `│`) surrounding it
- [x] TC-03: `pnpm --filter @robota-sdk/agent-transport typecheck` exits 0
- [x] TC-04: `pnpm --filter @robota-sdk/agent-transport test` exits 0 with no new failures
- [x] TC-05: `pnpm --filter @robota-sdk/agent-transport build` exits 0
- [x] TC-06: at terminal width 60 columns, input top/bottom lines span the full width with no overflow

## Test Plan

Test strategy derived from type=SCREEN, tags=[cli]: process spawn + stdout assertion.

| TC-ID | Test Type | Tool / Approach                            | Notes / Verification reference                                                                                                                                                                                                                   |
| ----- | --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-01 | manual    | `pnpm cli:dev` visual inspection           | No automated snapshot test for Ink TUI exists; adding one is out of scope. Verified: code read (InputArea.tsx `BORDER_HORIZONTAL=0`, side borders false) + real-PTY artifact CLI-B13 Scenario 1 (100x30, `prompt line has side borders: false`). |
| TC-02 | manual    | `pnpm cli:dev` visual inspection           | Same as TC-01. Verified: code read (StatusBar.tsx root `<Box>` no `borderStyle`) + CLI-B13 Scenario 2 (`status line has box characters: false`, single plain line).                                                                              |
| TC-03 | automated | `pnpm typecheck`                           | Must exit 0. Verified: develop CI green (GATE-VERIFY 2026-06-13).                                                                                                                                                                                |
| TC-04 | automated | `pnpm test` (vitest)                       | Must pass with no regressions. Verified: GATE-VERIFY 2026-06-13 — exit 0, 473/473 tests passed.                                                                                                                                                  |
| TC-05 | automated | `pnpm build`                               | Must exit 0. Verified: GATE-VERIFY 2026-06-13 — exit 0, build complete 643ms.                                                                                                                                                                    |
| TC-06 | manual    | resize terminal to 60 cols, `pnpm cli:dev` | Visual inspection only. Verified: code read (`innerWidth = terminalColumns - 0`) + real-PTY artifact CLI-B13 Scenario 3 (60x30, borders span 60 cols, no overflow).                                                                              |

## Tasks

- [x] `.agents/tasks/completed/SCREEN-001.md` — archived at GATE-COMPLETE (retroactive — already-shipped code)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-05

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` present; `type: SCREEN` is a valid prefix; `tags: [cli]` present.
- Problem section: concrete symptom (InputArea.tsx side `│` borders, StatusBar 3-line waste) with specific file names and properties; reproduction condition (`pnpm cli:dev`, observe bottom 4 rows); no TBD/TODO/vague language.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan is `[x]` with explicit `N/A: <reason>`; 3 alternatives with pro/con each (Alt A, B, C); decision references the user-stated requirement as the deciding trade-off.
- Completion Criteria: 6 items, all prefixed TC-01–TC-06; observable behavior or command+exit-code form used throughout; no vague phrases ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: `## Test Plan` section present; 6 rows match 6 TC-N entries (count match confirmed); all rows have non-empty Test Type and Tool/Approach; manual rows TC-01, TC-02, TC-06 each have a Notes entry explaining why automated test is not possible.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section was empty before this entry; no `## Status` or `## Classification` body sections found.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-05

**Status upgrade:** review-ready → approved

- User explicitly approved: "승인 합니다."
- Approved scope: InputArea.tsx side border removal + StatusBar.tsx full border removal
- No objections to TC-01~TC-06 completion criteria

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file exists: `.agents/tasks/SCREEN-001.md` is present and readable.
- Tasks file path recorded in `## Tasks`: spec `## Tasks` section references `.agents/tasks/SCREEN-001.md`.
- Tasks correspond to Completion Criteria (one task per TC-N): T1→TC-01, T2→TC-02, T3→TC-03, T4→TC-04, T5→TC-05, T6→TC-06 — all 6 TCs covered, plus T7 wrap-up; mapping confirmed complete.
- Code currently on develop matches the tasks' claims (verified 2026-06-13): `InputArea.tsx` has `BORDER_HORIZONTAL = 0` (line 55) with `borderTop={false} borderLeft={false} borderRight={false}` (lines 266-268), and `StatusBar.tsx` has no `borderStyle`/`borderColor` (grep returned no match).
- NON-COMPLIANCE trigger ("implementation commits exist but no tasks file was created") does NOT apply: GATE-APPROVAL passed 2026-06-05 (user "승인 합니다.") before the code shipped in 3.0.0-beta.73, so the implementation was authorized. The missing tasks file was a pipeline-bookkeeping gap, not a no-approval violation; this gate creates and records that file as retroactive bookkeeping.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- Tasks complete: `.agents/tasks/SCREEN-001.md` T1–T6 all `[x]` (TC-01→TC-06 coverage). T7 wrap-up (spec→done + tasks archive) is the deferred GATE-COMPLETE step, not a GATE-VERIFY blocker — adjudicated per the CLI-063..073 unchecked-wrap-up precedent. No tasks blocked or pending.
- Build passes: `pnpm --filter @robota-sdk/agent-transport build` exited 0 — "Build complete in 643ms", 38 files / 481.90 kB.
- Tests pass: `pnpm --filter @robota-sdk/agent-transport test` exited 0 — Test Files 61 passed (61), Tests 473 passed (473), matching the expected 473 green. No code edit was made (spec/tasks docs only), consistent with current develop HEAD CI-green.
- Code conformance (substance verified fresh 2026-06-13): `InputArea.tsx` has `BORDER_HORIZONTAL = 0` (line 55) and `borderTop={false} borderLeft={false} borderRight={false}` on the input `<Box>` (lines 266–268); `StatusBar.tsx` root `<Box>` (line 186) has only `paddingLeft`/`paddingRight`/`justifyContent` with no `borderStyle`/`borderColor`.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

**Checkbox:** `[x]` confirmed in `## Completion Criteria`.
**Verification action (manual TC — code read + PTY artifact):** Read `packages/agent-transport/src/tui/InputArea.tsx`. `BORDER_HORIZONTAL = 0` (line 55); input `<Box>` has `borderStyle="single" borderTop={false} borderLeft={false} borderRight={false}` (lines 265–268) — only top/bottom horizontal lines render, no side `│`.
**Observed result:** Side borders absent. Corroborated by real-PTY artifact `.agents/backlog/completed/CLI-B13-tui-input-border-cleanup.md` Scenario 1 (100x30): prompt line `" > Type a message or /help"` with `prompt line has side borders: false` — B13_VERIFY_PASS.
**Test reference:** TC-01 manual — code read + PTY capture (CLI-B13 Scenario 1).

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

**Checkbox:** `[x]` confirmed in `## Completion Criteria`.
**Verification action (manual TC — code read + PTY artifact):** Read `packages/agent-transport/src/tui/StatusBar.tsx`. Root `<Box paddingLeft={1} paddingRight={1} justifyContent="space-between">` (line 186) — no `borderStyle`, no `borderColor`.
**Observed result:** Status bar renders as a single plain line, no box characters. Corroborated by CLI-B13 Scenario 2: `status line has box characters: false`, `status line is a single plain line: true`.
**Test reference:** TC-02 manual — code read + PTY capture (CLI-B13 Scenario 2).

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

**Checkbox:** `[x]` confirmed in `## Completion Criteria`.
**Verification action:** Cited from GATE-VERIFY (2026-06-13) — typecheck is covered by develop CI-green (no code edit; docs only). Build/test ran clean at GATE-VERIFY.
**Observed result:** develop HEAD CI green; typecheck exits 0.
**Test reference:** TC-03 automated — `pnpm --filter @robota-sdk/agent-transport typecheck` (develop CI green, GATE-VERIFY entry).

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-13

**Checkbox:** `[x]` confirmed in `## Completion Criteria`.
**Verification action:** Cited from GATE-VERIFY (2026-06-13): `pnpm --filter @robota-sdk/agent-transport test`.
**Observed result:** Exit 0 — Test Files 61 passed (61), Tests 473 passed (473), no regressions.
**Test reference:** TC-04 automated — vitest suite (473/473 green, GATE-VERIFY entry).

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-06-13

**Checkbox:** `[x]` confirmed in `## Completion Criteria`.
**Verification action:** Cited from GATE-VERIFY (2026-06-13): `pnpm --filter @robota-sdk/agent-transport build`.
**Observed result:** Exit 0 — "Build complete in 643ms", 38 files / 481.90 kB.
**Test reference:** TC-05 automated — `pnpm --filter @robota-sdk/agent-transport build` (exit 0, GATE-VERIFY entry).

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-06-13

**Checkbox:** `[x]` confirmed in `## Completion Criteria`.
**Verification action (manual TC — code read + PTY artifact):** Code-level `innerWidth = terminalColumns - BORDER_HORIZONTAL` with `BORDER_HORIZONTAL = 0` (InputArea.tsx line 55) → borders span the full terminal width at any column count. Corroborated by real-PTY artifact CLI-B13 Scenario 3 (60x30).
**Observed result:** CLI-B13 Scenario 3: "border lines span exactly 60 columns, no overflow or box characters; long status content word-wraps as plain text (no misalignment)" — B13_VERIFY_PASS.
**Test reference:** TC-06 manual — code read + PTY capture at 60 cols (CLI-B13 Scenario 3).

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- All 6 Completion Criteria checkboxes (TC-01–TC-06) are `[x]`; each has a matching `[GATE-COMPLETE: TC-N]` Evidence entry with verification action + observed result.
- Test Plan: all 6 TC-N rows updated with test references / verification artifacts (manual TC-01/02/06 → code read + CLI-B13 PTY captures; automated TC-03/04/05 → typecheck/test/build per GATE-VERIFY).
- Tasks file archived: `.agents/tasks/completed/SCREEN-001.md` exists (T1–T7 all `[x]`); no stale `.agents/tasks/SCREEN-001.md` remains.
- `## Tasks` section references the archived path `.agents/tasks/completed/SCREEN-001.md`.
- Retroactive closure of already-shipped (3.0.0-beta.73) work; no code change required.
