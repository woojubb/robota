# CLI TUI Background Work Tree Display

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

- [ ] Running background jobs are shown as a stable one-level tree.
- [ ] Completed/failed/timeout rows use the shared visual grammar.
- [ ] Latest output is trimmed consistently and does not push other UI off-screen.
- [ ] Persisted session history and live display use the same formatter where possible.
- [ ] Unit tests cover running, completed, failed, timeout, long output, and empty-output cases.

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-cli-tui-background-work-tree-display.md`.
2. Implement after the visual grammar audit establishes shared markers and spacing.
