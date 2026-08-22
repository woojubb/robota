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

## GitHub Issue Relationship

A GitHub issue is the externally tracked capture of intent or a problem. A Task is the executable unit
that can pass its own recommendation, verification, and completion gates. One issue may produce one or
several Tasks; one Task may span several packages when those changes solve one cause and have one
independent completion outcome.

Split by cause and independent verification, not by package, file, deliverable, or test count. Keep
implementation-only decomposition inside the Task. Use separate child issues only when the causes need
separate external discussion, priority, ownership, security review, or terminal disposition.

When a Task is converted from a GitHub issue, cite the issue URL in its frontmatter or body. When one
parent issue produces several related Tasks, the parent `AGREEMENT` Task and paired spec-doc own the
shared boundary and child relationship; the `AGREEMENT` is complete only after every declared child is
complete.

## Work-item IDs

An ID is how a commit message, a pull request body, a review comment and a rule section all point at
one record, so **one ID names one item**. `work-item-id-collision` in `pnpm harness:scan` refuses a
push in which two distinct records claim one ID, and it reads only the tracked tree — a clone judges
it offline.

Two things it deliberately does not treat as collisions, and one it cannot see:

- A **phase** of an item — the `-p7-` / `-P4-` segment right after the ID — belongs to its parent.
- Ten IDs are allowlisted in the scan, each with the reason — seven `<PREFIX>-001` from before the
  convention settled, and three (`ARCH-CONF-007`, `ARCH-FIX-020`, `ARCH-FIX-021`) found only when
  the ID pattern was widened to reach multi-segment prefixes like `ARCH-FIX-` and `INFRA-BL-`. They are all in `completed/`, and the merged commits that deliver them name the old
  numbers, so renaming the files would move each record out from under every citation pointing at
  it. The allowlist may not grow: a fresh collision is refused.
- An ID claimed by a record in one clone and by an **issue title** opened by another session is
  invisible to it on its own, because nothing in the tree said which issue registers which record.

**So a NEW record names its issue.** Any of `Registered as … issue #N`, a bare `issue #N`, or the
issue URL — the three spellings already in the tree, so a record that links already does not have to
link again. A pull-request reference is not one: `PR #N` says what delivered the work, not what
registered it. `no-issue: <reason>` on a line opts out, for an item that genuinely has none.

Only records a change ADDS are judged. 711 of 798 existing records carry no citation, most of them
completed and merged; back-filling them means guessing which issue each one meant, and a wrong link
is worse than none — the cross-source check would then read two items as one.

**What this guarantees, stated because the weaker claim is the true one.** A collision becomes
DETECTABLE at push time. It is not PREVENTED: a clone-local branch is invisible in principle to
every mechanism that reads the tracked tree, so two sessions can still both pick the same number and
the second one is caught when it pushes, not when it chooses. And the link is checked when it is
WRITTEN, not continuously — a record can cite an issue that is later closed as a duplicate,
retitled, or transferred, and nothing here re-derives that. Worse, a link can be wrong on the day it
is written, which leaves no signal at all and reads as verified precisely because it is well-formed.

Closing those needs a live read of the issue, which no tracked-tree scan can do — the useful
assertion is not "the link resolves" but "the link resolves AND that issue's title still claims this
record's ID".

## Process

1. Create a new `.md` file in this directory with the required frontmatter (see File Format below).
2. Set `status: todo` (not yet started) or `status: in-progress` (underway) in frontmatter.
3. When implementation is complete and all gates pass (see
   [backlog-execution.md](../rules/backlog-execution.md)):
   - Update `status: done` and add `completed: YYYY-MM-DD` in frontmatter.
   - Use `git mv` to move the file from this directory to `completed/`.
   - Include the status update and the move in the same commit — do not split them.
4. For items that will not be implemented, set `status: wontfix`, `skipped`, or `superseded`, add
   the completion date, then move to `completed/` in the same commit.
5. If another Task declares this Task in `children`, update that initiative Task's `## Children`
   and paired AGREEMENT spec's `## Tasks` rows in the same commit as this lifecycle transition.

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
children: [] # required and non-empty only for a Task paired to a type: AGREEMENT spec
---
```

The `status` field in frontmatter is the **single source of truth**. Do not write status
information anywhere in the body — body sections such as `## Status` are banned. Grep-based
tooling and harness scripts rely exclusively on frontmatter for status tracking.

Open statuses are `todo`, `in-progress`, and `blocked`. Terminal statuses are `done`, `wontfix`,
`skipped`, and `superseded`; every terminal Task requires a real `completed: YYYY-MM-DD` date and
must live under `completed/`. A paired `type: AGREEMENT` Task must declare a non-empty unique
`children` list. Its `## Children` section and the paired spec's `## Tasks` section each contain
exactly one row per child in this form:

```markdown
- [x] CHILD-001 — done — `.agents/tasks/completed/CHILD-001-description.md`
- [ ] CHILD-002 — in-progress — `.agents/tasks/CHILD-002-description.md`
```

The checkbox is checked for every terminal disposition, while the explicit status preserves whether
the child was delivered (`done`) or administratively closed. An AGREEMENT may itself be `done` only
when every declared child is `done`. Its authored Plan and Completion Criteria remain independent
initiative evidence, not child-state projections.

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
  frontmatter (`status`, `priority`, `urgency`, `depends_on`, and when applicable `children`) is authoritative.
- **Completed items:** archived in [`completed/`](completed/) with `status: done` (or
  `wontfix`/`skipped`/`superseded`) set in frontmatter.
- **Execution process and gates:** see
  [`.agents/rules/backlog-execution.md`](../rules/backlog-execution.md).
