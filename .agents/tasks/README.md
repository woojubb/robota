# Tasks

A **Task** is the record of one unit of work: the problem, why it is not being solved elsewhere, the
directions considered, and what would make it done. Open Tasks live here; finished ones are archived
to `completed/`.

## The name, and what it replaced

This tree was `.agents/backlog/` until PROC-006. Two things were wrong with that name. `backlog` is a
**queue**, and these documents are not queued work — they are the record of a unit of work, often
with no direction chosen yet. And `backlog` was simultaneously a _lifecycle folder name_ under
`.agents/spec-docs/`, so one word named two different things in two systems.

## What this tree is NOT

- **Not `.agents/spec-docs/`.** A spec-doc is a _plan_ under a gate pipeline: prior art,
  alternatives, a decision, TC-numbered completion criteria, a test plan. A Task is the _problem
  statement_, which is what exists before any of that is knowable. The two pair by design — problem
  here, plan there, one ID across both (111 such pairs at the time of the move). See
  [finding-depth.md](../rules/finding-depth.md) § "Where a root item lives", which owns this
  distinction.
- **Not `.agents/archive/task-breakdowns/`.** That holds 422 archived documents of a THIRD, older
  kind: work breakdowns with checkbox plans and no frontmatter. They already lived under
  `.agents/tasks/` when PROC-006 moved the Task tree in, and they collide with 102 Task IDs — so they
  were moved OUT rather than merged. They are a retired artefact kind, not old Tasks, and keeping
  them inside this tree made two scans start judging them the moment the move happened.

## Process

1. Create a new `.md` file in this directory with the required frontmatter (see File Format below).
2. Set `status: todo` (not yet started) or `status: in-progress` (underway) in frontmatter.
3. When implementation is complete and all gates pass (see
   [backlog-execution.md](../rules/backlog-execution.md)):
   - Update `status: done` and add `completed: YYYY-MM-DD` in frontmatter.
   - Use `git mv` to move the file from this directory to `completed/`.
   - Include the status update and the move in the same commit — do not split them.
4. For items that will not be implemented, set `status: wontfix` or `status: skipped` in
   frontmatter, then move to `completed/` in the same commit.

**Never** move a file to `completed/` without first updating `status` in its frontmatter.
**Never** set `status: done` before the User Execution Test Scenario gate passes (if applicable).

## File Format

Every Task file **must** use YAML frontmatter for all metadata fields. The following fields are
required at the top of each file:

```markdown
---
title: '<ID>: <short description>'
status: todo | in-progress | done | wontfix | skipped | superseded
created: YYYY-MM-DD
completed: YYYY-MM-DD # required when status is done/wontfix/skipped/superseded
priority: critical | high | medium | low
urgency: now | soon | later | someday
area: <affected packages or apps>
depends_on: [] # list of blocking Task IDs, empty if none
---
```

The `status` field in frontmatter is the **single source of truth**. Do not write status
information anywhere in the body — body sections such as `## Status` are banned. Grep-based
tooling and harness scripts rely exclusively on frontmatter for status tracking.

## Task Requirements

Tasks that change runnable user-facing behavior, command behavior, TUI/browser behavior, or
workflow behavior must include both:

- `## Test Plan`: the agent's engineering verification plan, such as unit, integration, harness,
  build, and CI checks.
- `## User Execution Test Scenarios`: concrete product-surface scenarios with prerequisites, exact
  command lines or UI steps, required test environment setup, expected observable results,
  cleanup/reset steps, and an evidence field that must be filled after implementation.

The user execution test scenario gate is checked separately from the engineering test plan before
the Task is declared complete. The planned scenario must be written before implementation starts,
but the gate itself is run after implementation against the completed code path or delivered
artifact. For code-changing Tasks, reviewing Task text, documentation text, or static prose is
not a valid user execution test scenario gate.

A user execution test scenario is what the user can personally execute to see the product change
working. It must use a product surface: the Robota CLI command or local equivalent that invokes the
same product binary, Robota TUI actions, Robota browser UI flows, or public SDK/example usage for
SDK-only features. For `agent-cli` and command-package Tasks, prefer a Robota CLI or TUI action.
`rg`, harness commands, unit tests, source inspection, CI checks, and other internal repository
checks belong in `## Test Plan`, not `## User Execution Test Scenarios`.

Documentation-only, rule-only, skill-only, Task-only, or governance-only changes that do not
deliver runnable user-facing behavior must not invent a user execution test scenario. Record
`Not applicable` with the reason, and keep document/rule/static checks in `## Test Plan` or a
verification evidence section. If documentation changes describe a user procedure, the user
execution test scenario must execute the procedure itself; it must not inspect the document to prove
the document is well written.

If the scenario needs a fixture, test project, local server, seed data, or demo command, the Task
must state whether that environment already exists, will be built by the work, or requires a user
decision. A scenario that the user cannot realistically run after completion is not acceptable.

After implementation, the agent must run the scenario when executable, compare the observed result
with the expected observable result, and update the Task with the captured evidence. Without
command output, exit code, screenshot, log excerpt, diff, or another concrete artifact recorded in
the Task, the user execution test scenario gate does not pass.

**Done gate (enforced).** A Task with a `## User Execution Test Scenarios` section must not
have its status set to `done` until: (1) the scenario was executed, (2) concrete evidence was
recorded in the Task file, and (3) the observed result matched the expected observable result.
Setting `status: done` without meeting all three conditions is a process violation. Full rule
definition and stop conditions are in
[`.agents/rules/backlog-execution.md`](../rules/backlog-execution.md).

## Items

The Task files themselves are the single source of truth — there is no inline ledger here
(a duplicated list goes stale and violates the archive policy above).

- **Current items:** the `.md` files in this directory (`ls .agents/tasks/*.md`). Each file's
  frontmatter (`status`, `priority`, `urgency`, `depends_on`) is authoritative.
- **Completed items:** archived in [`completed/`](completed/) with `status: done` (or
  `wontfix`/`skipped`/`superseded`) set in frontmatter.
- **Execution process and gates:** see
  [`.agents/rules/backlog-execution.md`](../rules/backlog-execution.md).
