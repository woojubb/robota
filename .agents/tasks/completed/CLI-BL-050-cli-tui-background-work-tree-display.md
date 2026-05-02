# CLI TUI Background Work Tree Display

- **Status**: completed
- **Created**: 2026-05-02
- **Branch**: feat/cli-background-work-tree-display
- **Scope**: packages/agent-cli

## Priority

P1 — implement after the visual grammar audit, before expanding background orchestration UI.

## What

Redesign background job and agent progress display as a compact one-level tree that clearly separates group title, running/completed/error items, idle time, and latest trimmed output.

## Why

The current background display is functional but reads like raw state. Users need a concise view similar to modern coding assistants: a single activity header, visually aligned child rows, stable status markers, short labels, and optional details. This becomes more important as subagents and background processes run in parallel.

## Research Required

Research documentation and user-facing behavior for:

- Codex CLI interactive TUI progress and subagent display.
- Claude Code task/subagent views, focus mode, and status surfaces.
- Common terminal UI patterns for tree-like activity lists.

Use documentation and product behavior observations only; do not copy source code from other projects.

## Scope

- Define a one-level tree renderer for background job groups:
  - group label: human-readable action name, not raw class/state names;
  - child rows: status marker, agent/process label, age/idle time, trimmed latest output;
  - terminal states: completed, failed, timeout, canceled;
  - no stale completed items after the configured retention policy.
- Keep background orchestration state in SDK/runtime layers.
- Keep TUI rendering in CLI-only components.
- Add tests for pure row formatting and Ink rendering.

## Non-Goals

- Do not change background execution semantics.
- Do not introduce provider-specific labels.
- Do not make the model write tree syntax in assistant text.

## Acceptance Criteria

- [x] Running background jobs are shown as a stable one-level tree.
- [x] Completed/failed/timeout rows use the shared visual grammar.
- [x] Latest output is trimmed consistently and does not push other UI off-screen.
- [x] Live display uses a shared pure row formatter.
- [x] Unit tests cover running, completed, failed, timeout, long output, and empty-output cases.

## Progress

### 2026-05-02

- Researched Codex CLI interactive progress documentation, Claude Code status/subagent status line behavior, and terminal output collapse/tree display patterns.
- Added a pure `formatBackgroundTaskRow` formatter for one-level tree rows.
- Updated `BackgroundTaskPanel` to render `Background work` with tree connectors, compact markers, human-readable labels, metadata segments, and bounded previews.
- Extended background task view models with process exit/signal data so completed non-zero tasks can render as actionable error rows.
- Added focused unit tests for the formatter and updated Ink rendering tests.

## Decisions

- Keep SDK/runtime ownership of background lifecycle state; CLI only formats already-projected view models.
- Hide raw task IDs from the always-visible panel, leaving detailed task inspection to `/background list/read`.
- Use the existing visual grammar markers and colors rather than introducing a new icon set.

## Blockers

- None.

## Result

The background panel now renders compact one-level tree rows that show marker, human-readable task label, idle/terminal metadata, and a trimmed latest preview without exposing raw task IDs in the primary scan path.
