---
title: 'CLI-062: CJK input real terminal cursor positioning disabled (Terminal.app SIGSEGV workaround)'
status: in-progress
created: 2026-06-10
priority: high
urgency: now
area: packages/agent-transport
depends_on: []
---

# CLI-062: CJK input cursor positioning disabled

> **2026-07-25 — owner re-prioritized (composition cursor still appears below the input box).**
> Investigation COMPLETE with POC-PASS: see
> [`.design/investigations/2026-07-25-cli-062-ime-cursor-design.md`](../../.design/investigations/2026-07-25-cli-062-ime-cursor-design.md)
> — that document is the implementation contract (mechanism: yoga parent-chain absolute y +
> ink `useCursor`; SIGSEGV root-caused to the historical hardcoded `y: 0`, with five crash-avoidance
> invariants I1–I5 and a pty regression plan). Implementation starts as soon as the CMD-004 Stage C
> branch frees `agent-transport-tui`.

> **2026-07-25 — IMPLEMENTED per the contract (PR: feat/cli-062-ime-cursor).** Shipped in
> `packages/agent-transport-tui`: `src/flows/real-cursor-flow.ts` (pure `computeCursorCell` +
> `shouldPositionRealCursor`), `src/hooks/useRealCursorPosition.ts` (yoga parent-chain origin +
> `useCursor`, zero stream writes), `CjkTextInput` `<Box ref>` wiring with drawn-cursor
> suppression only while active, `supportsImeCursorPositioning()` gate (Apple_Terminal off by
> default, `ROBOTA_IME_CURSOR=1` opt-in / `=0` kill switch). Invariants I1–I5 each carry a code
> comment + test; red-before-green proven — component + 24-row pty were RED pre-change
> (`expected 0 to be greater than 0`); fallback pinned byte-identical
> (`src/__tests__/cjk-fallback-render.test.tsx`). PTY regression:
> `src/__tests__/pty/ime-cursor.ptytest.ts` (24-row: every post-boot `ESC[?25h` on the input row
> at the composition column; 5-row: zero shows — I2). Housekeeping note: the design doc's
> "lockfile resolves ink 7.0.5" observation is stale — develop's lockfile resolves the declared
> `^7.1.1` (7.1.1) for both TUI packages; cursor internals verified byte-identical between
> 7.0.5/7.1.1, so no dependency change was made.
>
> **REMAINING (do not archive):** the manual terminal matrix (iTerm2 + Terminal.app
> ±`ROBOTA_IME_CURSOR`, kitty/WezTerm/Ghostty/Windows Terminal/tmux) on real hardware — I5 keeps
> Apple_Terminal off by default until it passes — and the owner-observed user-execution evidence
> (composition window at the input position, no Terminal.app crash).

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
