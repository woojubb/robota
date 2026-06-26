---
title: 'SCREEN-005: Unify TUI status indicators and fix hidden command output'
status: todo
created: 2026-06-26
priority: high
urgency: soon
area: packages/agent-transport-tui
depends_on: []
---

# Unify TUI status indicators and fix hidden command output

## What

- **Shared StatusIndicator:** the same status (e.g. "running") is rendered three different
  ways — `StreamingIndicator.tsx` (icons ⟳/✓/✗/⊘), `BackgroundTaskPanel.tsx` (markers □/■),
  `ExecutionWorkspaceDetailPane.tsx` (color only). Extract one shared `StatusIndicator`
  with a single status→symbol+color map (symbol AND color, never color alone) and use it
  everywhere. Document the marker meanings.
- **Hidden command output:** `ToolCommandOutput.tsx` returns `null` for a successful
  command that produced no output, so the user cannot tell "ran, no output" from "not
  shown". Render a minimal success indicator (e.g. `✓ ok`) for every executed command.
- **stdout/stderr labelling:** stderr is prefixed (`[stderr]`) but stdout is not; when
  mixed it is unclear which is which. Prefix or color both consistently.

## Why

Design review (2026-06-26): consistency graded B−; status indicators vary across
components, adding cognitive load, and color-only encoding fails on no-color terminals.
Hidden success output violates user expectation that a run produced a visible result.

## Findings addressed

- Three divergent status-indicator styles → one shared component.
- Color-only status encoding (`ExecutionWorkspaceDetailPane`).
- `ToolCommandOutput` hides successful no-output commands (`null`).
- Inconsistent stdout/stderr labelling.

## Done When

- One `StatusIndicator` used by streaming, background tasks, and workspace panes.
- Every status pairs a symbol with color (no color-only).
- Successful no-output commands show a minimal confirmation.
- SPEC.md for `agent-transport-tui` updated for the new shared component/contract.
- Package build + tests pass.

## Test Plan

- Unit tests for the status→symbol+color map and for the no-output success render path.
- Build + typecheck.

## User Execution Test Scenarios

1. Run the CLI and execute a tool/command that succeeds with no output → a confirmation
   (e.g. `✓ ok`) appears instead of nothing. Evidence: _to fill after implementation._
2. Compare a streaming task, a background task, and a workspace entry in the same status →
   they use the same symbol+color. Evidence: _to fill after implementation._
