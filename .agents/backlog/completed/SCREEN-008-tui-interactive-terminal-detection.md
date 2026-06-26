---
title: 'SCREEN-008: Shared interactive-terminal detection for TUI motion/color'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: medium
urgency: soon
area: packages/agent-transport-tui
depends_on: []
---

# Shared interactive-terminal detection for TUI motion/color

Follow-up from the code review of SCREEN-006.

## What

1. **`NO_COLOR=''` ignored (`WaveText.tsx`).** `shouldAnimate()` uses
   `!process.env.NO_COLOR`, so an empty-but-present `NO_COLOR=` (valid per the NO_COLOR
   convention — present regardless of value disables) still animates. Use presence
   (`'NO_COLOR' in process.env`) not truthiness.
2. **Divergent detectors.** `WaveText`'s `shouldAnimate()` and `render-markdown.ts`'s
   color gate independently answer "is this an interactive color terminal" with different
   logic (render-markdown honors `FORCE_COLOR=0`; WaveText ignores it). Extract one shared
   `isInteractiveColorTerminal()` (TTY + `NO_COLOR` presence + `FORCE_COLOR`) and use it in
   both, so motion and color stay consistent and the next env knob is added once.

## Why

Code review (2026-06-27): SCREEN-006's non-TTY/NO_COLOR gate has an empty-string hole and
duplicates a second, slightly different terminal-capability check, risking inconsistent
motion-vs-color behavior (e.g. `FORCE_COLOR=0` strips markdown color but not the wave).

## Done When

- `NO_COLOR` (any value, including empty) disables WaveText animation.
- One shared interactive-terminal helper consumed by WaveText and render-markdown.
- Package build + tests pass (unit test the helper across NO_COLOR/FORCE_COLOR/TTY).

## Test Plan

- Unit: helper returns false for `NO_COLOR=''`, `NO_COLOR=1`, `FORCE_COLOR=0`, non-TTY;
  true for a plain TTY.
- `pnpm --filter @robota-sdk/agent-transport-tui build` + `test`.

## User Execution Test Scenarios

1. Run the CLI with `NO_COLOR=` (empty) → no wave animation. Evidence: _to fill._
2. Run with `FORCE_COLOR=0` → markdown color and wave motion are both suppressed
   consistently. Evidence: _to fill._

## Resolution (2026-06-27)

New `terminal-capabilities.ts` exports `isInteractiveColorTerminal()` (NO_COLOR
presence — any value including empty — disables; FORCE_COLOR honored; else isTTY).
`WaveText.shouldAnimate` and `render-markdown.shouldUseColor` both delegate to it;
the unused `ZERO_COLOR` constant was removed. Unit test covers NO_COLOR=''/=1,
FORCE_COLOR=0/1, and the isTTY fallback. Build + 382 tests pass.
