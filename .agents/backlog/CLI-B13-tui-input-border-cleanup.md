---
title: 'CLI-B13: TUI input area border cleanup — remove side borders and status bar box border'
status: todo
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

**Evidence:** _(fill after implementation)_

### Scenario 2 — Status bar renders without box

**Prerequisites:** same as above

**Steps:**

1. `pnpm cli:dev`
2. Observe the row immediately above the input area

**Expected:** status bar content (model name, branch, context%) displays on a plain line, no box characters around it, takes exactly 1 terminal line

**Evidence:** _(fill after implementation)_

### Scenario 3 — Layout intact at narrow terminal width (60 columns)

**Steps:**

1. Resize terminal to ~60 columns
2. `pnpm cli:dev`

**Expected:** no visual overflow or misaligned borders; input top/bottom lines span the full width

**Evidence:** _(fill after implementation)_
