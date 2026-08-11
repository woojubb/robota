---
title: 'PROC-009: nothing owns WHERE a root item lives, so the floors that verify one resolve half the space'
status: done
priority: medium
urgency: soon
type: PROC
area: scripts/harness
created: 2026-08-01
completed: 2026-08-01
depends_on: []
issue: https://github.com/woojubb/robota/issues/1569
---

# PROC-009 — "file the root item" names two places, and the floors know one

## Problem

A FOUNDATIONAL verdict must cause a filed root item ([finding-depth.md](../rules/finding-depth.md)).
Two documents say where that item goes, and they do not agree:

- `backlog-writer` — the skill both `pr-finding-resolution-loop` and `documentation-refresh` route a
  foundational verdict to — creates `.agents/spec-docs/draft/<ID>.md`.
- `record-local-review.mjs` — the floor that refuses a `--foundational <ID>` naming nothing — resolves
  against `.agents/tasks/` and `.agents/tasks/completed/` only.

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
    operator to bypass `backlog-writer` and write the item under `.agents/tasks/` "until PROC-009
    lands". That sentence becomes actively wrong on the day this item is fixed.

## Resolution (2026-08-01)

The owner is [`finding-depth.md`](../rules/finding-depth.md) § "Where a root item lives", and the answer
it declares is the backlog tree — `.agents/tasks/` and `.agents/tasks/completed/`.

**Done-when #2 is answered the other way, deliberately.** It asked that an item filed by `backlog-writer`
satisfy `--foundational <ID>`; the location that got the owner is the one `backlog-writer` does NOT write
to, so the routing moved instead of the reader. Three reasons, none of them the reader's convenience:

- A spec-doc is a _plan_ under a gate pipeline — prior art, alternatives, a decision, TC-numbered
  criteria, a test plan. At the moment a foundational finding is raised none of that is knowable, so a
  filing on that path is either a blocked review round or a draft of placeholders that GATE-WRITE fails.
- Widening the reader would make `.agents/spec-docs/rejected/` a place a root item can live. "A root
  item exists" would then be true of a plan somebody declined.
- The two trees already pair by design (111 shared IDs): the backlog item is the problem, the spec-doc
  is the plan it later gets. Filing the problem where problems live keeps that pairing rather than
  collapsing it.

Filing is the routing orchestrator's, not a new worker's — the content is the guardian's finding plus a
location, and `enforcement-architecture.md` says a tier added for reliability buys none.

Both containment sites are gone: the comment in `depth-verdict-reachable.test.mjs` and the note in
`documentation-refresh` step 4. The floor is two cases in that same file — the reader resolves exactly
what the rule declares (a probe tree, compared for equality in both directions), and no skill or agent
routes a filing anywhere else (a named filer resolves through its own declared output, which is the form
the defect actually took).
