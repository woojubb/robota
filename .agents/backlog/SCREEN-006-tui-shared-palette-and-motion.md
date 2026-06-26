---
title: 'SCREEN-006: Shared TUI color palette and accessible motion'
status: todo
created: 2026-06-26
priority: medium
urgency: soon
area: packages/agent-transport-tui
depends_on: []
---

# Shared TUI color palette and accessible motion

## What

- **Shared palette/theme:** color values are scattered — `render-markdown.ts` hardcodes
  raw ANSI escape strings (`[38;5;210m` …) while other components use chalk named
  colors; `StatusBar.tsx` repeats hardcoded separators and many distinct colors. Extract a
  single theme/palette module (semantic tokens: `success`/`error`/`warning`/`info`/`muted`)
  and consume it across components. Keep respecting `NO_COLOR`.
- **WaveText motion:** `WaveText.tsx` animates at 400ms with a narrow `#666→#aaa` range —
  near-imperceptible, ornamental, and with no reduced-motion / non-TTY check. Either make
  it meaningful (faster, wider contrast) or gate it behind a reduced-motion / `NO_COLOR` /
  non-interactive check, or remove it.

## Why

Design review (2026-06-26): color graded B with scattered definitions; the wave animation
is motion without purpose and ignores accessibility/non-TTY contexts.

## Findings addressed

- Hardcoded ANSI in `render-markdown.ts` vs chalk elsewhere — no shared palette.
- `StatusBar` color density + repeated separator literals.
- `WaveText` imperceptible + no reduced-motion/non-TTY gate.

## Done When

- One palette/theme module is the source of truth; components import from it.
- WaveText respects reduced-motion / non-TTY (or is removed).
- SPEC.md for `agent-transport-tui` updated if a theme contract is introduced.
- Package build + tests pass.

## Test Plan

- Grep for raw ANSI escape strings and ad-hoc chalk colors outside the theme module → 0.
- Unit test the reduced-motion / non-TTY gate for WaveText.

## User Execution Test Scenarios

1. Run the CLI with `NO_COLOR=1` → output is legible with no raw escape artifacts; no
   distracting animation. Evidence: _to fill after implementation._
2. Run normally → status/markdown colors are consistent across components.
   Evidence: _to fill after implementation._
