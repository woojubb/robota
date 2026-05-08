# CLI Background Task Switcher

## Status

Completed.

## Created

2026-05-09

## Branch

feat/cli-background-task-switcher

## Scope

packages/agent-cli, .agents/tasks, .agents/backlog, .agents/specs/architecture-map

## Priority

P1 - interactive CLI observability and task navigation.

## Depends On

- [SDK Background Task Layering Upgrade](SDK-BL-008-background-task-layering-upgrade.md)

## Recommendation

Implement this as a CLI-only TUI slice over the SDK execution workspace projection.

Reason: prior art converges on subagents/background work as independently tracked execution contexts,
but Robota's architecture requires that lifecycle, grouping, retention, origin metadata, and task
detail reads stay in `agent-sdk`/`agent-runtime`. The CLI should therefore add only a terminal
switcher menu, keyboard navigation, ephemeral selected-entry state, and rendering of SDK-owned
workspace entries/detail pages.

## Prior Art Research

References consulted:

- OpenAI Codex subagents documentation: Codex can spawn specialized agents in parallel, surfaces
  subagent activity in app/CLI, orchestrates spawning/waiting/follow-up/closing, and returns a
  consolidated response after requested results are available.
- Claude Code subagents documentation: subagents run in independent context windows with separate
  tool access and permissions; Claude recommends them for high-volume output, parallel research, and
  self-contained work that returns summaries to the main conversation.
- Gemini CLI subagents documentation: subagents operate inside the main CLI session as specialized
  tools with independent context loops, isolated tools, policy controls, and interactive `/agents`
  management.

Observed pattern:

- Main-thread conversation remains the primary context; subagents/background work are separate
  execution contexts that report back or can be managed from an interactive surface.
- Parallel work should be visible without merging raw logs into the main transcript by default.
- Tool access, permission policy, lifecycle, and context isolation are lower-level execution
  contracts, not terminal-rendering concerns.
- UI surfaces should show enough status/progress to choose a task, while explicit controls handle
  cancellation, closing, waiting, or follow-up input.

Robota decision:

- Use the SDK execution workspace as the single read model for main-thread, background task, and
  group entries.
- Render a radio-style selector in the CLI with `●` for the currently selected entry and `○` for
  inactive entries.
- Keep completed/failed/cancelled visibility and collapse behavior from the SDK `visibility` field;
  the CLI may filter default-visible entries but must not invent lifecycle retention.
- Use `InteractiveSession.readExecutionWorkspaceDetail()` for the selected pane instead of reading
  task logs or transcripts directly from React components.

## Plan

- [x] Record research-supported recommendation in the active task.
- [x] Update CLI SPEC and architecture map before implementation.
- [x] Add pure switcher view-model and selection-flow tests.
- [x] Render the execution workspace switcher menu and selected detail pane.
- [x] Wire `useInteractiveSession` to SDK workspace snapshots/events/detail reads.
- [x] Run affected CLI verification.

## Progress

### 2026-05-09

- Promoted from backlog after SDK execution workspace PR #310 merged.
- Chose Ctrl+B as the first TUI entry point because it is terminal-local navigation state and does
  not require adding a new SDK/command behavior.
- Updated CLI SPEC and architecture map to make the SDK execution workspace the only source of
  task lifecycle, retention, grouping, and detail data.
- Added the Ctrl+B execution workspace switcher, main-thread/background entry selection, and
  selected-entry detail pane backed by `InteractiveSession.readExecutionWorkspaceDetail()`.
- Removed the previous CLI-private raw `background_task_event` projection so React components render
  SDK workspace snapshots instead of owning lifecycle policy.
- Verified focused switcher tests, agent-cli typecheck, lint, full test suite, package build, and
  scoped harness verification.

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

- Provide a Ctrl+B TUI entry point for the background task switcher.
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

## Decisions

- Completed, failed, and cancelled task retention follows the SDK `visibility` field.
- The first switcher surface is a Ctrl+B modal-style TUI panel above the normal prompt area.
- Selecting a non-main entry replaces the transcript pane with an SDK detail pane; selecting the
  main thread restores the normal `MessageList`.
- Shell stdin, agent follow-up prompts, cancel, close, wait, and log-read controls stay in
  SDK/command-layer APIs rather than becoming implicit switcher behavior.
- Unread, failed, permission, and completed state are rendered from SDK status/attention metadata in
  addition to the selected-entry radio marker.
- Task ordering follows the SDK snapshot order; the CLI does not sort by a private policy.

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

- [x] The SDK background task layering upgrade is complete and exposes the read model this UI
      consumes.
- [x] A research note compares concurrent/background-task UX in well-known AI assistant CLIs and
      recommends a Robota approach.
- [x] The TUI switcher can list the main thread plus background shell and agent tasks.
- [x] The selected entry is rendered with a filled radio indicator and inactive entries with empty
      radio indicators or an approved terminal-safe fallback.
- [x] Selecting an entry switches the visible task detail/progress view without mutating task
      execution.
- [x] Running tasks update live while selected.
- [x] Completed, failed, and cancelled tasks have clear states and an explicit retention policy.
- [x] The user can return to the main conversation thread from the switcher.
- [x] Tests cover task list projection, selected-entry rendering, keyboard/navigation behavior, and
      live update projection for shell and agent tasks.
- [x] No React component infers lifecycle or retention from raw background events when an SDK
      projection API exists.
- [x] All non-UI behavior used by the switcher is covered by SDK/runtime/command-layer tests before
      CLI rendering tests assert it.

## Test Plan

- `pnpm --filter @robota-sdk/agent-cli test -- --run src/ui/__tests__/tui-state-manager.test.ts src/ui/__tests__/execution-workspace-view-model.test.ts src/ui/__tests__/execution-workspace-switcher.test.tsx src/ui/__tests__/background-task-row-format.test.ts src/ui/__tests__/background-task-panel.test.tsx`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli lint`
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-cli build`
- `pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop --skip-record-check`

## Result

Implemented the first CLI execution workspace switcher slice as a TUI-only view over SDK-provided
workspace snapshots. Ctrl+B opens a radio-style selector containing the main thread and SDK
background entries; Enter switches the visible pane without mutating execution; non-main entries
render detail records through `InteractiveSession.readExecutionWorkspaceDetail()`.

The CLI no longer owns raw background task lifecycle projection for this surface. Background
visibility, retention, grouping, status, attention, and detail pagination remain SDK-owned.

## Promotion Path

1. Complete
   [`SDK Background Task Layering Upgrade`](SDK-BL-008-background-task-layering-upgrade.md).
2. Complete online UX research and record the recommended approach.
3. Promote this backlog to `.agents/tasks/CLI-BL-0XX-background-task-switcher.md`.
4. Update `packages/agent-cli/docs/SPEC.md` before implementation if the task changes TUI contracts.
5. Implement pure task-switcher selection/navigation logic against SDK-provided view models, then
   wire the Ink TUI.
6. Add regression tests for shell task, agent task, completed task, and main-thread selection paths.
