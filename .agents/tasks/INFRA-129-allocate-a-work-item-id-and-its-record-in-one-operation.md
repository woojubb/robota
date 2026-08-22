---
title: 'INFRA-129: allocate a work-item id and its record in one operation'
issue: https://github.com/woojubb/robota/issues/1916
status: in-progress
created: 2026-08-22
priority: medium
urgency: soon
area: scripts/harness, .agents/tasks
depends_on: []
---

# INFRA-129: allocate a work-item id and its record in one operation

## Objective

A work-item ID is allocated by reading the current highest number and adding one. Nothing owns the
allocation, so the collision is created **between the read and the write** — which is precisely
where no scan can stand. `scan-work-item-id-collision` closes the half a clone can judge offline
(one ID, two tracked records); this closes the half that actually bit.

Option 2 of issue #1916: make the read and the claim the same operation.

## Plan

- [x] Compute the claimed set from records, tree citations, and issue titles.
- [x] Report an unread source explicitly rather than treating it as empty.
- [x] Write the record stub in the same step that takes the number.
- [x] Register as `pnpm harness:task:allocate` and replace the survey step in the tasks README.

## What "claimed" actually means, measured

The record filenames are not the claimed set. On 2026-08-22: **867** IDs have a record file and
**63 more are claimed by a tracked file that is not a record** — a rule citing the item that
introduced it, a scan header, a hook comment, an archived breakdown.

`INFRA-127` is one of the 63. `scan-task-frontmatter-fields.mjs` and `scan-rule-table-shape.mjs`
both cite it, no `.agents/tasks/INFRA-127-*.md` exists, and so `ls .agents/tasks | grep INFRA`
reported `INFRA-126` as the highest. The sibling task INFRA-128 was numbered 127 on that reading and
renumbered by hand. This item exists because that happened while its own sibling was being written.

## Why counting up, and why not into the 900s

The next ID is one above the highest claimed number, never the lowest free one. A gap is usually a
number claimed by something the tool cannot see — an unpushed branch, an issue not yet opened — and
handing it out is the same collision with more confidence behind it.

The first run of the script returned `INFRA-1000`, because `INFRA-999` is a fixture in the collision
scan's own test. Measured before fixing it: of the 867 IDs with a record file, **zero** are at or
above 900, and all 18 citations that are, are either fixtures or not work-item IDs at all
(`CVE-2024`, `ISO-8601`, `RFC-7807`). So `SENTINEL_FLOOR = 900` is a measurement, not a convention.

## `null` is not an empty set

`idsFromIssueTitles` returns `null` when the source could not be read, and the run prints that it
allocated from a smaller set than the one that matters. The three collisions issue #1916 opens with
were all between a record and an issue title, so a run that silently skipped that source would be
green in exactly the case it was built for.

## Two defects the tool found in itself

- **`INFRA-1000`**, above.
- **`--issue 1916` put `1916` in the slug.** Filtering arguments on a leading `--` removes the flag
  and leaves its value behind, so the number became part of the title. Found by running the script
  on this record — the file was first written as
  `INFRA-129-…-in-one-operation-1916.md`. Both are pinned as cases.

## What this does not close

Two sessions can still allocate the same number in the same minute: each reads a set that does not
yet contain the other's unpushed record. The window is now the push interval rather than the
authoring interval, and `scan-work-item-id-collision` refuses the second one at pre-push. Removing
the class rather than guarding it is option 3 of the issue — non-sequential IDs — and is not
attempted here.
