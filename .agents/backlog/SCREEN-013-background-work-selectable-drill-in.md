---
title: 'SCREEN-013: No way to select or enter a background task from the TUI'
status: done
created: 2026-06-30
priority: high
urgency: soon
area: packages/agent-transport-tui
depends_on: []
---

# Background tasks are not reachable from the TUI

The execution-workspace drill-in was built — `ExecutionWorkspaceSwitcher` (select an entry),
`ExecutionWorkspaceDetailPane` (inspect it), `selectExecutionWorkspaceEntry` /
`readExecutionWorkspaceDetail` all exist — but from the running TUI there is **no discoverable way to
get there**. The inline "Background work" panel is static text (not navigable), and the only entry
point, `Ctrl+B`, is not advertised anywhere in the main UI. In practice a user sees background work
listed but cannot select or enter any of it.

## What

Make the intended drill-in actually reachable:

1. **Discoverable entry point** — surface a `Ctrl+B  background work` hint in the main footer/affordance
   line so users know the switcher exists (the switcher already shows its own `↑↓ / Enter / Esc` help
   once open).
2. **Verify the path end-to-end** — `Ctrl+B` opens the switcher, `↑↓` moves the selection, `Enter`
   selects an entry, and the `ExecutionWorkspaceDetailPane` shows that task's detail
   (`readExecutionWorkspaceDetail`). Fix any broken wiring found.
3. (If low-risk) allow opening the switcher focused on the first background task when there is at
   least one, so `Ctrl+B` → `Enter` drills straight in.

Use the same stable order as SCREEN-010 so the switcher selection is predictable.

## Test Plan

- Component/interaction test (ink-testing-library or the existing TUI test harness): `Ctrl+B` opens
  the switcher; the footer hint is present when background work exists; selecting an entry routes to
  the detail pane and triggers `readExecutionWorkspaceDetail`.
- typecheck / lint / `pnpm --filter @robota-sdk/agent-transport-tui test` green.

## User Execution Test Scenarios

- Prereq: built CLI; a session with ≥1 running background agent.
- Steps: run `robota`, spawn a background agent, note the footer hint, press `Ctrl+B`, use `↑↓` to
  highlight the task, press `Enter`.
- Expected: a footer hint advertises background work; `Ctrl+B` opens the switcher listing the task;
  `Enter` opens its detail view showing the task's status/output; `Esc` returns to the main thread.
- Evidence: Engineering — `background-task-panel.test.tsx` › "advertises the Ctrl+B drill-in
  (SCREEN-013)" passes: the panel renders the `Ctrl+B` hint. The `Ctrl+B` handler + switcher +
  `ExecutionWorkspaceDetailPane` already exist and are wired in `App.tsx`.
- Evidence (LIVE, agent-run 2026-07-02): real TUI in a PTY (real Anthropic provider) with 3 live
  background agents. `Ctrl+B` opened the "Execution workspace" switcher listing main thread + A1/A2/A3
  with the `Ctrl+B Close ↑↓ Navigate Enter Switch Esc Close` footer; `↓↓` moved the `>` selection to
  `> ● A1 agent · running…`; `Enter` switched to A1 — the status bar showed `[A1]` and the main pane
  rendered A1's live transcript; `Esc` returned to the prompt. Notably this worked **mid-turn** (while
  the parent turn was still streaming). Scenario executed as written.
