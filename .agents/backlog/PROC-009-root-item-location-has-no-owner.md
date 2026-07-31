---
title: 'PROC-009: nothing owns WHERE a root item lives, so the floors that verify one resolve half the space'
status: todo
priority: medium
urgency: soon
type: PROC
area: scripts/harness
created: 2026-08-01
depends_on: []
issue: https://github.com/woojubb/robota/issues/1569
---

# PROC-009 — "file the root item" names two places, and the floors know one

## Problem

A FOUNDATIONAL verdict must cause a filed root item ([finding-depth.md](../rules/finding-depth.md)).
Two documents say where that item goes, and they do not agree:

- `backlog-writer` — the skill both `pr-review-orchestration` and `documentation-refresh` route a
  foundational verdict to — creates `.agents/spec-docs/draft/<ID>.md`.
- `record-local-review.mjs` — the floor that refuses a `--foundational <ID>` naming nothing — resolves
  against `.agents/backlog/` and `.agents/backlog/completed/` only.

So an item filed on the designed happy path fails the floor that exists to verify it was filed, with the
message "file the root item first" for an item that is filed. Measured 2026-08-01 during PROC-005 review:
125 IDs exist only under `.agents/spec-docs/` (`ARCH-PROVIDER-00x`, `BEHAVIOR-00x`, `DATA-001`, …).

This is not one scan's bug. It is that no document owns the sentence "a root item lives at X", so every
consumer picked a location, and there are now at least two consumers and two answers.

## Why it is not fixed where it surfaced

It surfaced in `depth-verdict-reachable.test.mjs` (PROC-005), which resolves containment-note IDs. Widening
only that file would make two floors disagree about what a filed root item IS — a third answer, which is the
defect rather than a fix. That file is contained instead: it reuses `record-local-review`'s `resolveRootItems`
verbatim, so both floors are wrong in exactly the same way and one change corrects both.

## Done when

- One document owns the root-item location(s), and both `record-local-review.mjs` and
  `depth-verdict-reachable.test.mjs` resolve through a single exported reader rather than a location list
  each.
- A root item filed by `backlog-writer` on the routed path satisfies `--foundational <ID>` without the
  author having to know which tree the floor happens to read.
- **Both** containment sites naming PROC-009 are removed with the fix. There are two, and neither is
  mechanically checkable after this item lands — the ID keeps resolving once the item moves to
  `completed/`, so a stale instruction stays green:
  - the comment in `scripts/harness/__tests__/depth-verdict-reachable.test.mjs` (why the reader is not
    widened locally), and
  - the containment note in `.agents/skills/documentation-refresh/SKILL.md` step 4, which tells an
    operator to bypass `backlog-writer` and write the item under `.agents/backlog/` "until PROC-009
    lands". That sentence becomes actively wrong on the day this item is fixed.
