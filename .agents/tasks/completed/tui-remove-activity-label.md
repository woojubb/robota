# TUI Remove Activity Label

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: fix/tui-status-activity-label
- **Scope**: packages/agent-cli

## Objective

Remove the visible `Activity:` prefix from the CLI status bar while preserving existing activity text,
colors, and status-line behavior.

## Plan

- [x] Update status bar tests to assert activity text without the prefix.
- [x] Remove the renderer-owned `Activity:` prefix from `StatusBar`.
- [x] Update CLI docs/spec examples that show the prefix.
- [x] Run targeted CLI verification.
- [x] Move backlog/task records to completed.

## Progress

### 2026-05-05

- Started from develop on `fix/tui-status-activity-label`.
- Removed the status bar `Activity:` prefix in the renderer and updated tests/docs.
- Verified status bar tests, CLI typecheck, CLI lint, CLI build, spec scan, and docs build.

## Decisions

- Keep `status-activity.ts` unchanged because it owns activity labels such as `Idle`, `Thinking`,
  and `Tools xN`; the removable prefix is only in the renderer.

## Blockers

- None.

## Result

Completed. The status bar now renders compact activity text (`Idle`, `Thinking`, `Tools xN`, etc.)
without a separate `Activity:` field prefix.
