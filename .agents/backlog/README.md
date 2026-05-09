# Backlog

Future work items and ideas that are not yet scheduled as active tasks.
Active tasks live in `.agents/tasks/`. Completed tasks are archived to `.agents/tasks/completed/`.

## Process

1. Add ideas here as `<topic>.md` files.
2. When prioritized, move to `.agents/tasks/` and update status.
3. When done, archive to `.agents/tasks/completed/`.

## Backlog Entry Requirements

Backlogs that change user-visible behavior, command behavior, workflow behavior, or documentation
for such behavior must include both:

- `## Test Plan`: the agent's engineering verification plan, such as unit, integration, harness,
  build, and CI checks.
- `## User Test Scenarios`: concrete scenarios with prerequisites, exact command lines or UI steps,
  expected observable results, cleanup/reset steps, and the agent-executed evidence required for the
  gate.

The user scenario gate is checked separately from the engineering test plan before the backlog is
declared complete. Static review is not enough when a command, browser flow, TUI flow, local script,
or other workspace-available check can reasonably be executed. Captured evidence is mandatory:
without command output, exit code, screenshot, log excerpt, diff, or another concrete artifact, the
user scenario gate does not pass.

## Items

- [Transparent Repo-Agnostic Workflow Client Planning](cli-ai-workflow-reviewer-harness-planning.md)
