---
title: 'CLI-B13: TUI input area border cleanup — remove side borders and status bar box border'
status: done
created: 2026-06-04
priority: low
urgency: later
area: packages/agent-transport
depends_on: []
---

## Goal

Reduce visual noise and line-height cost in the TUI bottom area by:

1. **Input box (`InputArea.tsx`)**: remove left and right borders, keep only top and bottom.
2. **Status bar (`StatusBar.tsx`)**: remove all borders entirely so it renders inline without the box overhead (currently costs 3 terminal lines for 1 line of content).

## Current Layout

```
┌── status bar box (top border line)
│  model · branch · context%         [agent]  (content line)
└───────────────────────────────────────────  (bottom border line)
┌──────────────────────────────────────────┐  (input top border = hand-drawn)
│ > cursor                                 │  ← left │ and right │ borders
└──────────────────────────────────────────┘  (input bottom border)
```

## Target Layout

```
  model · branch · context%         [agent]   (status bar — no box, no borders)
──────────────────────────────────────────── (input top border only)
  > cursor
──────────────────────────────────────────── (input bottom border only)
```

## Implementation Notes

### `InputArea.tsx`

- The input box uses a hand-drawn top border (`topBorder` string in `<Text>`) plus
  `<Box borderStyle="single" borderTop={false} ...>` for left/right/bottom.
- Change the `<Box>` to `borderLeft={false} borderRight={false}` (keep `borderBottom={true}`,
  `borderTop={false}`).
- Update `BORDER_HORIZONTAL` constant: currently accounts for 2 columns (left + right side borders).
  After removing side borders, set to 0 (no columns consumed by borders).
- `availableWidth` / `innerWidth` calculations must be updated accordingly.

### `StatusBar.tsx`

- Remove `borderStyle="single"` and `borderColor="gray"` from the root `<Box>`.
- Remove `paddingLeft={1} paddingRight={1}` if those were purely for border spacing — verify first.

## Test Plan

- `pnpm --filter @robota-sdk/agent-transport typecheck` passes
- `pnpm --filter @robota-sdk/agent-transport test` passes
- Build passes: `pnpm --filter @robota-sdk/agent-transport build`
- Visual smoke: `pnpm cli:dev` renders without side pipes on input and without box around status bar

## User Execution Test Scenarios

### Scenario 1 — Input area side borders removed

**Prerequisites:** built CLI, terminal ≥ 80 columns

**Steps:**

1. `pnpm cli:dev`
2. Observe the bottom input area at startup

**Expected:** input row shows `> cursor` with only a horizontal line above and below — no `│` on either side

**Evidence (2026-06-13, real binary `bin/robota.cjs` in a real PTY, 100x30):** already
implemented by SCREEN-001/SCREEN-002 (shipped in 3.0.0-beta.73) - verified against current
develop. Bottom-area snapshot:

```
"--------------------------------------------"  (input top border - full width)
" > Type a message or /help"                    (no side bars on either side)
"--------------------------------------------"  (input bottom border)
" Idle  |  Anthropic claude-test-model  |  Context: 0% (0K/200K tokens)"
```

`prompt line has side borders: false` - B13_VERIFY_PASS. Code state: `InputArea.tsx`
`BORDER_HORIZONTAL = 0` ("Side borders removed - only top/bottom horizontal lines remain").

### Scenario 2 — Status bar renders without box

**Prerequisites:** same as above

**Steps:**

1. `pnpm cli:dev`
2. Observe the row immediately above the input area

**Expected:** status bar content (model name, branch, context%) displays on a plain line, no box characters around it, takes exactly 1 terminal line

**Evidence (2026-06-13, same PTY run):** `status line has box characters: false`,
`status line is a single plain line: true` - `StatusBar.tsx` root is a plain
`<Box paddingLeft={1} paddingRight={1}>` with no `borderStyle`.

### Scenario 3 — Layout intact at narrow terminal width (60 columns)

**Steps:**

1. Resize terminal to ~60 columns
2. `pnpm cli:dev`

**Expected:** no visual overflow or misaligned borders; input top/bottom lines span the full width

**Evidence (2026-06-13, PTY at 60x30):** border lines span exactly 60 columns, no overflow
or box characters; long status content word-wraps as plain text (no misalignment) -
B13_VERIFY_PASS.

## Closure note (2026-06-13)

This item was already delivered by SCREEN-001 (input side-border removal) and SCREEN-002
(status bar below input, box removed), shipped in 3.0.0-beta.73. No code change was needed;
closure is by the verification evidence above. NOTE: the SCREEN-001/SCREEN-002 spec
documents still sit in `.agents/spec-docs/active/` with stale `in-progress` status - their
gate pipelines were never formally completed and need separate bookkeeping.
