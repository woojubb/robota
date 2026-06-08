---
status: in-progress
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

- [ ] TC-01: `pnpm cli:dev` renders input area with zero `│` characters in the input row — only `─` top and bottom lines
- [ ] TC-02: `pnpm cli:dev` renders status bar content (model, branch, context%) in exactly 1 terminal line with no box border characters (`┌`, `┐`, `└`, `┘`, `─`, `│`) surrounding it
- [ ] TC-03: `pnpm --filter @robota-sdk/agent-transport typecheck` exits 0
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-transport test` exits 0 with no new failures
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-transport build` exits 0
- [ ] TC-06: at terminal width 60 columns, input top/bottom lines span the full width with no overflow

## Test Plan

Test strategy derived from type=SCREEN, tags=[cli]: process spawn + stdout assertion.

| TC-ID | Test Type | Tool / Approach                            | Notes                                                                     |
| ----- | --------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| TC-01 | manual    | `pnpm cli:dev` visual inspection           | No automated snapshot test for Ink TUI exists; adding one is out of scope |
| TC-02 | manual    | `pnpm cli:dev` visual inspection           | Same as TC-01                                                             |
| TC-03 | automated | `pnpm typecheck`                           | Must exit 0                                                               |
| TC-04 | automated | `pnpm test` (vitest)                       | Must pass with no regressions                                             |
| TC-05 | automated | `pnpm build`                               | Must exit 0                                                               |
| TC-06 | manual    | resize terminal to 60 cols, `pnpm cli:dev` | Visual inspection only                                                    |

## Tasks

- [ ] `.agents/tasks/SCREEN-001.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

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
