# CLI TUI Status Activity Indicator

Status: completed
Created: 2026-05-02
Branch: feat/cli-status-activity-indicator
Scope: packages/agent-cli

## Priority

P1 — implement after the visual grammar audit.

## What

Make active thinking/waiting/status indicators more visible by moving or duplicating the current activity state into the left side of the status area or another consistently scanned location.

## Why

The current `Thinking` indicator can be too subtle when placed on the right. Users need an obvious signal when Robota is waiting on the model, running tools, processing background jobs, or idle. The activity indicator should be glanceable without becoming noisy.

## Initial Research Notes

- Claude Code status line documentation supports multi-line, color-coded, event-refreshed status output and notes that background subagent state can matter while the main session is idle.
- Claude Code command documentation includes configurable TUI renderers, suggesting status placement should be renderer-owned and not tied to session semantics.

## Scope

- Audit current `StatusBar` fields and reading order.
- Define left-side activity slots for:
  - thinking/waiting for model;
  - running tools;
  - background jobs active;
  - queued prompt;
  - idle.
- Keep model/session state in SDK and render only derived display state in CLI.
- Add tests for status priority when multiple states are true.

## Non-Goals

- Do not change model execution state semantics.
- Do not create provider-specific status strings.
- Do not add flashing or high-noise animations without accessibility review.

## Acceptance Criteria

- [x] Active model waiting state is visible in the primary scan path.
- [x] Running tool/background states have deterministic priority.
- [x] Status remains readable on narrow terminals.
- [x] Tests cover state priority and width-constrained rendering.

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-cli-tui-status-activity-indicator.md`.
2. Implement after visual grammar audit and before broader fullscreen renderer work.

## Implementation Notes

- Added a pure `formatStatusActivity` helper with deterministic priority:
  active tools, model thinking, active background work, queued prompt, idle.
- Moved the visible activity label into the left side of `StatusBar` before mode/model metadata.
- Kept the TUI as a renderer boundary: `App` derives counts from CLI view state and `StatusBar` renders only display props.

## Verification

- `pnpm --filter @robota-sdk/agent-cli test -- src/ui/__tests__/status-activity.test.ts src/ui/__tests__/status-bar.test.tsx`
