---
title: 'PROC-006: two tracking systems, two lifecycles, one job — unify them and name the result for what it is'
status: todo
priority: high
urgency: soon
type: PROC
area: .agents
created: 2026-08-01
depends_on: [PROC-004]
issue: https://github.com/woojubb/robota/issues/1550
---

# PROC-006 — `.agents/backlog/` and `.agents/spec-docs/` do the same job under two names

## Problem

The repository tracks a unit of work in two places with two lifecycles, and the overlap is not a
subtlety — **both use `backlog` as a state**:

- `.agents/backlog/` — `status: todo | in-progress | done | wontfix | skipped | superseded`, with
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

Recommendation: **Work Item**, because it is the vocabulary the rules already use, so nothing new has
to be learned.

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
- `.agents/tasks/` is either revived with a stated purpose or retired with its scan.
- The chosen name appears in AGENTS.md's document tree, and no document calls the same thing by the
  old name.
