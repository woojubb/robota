# CLI Background Task Switcher

## Status

Backlog.

## Created

2026-05-09

## Priority

P1 - interactive CLI observability and task navigation.

## Depends On

- [SDK Background Task Layering Upgrade](sdk-background-task-layering-upgrade.md)

## Problem

Robota CLI can have multiple execution surfaces alive at the same time: the main conversation
thread, background shell/process tasks, and background agent tasks. Users need a TUI view that makes
those running or recently finished tasks visible and lets them switch between them freely, similar
to changing tabs.

The current desired experience is a dedicated TUI menu that lists the main thread and background
tasks together. Each entry should show a radio-style indicator: an empty circle for inactive entries
and a filled circle for the currently selected entry. Selecting an entry changes the visible task
view so the user can inspect live progress, output, final results, or task status without losing the
main session context.

This backlog is intentionally a CLI/TUI consumption layer. The shared task registry, lifecycle
rules, task read model, main-thread projection, and retention policy must be owned by the SDK/runtime
background management layers first. The CLI should render and navigate SDK-provided task
workspace/view models instead of maintaining a private background-task registry.

## Non-Negotiable CLI Boundary

`agent-cli` may only implement the TUI surface for this feature: layout, terminal input, selection
state, keyboard navigation, and rendering of SDK-provided data.

It must not own background task behavior, task spawning, lifecycle transitions, retention policy,
unread/completed semantics, permission policy, persistence, task grouping, log aggregation, or
transport-visible contracts. If the switcher needs any capability that is not already exposed by
`agent-sdk` or a lower reusable layer, this CLI backlog must pause and the missing SDK/runtime
capability must be added first.

## Target Experience

- Provide a TUI entry point for the background task switcher. The exact trigger is not decided yet:
  it could be a slash command, keyboard shortcut, command palette item, or a combination.
- Include the main conversation thread as a first-class entry in the switcher list.
- Include background shell/process tasks and background agent tasks in the same list with clear task
  kind, status, title/summary, and recency information.
- Render the selected entry with a filled radio indicator and all other entries with an empty radio
  indicator. Provide a terminal-safe fallback if circle glyphs are unreliable.
- Let users move selection and switch the visible task pane while tasks continue running.
- Show live output or progress for the selected background task, including incremental shell output,
  agent progress, tool activity, completion state, and final result when available.
- Keep switching as a view-level action. It must not pause, resume, cancel, or otherwise mutate task
  execution unless the user invokes an explicit task control.
- Keep the main thread easy to return to from the same switcher.
- Consume SDK-owned task workspace/read-model APIs for entries, selected-entry detail data, live
  updates, and available task controls.

## Research Required

Before implementation, run online research on how well-known AI assistant CLIs and coding assistants
manage concurrent work, background agents, tool output, task lists, and view switching.

Research targets should include at least:

- Claude Code
- OpenAI Codex CLI
- Gemini CLI
- Other relevant terminal or coding assistants if they have visible concurrent-task UX

The research output should summarize:

- How each assistant represents the main thread versus background work.
- Whether background work remains visible after completion, and for how long.
- How users switch focus between task views.
- How live output, final results, errors, and unread/completed state are shown.
- What controls are exposed for cancel, close, follow, open logs, or send follow-up input.
- Which patterns should be copied, adapted, or avoided for Robota.

## Open Decisions

- Whether completed background tasks stay in the list until explicitly closed, disappear after a
  timeout, collapse into a history section, or remain available for the session only. The final
  policy should come from the SDK background task layering backlog, not from CLI-only state.
- Whether the switcher is modal, a side panel, an inline picker above the input, or a full-screen
  task view.
- Whether the active task view should replace the transcript pane, split the screen, or render a
  focused detail pane while preserving recent main-thread context.
- Whether shell task stdin and agent follow-up prompts are supported directly from the selected
  task view or exposed through separate controls.
- Whether unread/completed/error indicators are needed beyond the radio-style selected marker.
- Whether task ordering is by creation time, recent activity, status, or manual pinning.

## Non-Goals

- Do not redesign the background task lifecycle contract as part of the first UI slice.
- Do not create a CLI-only background task registry, lifecycle model, or retention policy.
- Do not add new feature behavior in `agent-cli`; add it to `agent-sdk`, command packages,
  `agent-runtime`, or other lower reusable layers first.
- Do not make view switching imply task cancellation, pausing, or foreground promotion.
- Do not make shell-specific behavior leak into agent task rendering, or agent-specific behavior
  leak into shell task rendering.
- Do not hardcode provider-specific task behavior in the TUI.

## Acceptance Criteria

- [ ] The SDK background task layering upgrade is complete and exposes the read model this UI
      consumes.
- [ ] A research note compares concurrent/background-task UX in well-known AI assistant CLIs and
      recommends a Robota approach.
- [ ] The TUI switcher can list the main thread plus background shell and agent tasks.
- [ ] The selected entry is rendered with a filled radio indicator and inactive entries with empty
      radio indicators or an approved terminal-safe fallback.
- [ ] Selecting an entry switches the visible task detail/progress view without mutating task
      execution.
- [ ] Running tasks update live while selected.
- [ ] Completed, failed, and cancelled tasks have clear states and an explicit retention policy.
- [ ] The user can return to the main conversation thread from the switcher.
- [ ] Tests cover task list projection, selected-entry rendering, keyboard/navigation behavior, and
      live update projection for shell and agent tasks.
- [ ] No React component infers lifecycle or retention from raw background events when an SDK
      projection API exists.
- [ ] All non-UI behavior used by the switcher is covered by SDK/runtime/command-layer tests before
      CLI rendering tests assert it.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli build`
- `pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop --skip-record-check`
- Add focused unit tests for the pure selection/view model logic before TUI component tests.

## Promotion Path

1. Complete
   [`SDK Background Task Layering Upgrade`](sdk-background-task-layering-upgrade.md).
2. Complete online UX research and record the recommended approach.
3. Promote this backlog to `.agents/tasks/CLI-BL-0XX-background-task-switcher.md`.
4. Update `packages/agent-cli/docs/SPEC.md` before implementation if the task changes TUI contracts.
5. Implement pure task-switcher selection/navigation logic against SDK-provided view models, then
   wire the Ink TUI.
6. Add regression tests for shell task, agent task, completed task, and main-thread selection paths.
