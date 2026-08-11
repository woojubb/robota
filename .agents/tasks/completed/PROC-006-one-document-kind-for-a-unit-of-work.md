---
title: 'PROC-006: two tracking systems, two lifecycles, one job — unify them and name the result for what it is'
status: done
completed: 2026-08-01
priority: high
urgency: soon
type: PROC
area: .agents
created: 2026-08-01
depends_on: [PROC-004]
issue: https://github.com/woojubb/robota/issues/1550
---

# PROC-006 — `.agents/tasks/` and `.agents/spec-docs/` do the same job under two names

## Problem

The repository tracks a unit of work in two places with two lifecycles, and the overlap is not a
subtlety — **both use `backlog` as a state**:

- `.agents/tasks/` — `status: todo | in-progress | done | wontfix | skipped | superseded`, with
  completed items moved to `completed/`.
- `.agents/spec-docs/` — `draft / backlog / todo / active / done / rejected` folders.

Measured 2026-08-01: **66 open backlog items, 722 archived, 242 spec-docs — 1,030 documents**, and
**336 files reference one of the two paths** (rules, skills, scans, hooks, agent definitions,
workflows). Several scans read one and not the other; `check-task-archival` reads a third tree
(`.agents/tasks/`) that now contains one README and 422 archived files, and examines **zero**.

An author deciding where to put a new item has to know a distinction nothing states, and every gate
written for one of the two is blind to the other.

## The naming half

`backlog` also describes the wrong thing. What these documents contain is a measured problem, why it
is not being fixed elsewhere, the directions considered — often with none chosen — and the acceptance
criteria. A backlog is a QUEUE; this is the record of a unit of work.

Owner direction (2026-08-01): rename to something plainer than "backlog", and simpler than a
methodology term. Candidates weighed against collisions **inside this repository**:

| Candidate                       | Why                                                                                                                | Collision                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Work Item** (`.agents/work/`) | the repo's own phrase — `backlog-execution-orchestrator` already says "one item or one named **work unit** per PR" | none                                                                                          |
| Job                             | short, plain                                                                                                       | `.github/workflows/*.yml` `jobs:`, and every rule that says "required jobs" / "the scans job" |
| Task                            | plainest                                                                                                           | `.agents/tasks/` exists, with 422 archived files under it                                     |
| Change Record                   | standard, stage-friendly                                                                                           | none, but abstract                                                                            |

**Decided (owner, 2026-08-01): `Task`.**

The collision this table raised is resolved by the decision rather than left standing. `.agents/tasks/`
today holds one README and 422 archived files, and its scan examines ZERO live documents
([HARNESS-063](HARNESS-063-scans-that-examine-nothing.md)) — the tree was already awaiting a verdict
of "revive with a stated purpose, or retire with its scan". Naming the unit of work a Task is that
verdict: the tree is revived, and it becomes the one home.

Two things that follow, and must be decided here rather than discovered during the move:

- The existing archive uses a different shape — a `Status:` line and checkbox plans, alongside a
  second "Task Breakdown" form that `check-task-archival` was written to understand BOTH of. Merging
  1,030 documents into a tree that already carries two formats makes three. The archive either
  migrates to the new shape or sits under a clearly-named subtree that the live scan does not read.
- `jobs` and `task` both appear in CI vocabulary. `jobs:` is structural in the workflow files and was
  the reason that candidate was rejected; `task` appears only in prose, which is why this one is
  affordable. Worth stating so the next reader does not re-litigate it.

## Why this is filed rather than done inline

1,030 documents and 336 referencing files. A rename that misses a reference leaves a rule pointing at
a path that does not exist — and the scans that read these trees are the ones that would go quiet
rather than fail, because most of them resolve a directory and report what they found.

The order matters too: PROC-004 asks whether GitHub Issues become the tracker at all. Unifying two
in-repo systems and then moving state out of them would be two migrations where one might do.

## Done when

- One document kind for a unit of work, one lifecycle, one directory.
- Every rule, skill, scan, hook and workflow that referenced either path resolves — proven by the
  scans passing, not by grep alone, since a scan reading an absent tree is the failure mode.
- `.agents/tasks/` is revived as the single home, its archive's format question settled, and
  `check-task-archival` reads a tree that is no longer empty.
- The chosen name appears in AGENTS.md's document tree, and no document calls the same thing by the
  old name.

## Completion (2026-08-01)

Resolved by PR #1586. `.agents/backlog/` is gone, `.agents/tasks/` holds the open Tasks and the archive, and nothing in the repository resolves the old path. What was NOT done, and why, is recorded on the issue.

Reconciled 2026-08-04: the work had landed and the issue was closed with its evidence, but the Task
file was never moved. Verified against the tree before moving, not taken from the closed issue.
