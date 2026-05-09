# Background Work State Management for agent-cli

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - baseline transparency feature for switching between main conversation, shell jobs, and agent
tasks.

## Request

Design and implement transparent background work state management for `agent-cli`.

The TUI should let the user enter a background-work view where the main thread, shell work, and
agent tasks appear as a switchable list. The selected item should use a filled indicator and
unselected items should use an empty indicator. Selecting an item should switch to its current
output, progress, or interaction state.

## Non-Negotiable Product Principles

- **Background state must be transparent.** Users must be able to see what exists, where it came
  from, what state it is in, and what actions are available.
- **State ownership belongs below CLI.** `agent-cli` renders the list and controls navigation; SDK
  and runtime own task lifecycle, state transitions, cancellation, and retention.
- **Completed work should remain understandable.** Background entries should be retained long enough
  for the user to inspect terminal result, latest output, and next action, then be explicitly
  archived or cleared.
- **Repo independence remains mandatory.** Background state is local workflow state, not repo schema.

## State Scope

Background entries must support:

- main conversation thread;
- local shell/process jobs;
- agent tasks;
- future skill-spawned agent tasks through the same lower-level task model and registration API.

Each entry should expose:

- id, type, title, origin/source, selected state, lifecycle status;
- cwd or workspace context when applicable;
- elapsed time and start time;
- latest output summary;
- input-needed state;
- cancelability and supported actions;
- terminal result;
- retention/archive/clear state.

## Expected Outcomes

- Users can freely switch between the main conversation, shell jobs, and agent tasks without losing
  track of what is running.
- Background work becomes predictable because every entry has a type, origin, status, selected
  state, latest output, and available actions.
- Completed work remains inspectable long enough to understand what happened, then can be explicitly
  archived or cleared.
- Skill-spawned agent work and ordinary shell work can share the same projection model instead of
  receiving separate CLI-only behavior.
- Skills that spawn agents do not receive a special CLI path; they register task lifecycle through
  the same SDK/runtime layer as every other background task.

## Architecture Ownership Rule

`agent-cli` owns only TUI entry rendering, keyboard navigation, selection indicators, and view
switching.

Lower owners must be established first:

- `agent-runtime`: task lifecycle, event streams, cancellation, terminal states, retention windows,
  and archive/clear state.
- `agent-sdk`: background task projection APIs, selected-task state, and task action contracts.
- `agent-command-*`: user-visible status/switch/cancel/archive commands backed by SDK/runtime
  contracts.

Do not implement task lifecycle, terminal-state rules, retention policy, or agent-task ownership
inside `agent-cli`.

Skills and tools that spawn agent tasks must register those tasks through SDK/runtime contracts.
They must not write directly to CLI UI state or define a separate background-task path.

## Recommended First Slice

Create a design and contract PR before UI work:

1. Define the background task projection model.
2. Define lifecycle states and allowed transitions.
3. Define task actions: select, follow, cancel, archive, clear, and return-to-main.
4. Define retention behavior for completed, failed, and cancelled tasks.
5. Update `agent-runtime`, `agent-sdk`, `agent-command-*`, and `agent-cli` SPEC files.
6. Add focused tests for state transitions and projection stability.

## Acceptance Criteria

- [x] The main thread, shell jobs, and agent tasks share one background task projection model.
- [x] The TUI can render selected and unselected entries without owning lifecycle state.
- [x] Each entry exposes origin, status, latest output, elapsed time, input-needed state,
      cancelability, and terminal result.
- [x] Completed tasks have explicit retention/archive/clear behavior.
- [x] Skill-spawned agent tasks can fit the same model without CLI-specific special cases.
- [x] Skill-spawned agent tasks register through SDK/runtime task contracts, not CLI UI state.

## Test Plan

- Add runtime state machine tests for queued, running, waiting-for-input, completed, failed,
  cancelled, and archived transitions.
- Add runtime tests for cancellation, input-needed state, terminal result retention, archive, and
  clear behavior.
- Add SDK projection tests for main thread, shell process, agent task, and skill-spawned agent task
  entries.
- Add tests proving skill-spawned agent tasks use the same SDK/runtime registration path as other
  agent tasks.
- Add CLI rendering tests for selected and unselected indicators, latest output summary, elapsed
  time, input-needed state, and supported actions.
- Add regression tests proving `agent-cli` does not own lifecycle state or duplicate terminal-state
  rules.

## User Execution Test Scenarios

Not applicable. This backlog produced a background-work state contract document and did not deliver
runnable Robota product behavior. Product-surface scenarios must be added by follow-up
implementation PRs that expose background switching through CLI/TUI/SDK behavior.

## Process Verification Evidence

### Verification: Switchable Background Work Contract Is Documented

- Prerequisites: Run from the repository root.
- Verification commands:

  ```bash
  rg -n "main conversation thread|local shell or process tasks|agent tasks|future skill-spawned|IExecutionWorkspaceEntry|must not decide task completion" .agents/specs/background-work-state.md
  ```

- Expected result: The command prints the supported entry types, current SDK projection
  anchor, future skill-spawned support, and the CLI non-ownership rule for task completion.
- Evidence: Executed as process verification for the contract document. Runtime archive/clear and
  expanded TUI behavior remain follow-up implementation work, where product-surface user execution test scenarios
  must be added.

## Verification Plan

- `pnpm harness:scan`
- Add runtime tests for task state transitions and retention.
- Add SDK contract tests for background task projections.
- Add CLI rendering tests after lower contracts exist.

## Result

Completed by adding `.agents/specs/background-work-state.md` and linking package ownership from
`agent-runtime`, `agent-sdk`, `agent-cli`, `agent-command-background`, `agent-command-agent`, and
`agent-command-skills` SPEC files.

- The contract defines one switchable projection model for main-thread, process, agent, grouped,
  and skill-spawned work.
- Existing SDK/CLI execution workspace capabilities are audited separately from missing archive,
  clear, elapsed, input-needed, and terminal-result projection fields.
- Runtime retention APIs, SDK projection fields, command controls, and CLI rendering tests remain
  follow-up implementation work.
