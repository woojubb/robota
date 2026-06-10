---
title: 'CLI-062: CJK input real terminal cursor positioning disabled (Terminal.app SIGSEGV workaround)'
status: todo
created: 2026-06-10
priority: low
urgency: later
area: packages/agent-transport
depends_on: []
---

# CLI-062: CJK input cursor positioning disabled

## Problem

Real terminal cursor positioning for the CJK text input is intentionally disabled:
`packages/agent-transport/src/tui/CjkTextInput.tsx:82-85` — `setCursorPosition(x, 0)` crashed
Terminal.app via Korean IME SIGSEGV, and the correct fix needs the input row's y offset which
Ink does not expose. As a result the OS-level IME composition window can appear at the wrong
screen position during Hangul editing, and visual cursor feedback relies solely on the drawn
block cursor.

## Expected Behavior

Safe cursor synchronization restored: compute the input row's y offset (e.g. via Ink
measureElement/DOM node position or output-height accounting) and position the real cursor
only when the offset is known, never calling `setCursorPosition` with a guessed row. Must not
reintroduce the Terminal.app SIGSEGV (regression-test alongside CLI-052's warning).

## Test Plan

- Unit tests for the offset computation given mocked render heights.
- Manual matrix in iTerm2 + Terminal.app with Korean IME (crash regression check).
- `pnpm --filter @robota-sdk/agent-transport build && pnpm --filter @robota-sdk/agent-transport test`

## User Execution Test Scenarios

- Prerequisite: macOS with Korean IME; built CLI binary. Environment already exists.
- Steps: run `robota`, type Korean text mid-line and move the cursor with arrow keys while
  composing.
- Expected observable result: the IME candidate/composition window appears at the input
  position (not at the screen origin), and no crash occurs in Terminal.app.
- Cleanup: none.
- Evidence: (fill after implementation — screenshot of composition window position + Terminal.app no-crash note)
