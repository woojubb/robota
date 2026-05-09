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
- `## User Test Scenarios`: manual user scenarios with prerequisites, user actions, expected
  visible results, cleanup/reset steps, and whether the agent can verify the scenario directly,
  partially, or only by static/manual review.

The user scenario gate is checked separately from the engineering test plan before the backlog is
declared complete.

## Items

- [Transparent Repo-Agnostic Workflow Client Planning](cli-ai-workflow-reviewer-harness-planning.md)
