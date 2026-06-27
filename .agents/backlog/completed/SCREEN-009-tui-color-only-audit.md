---
title: 'SCREEN-009: Audit remaining TUI components for color-only encoding + symbol consistency'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: low
urgency: later
area: packages/agent-transport-tui
depends_on: []
---

## Evidence Log (2026-06-27)

- Audited all interactive + status components. Result: **no color-only state found**.
  - Selection/focus is consistent across every picker/prompt — `MenuSelect`, `InteractivePrompt`,
    `SlashAutocomplete`, `ConfirmPrompt`, `PermissionPrompt`, `SessionPicker` (via `ListPicker`),
    and `ExecutionWorkspaceSwitcher` all use the canonical `'> '` / `'  '` marker (symbol) +
    cyan/bold (non-color cues), not color alone.
  - Status is sourced from the `STATUS_GLYPH` SSOT (symbol + color) in `StreamingIndicator`,
    `background-task-row-format`, `ExecutionWorkspaceDetailPane`; the Switcher also renders a text
    `statusLabel`, so status is symbol + label + color.
- Added a durable regression test (`status-glyph.test.ts`) asserting every `STATUS_GLYPH` kind has
  a non-empty symbol AND color — a new status kind can't regress to color-only. 384 TUI tests pass;
  typecheck clean.

# Audit remaining TUI components for color-only encoding

## What

SCREEN-005/007 established the rule: every status pairs a SYMBOL with a color (never color
alone), and symbol+color derive from the shared `status-glyph.ts`. Apply the rule across
the components not yet reviewed:

- Scan all `packages/agent-transport-tui/src/*.tsx` for state conveyed by color alone
  (e.g. an entry/option whose only status cue is a `color=` with no accompanying symbol),
  and for ad-hoc chalk/ink color names not sourced from `status-glyph.ts`.
- Verify selection-indicator consistency across interactive components (the canonical
  `> ` selection symbol) — e.g. `MenuSelect`, `InteractivePrompt`, `ListPicker`,
  `SlashAutocomplete` — and that no component reintroduces a divergent marker.
- Fix the offenders to pair symbol+color from the shared source.

## Why

The status-legibility rule must hold uniformly for no-color terminals and colorblind
users; SCREEN-005/007 only touched the components the review flagged.

## Done When

- No interactive/status component encodes state by color alone.
- Selection indicators are consistent across components.
- Package build + tests pass; add/extend tests for any component changed.

## Test Plan

- Grep for `color=` on status text without a sibling symbol; review each.
- `pnpm --filter @robota-sdk/agent-transport-tui build` + `test`.

## User Execution Test Scenarios

1. Run the CLI with `NO_COLOR=1` and exercise the pickers/prompts/panels → every status is
   still distinguishable by symbol alone. Evidence: _to fill._
