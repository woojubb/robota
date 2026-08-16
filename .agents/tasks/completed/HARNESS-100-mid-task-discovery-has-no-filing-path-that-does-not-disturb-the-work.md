---
title: 'HARNESS-100: a defect found mid-task has no filing path that leaves the work in flight undisturbed — writing a backlog file inline interrupts it, and dropping the finding loses it, so the repo has no owned answer for the most common moment a defect is discovered'
status: done
created: 2026-08-16
completed: 2026-08-16
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

## Delivered (2026-08-16)

**Two skills, because they run at different times for different reasons (the issue's own reason):**

- `.agents/skills/find-to-issue/SKILL.md` — the mid-task path. Carries the anti-drop-box bar (fix now
  if it is inside your own diff; file if fixing would widen the work; neither if you cannot say what
  you observed), and states that **filing is not authorization** — an issue is not the backlog draft
  `user-request-gate` requires.
- `.agents/skills/issue-to-backlog/SKILL.md` — the pickup path. Its load-bearing instruction is to
  **group the issue's contents by CAUSE, not by the count of things it lists**, with the measured cost
  of getting it wrong.

**Both route the depth question to `finding-depth.md` rather than answering it**, so "is this the
current item's or its own root?" keeps one owner.

**Mechanism terminal state: INFEASIBLE-NOW for the find half, with the obstacle written.** "Did the
agent file an issue instead of dropping the finding?" is not observable from the tree — the dropped
finding leaves no artifact, so there is nothing for a check to read. This is the honest terminal state
that `lesson-to-harness` step 8 permits, and it is recorded here rather than left silent. The tracked
item is this Task, which stays open for it.

**The pickup half is verifiable and was verified:** a converted Task must satisfy
`task-lifecycle.mjs classify` and `backlog-placement`, and for an AGREEMENT parent, `task-archival`
requires exactly one paired spec-doc.

**Worked example, which is this Task's own provenance:** issue #1763 → AGREEMENT-003 plus four
children, including the judgement that the issue's eight named skills are four causes. The conversion
surfaced two findings a later session would otherwise have re-derived — the `contract-audit` name
collision and the already-filed mirror at #1765 — and both were recorded in the parent rather than
discovered twice.

## Closed

Both skills delivered and on `main`.

**The unmechanized half is now HARNESS-102.** This item's terminal state was `infeasible-now`, which
`lesson-to-harness` step 8 permits only with a written obstacle **plus a tracked item** — and it
pointed at itself, which is not one. HARNESS-102 is that item, and it carries the obstacle: a finding
that was noticed and dropped leaves no artifact, so the failure state is an absence and there is
nothing for a check to read.
