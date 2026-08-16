---
name: issue-to-backlog
description: Convert a filed GitHub issue into the backlog Task document(s) it actually is — deciding how many items its contents are, not assuming one. Use when a session picks up an issue to work on, before any code changes. The counterpart to find-to-issue, which files at a different time for a different reason.
---

# Issue → Backlog

An issue is a capture. A Task is a unit of work. **They are not the same shape, and one issue is not
automatically one Task.**

## Rule Anchor

- [`.agents/tasks/README.md`](../../tasks/README.md) — required frontmatter, Test Plan, scenarios,
  and the done gate.
- [finding-depth.md](../../rules/finding-depth.md) — owns "is this one item or several".
- [user-request-gate](../user-request-gate/SKILL.md) — the conversion IS the gate step for the issue.

## The judgement that makes this a skill

**Group the issue's contents by CAUSE, not by the count of things it lists.** An issue naming eight
deliverables may be four causes, or one. Splitting by artifact count produces items that cannot be
verified independently; splitting by cause produces items that can.

The cost of getting this wrong is measured, not hypothetical: an item in this repository grew from 3
packages to 13 across twelve review rounds because each verified finding was absorbed into it rather
than routed to its owner. Every expansion was individually justified. The aggregate was still the
wrong unit of work, and nothing in the loop was responsible for noticing.

**Read the issue for the groupings it already makes.** An author who wrote "both of these are the same
root error" or "two skills, because they run at different times" has done part of this work for you.

## Procedure

1. **Read the issue in full**, including its constraints — those become the Task's, not prose to
   summarize away.
2. **Survey what already exists** before writing. A skill, rule or scan the issue asks for may be
   present under another name, or its subject may already be filed. Record what you find in the Task;
   the next session should not re-derive it.
3. **Group by cause.** Say how many items the issue's contents are, and why. Dispatch
   `finding-depth-triager` if the grouping is not obvious.
4. **Write the Task(s)** per the README schema. For several children, add a parent `AGREEMENT` Task
   **and its paired spec-doc** — `task-archival` fails an AGREEMENT with no spec.
5. **Cite the issue** in each Task, and record any finding the conversion itself produced.
6. **Verify**: `task-lifecycle.mjs classify` returns `open` for each, and `pnpm harness:scan` is green.

## Do not

- **Do not close the issue on conversion.** It closes when the work lands, not when it is filed.
- **Do not start the work in the same change.** The conversion is the gate; walking through it is the
  next step, not this one.
- **Do not carry the issue's structure into the Task** if that structure is a list of deliverables
  rather than a statement of causes.
