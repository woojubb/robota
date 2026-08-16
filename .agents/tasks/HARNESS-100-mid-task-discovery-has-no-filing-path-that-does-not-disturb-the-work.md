---
title: 'HARNESS-100: a defect found mid-task has no filing path that leaves the work in flight undisturbed — writing a backlog file inline interrupts it, and dropping the finding loses it, so the repo has no owned answer for the most common moment a defect is discovered'
status: todo
created: 2026-08-16
priority: medium
urgency: soon
area: .agents/skills, .agents/rules
depends_on: []
---

# HARNESS-100: find→issue and issue→backlog

Converted from [issue #1763](https://github.com/woojubb/robota/issues/1763) (owner directives,
2026-08-16 session), items **7 / 8**.

## Problem

A defect or follow-up is most often discovered **in the middle of other work**. The repo's filing
machinery assumes the opposite: `.agents/tasks/` files are written deliberately, and
`user-request-gate` gates code behind a backlog draft. Applied mid-task, that means stopping to author
a Task document — which disturbs the work in flight — and the practical alternative is dropping the
finding.

The owner directive states the split:

> When a defect or follow-up is discovered mid-task, file a GitHub **issue** and keep going —
> creating a backlog file inline disturbs the work in flight. When a later session picks the issue up,
> convert issue → backlog then. **Two skills, because they run at different times for different
> reasons.**

Issue #1763 is itself an instance: it was filed as an issue precisely so the session that produced it
could continue, and it says so in its first line.

## Direction

**find→issue** — the mid-task path. Cheap, non-interrupting, and it must capture enough that the later
session does not have to re-derive the finding: what was observed, where, and why it was not fixed
inline. Its own risk is becoming a drop-box for anything inconvenient, so it needs a stated bar for
what is issue-worthy versus fix-now.

**issue→backlog** — the pickup path. Converts a filed issue into a Task document with the frontmatter,
Test Plan and scenario sections the Task README requires. **This item's own creation is the worked
example**: issue #1763 → this Task and its three siblings, including the judgement of how many items
the issue's contents actually are.

Two interactions to design against rather than discover later:

- **`user-request-gate`** gates code behind a backlog draft. find→issue must not become a way around
  that gate — filing an issue is not authorization to change code.
- **`finding-depth.md`** owns whether a finding belongs to the current item or is its own root item.
  find→issue should route that question there rather than answering it, or it becomes a second place
  the same judgement is made — the defect this session already paid for once.

## Mechanism (required — see `lesson-to-harness` step 8)

Weaker mechanical leverage than the sibling items, and that should be stated plainly rather than
papered over: "did the agent file an issue instead of dropping the finding?" is not observable from
the tree. What _is_ checkable:

- An issue converted to a Task carries the issue reference, and the Task's frontmatter validates
  (`task-lifecycle.mjs classify`).
- The `task-tracking` hook already surfaces open issues at session start — the pickup path can be
  anchored there rather than relying on memory.

**Infeasible-now for the find half is a likely and permitted terminal state — but only with the
written concrete obstacle plus a tracked item**, per `lesson-to-harness` step 8. Silence is not.

## Test Plan

- The conversion path is exercised end to end on a real issue and the resulting Task passes
  `task-lifecycle.mjs classify` and `backlog-placement`.
- Prove-it-fails (step 9) for whichever half is mechanized; for the half that is not, record the
  obstacle and the tracked item.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — process change with no runnable user-facing behaviour. The conversion exercised
under Test Plan is the evidence.
