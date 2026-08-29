---
title: 'HARNESS-118: citations of a task record path are not re-derived when the record moves, is renamed, or its ID is reused'
issue: https://github.com/woojubb/robota/issues/2248
status: done
completed: 2026-08-29
created: 2026-08-23
priority: medium
urgency: soon
area: harness
depends_on: []
---

## Resolution

The citation resolver and lifecycle-aware scan were implemented and merged in PR #2274. Issue #2248
records the completion and separates remaining exceptions into their own follow-up issues. This Task
is terminalized as done by the DOCS-041 migration.

# HARNESS-118: citations of a task record path are not re-derived when the record moves, is renamed, or its ID is reused

## Objective

A citation of a task-record path is a fact about where a file is. Completing a record moves it from
the live folder into `completed/`, which makes every such citation false, and nothing says so. The
same happens when a record is renamed (the slug is part of the path), when it is archived out of
the tasks tree entirely, and when an ID is reused for a different subject.

## What was measured before designing

`git grep` over tracked files finds 1779 citations of a `.agents/tasks/` path across 401 files.
**That number is not the problem size.** Three corrections, each of which changes the answer:

1. **Test fixtures are not citations.** 90 are strings inside harness tests — deliberately absent
   ids, and traversal payloads aimed at the enumerator. A scan counting these measures its own
   fixtures.
2. **Resolution must be by ID and slug, not by exact path.** Most citations name
   `.agents/tasks/<ID>.md` while records are `<ID>-<slug>.md`, so exact-path matching reports a
   file that exists as missing.
3. **Frozen history is not a live claim.** `.agents/archive/`, `.design/`, `.agents/daily-reports/`
   and `.agents/spec-docs/done/` hold the bulk — 607 stale and 363 unresolvable in
   `spec-docs/done/` alone. A completed document recording where a record was AT THE TIME is
   history; rewriting it destroys the record instead of fixing it.

**On the surface that makes live claims — rules, skills, specs, memory, active/draft spec-docs, live
task records, scripts — there are 22 false citations, 20 after excluding two format examples.**

## The two cases that decide the design

Both were found by checking classifications rather than accepting them, and both would be made
WORSE by a resolver that matches on ID alone.

**`.agents/rules/operational.md:52` — a format example using a live ID.** It sits in a fence under
"**File naming:** `{ID}-{slug}.md`. The slug says what the item is about, in words:" and names
CORE-014 with the slug `shutdown-drops-in-flight-work`. `git log --all --diff-filter=A` over
`*CORE-014*` returns exactly one path ever added: `CORE-014-stateless-run-mode.md`. **No file with
that slug has existed at any commit** — an example demonstrating that a slug says what an item is
about uses a slug that says what no item was ever about, under an ID that means something else.

**`DIST-002-release-artifact-verification.md`, cited by two harness scripts — the right slug under
the wrong ID.** The record with that slug is `.agents/tasks/DIST-005-release-artifact-verification.md`
(`title: Nothing verifies a published release artifact — the macOS downloads do not open`). DIST-002
is a live ID belonging to `spec-docs/done/DIST-002-bun-binary-release-workflow.md`. **An ID-based
resolver sends this citation to the Bun-binary document** — confidently and silently.

These are the two ends of one axis: there the ID is live and the slug fabricated; here the slug is
live and the ID belongs to someone else. **A broken link is noticed by a human; a resolved wrong
link is not.** That asymmetry is why `conflict` exists as an outcome and is never auto-repaired.

## Plan

- [x] TC-01 — the scan resolves by ID **and** slug and reports four distinct outcomes: `moved`
      (both match, folder differs), `renamed` (ID matches, slug extends), `conflict` (ID and slug
      resolve to different records, or one resolves and the other does not), `dangling` (neither).
- [x] TC-02 — `conflict` fires on `DIST-002-release-artifact-verification.md`, asserted by name.
- [x] TC-03 — `conflict` fires on the `CORE-014` example, asserted by name.
- [x] TC-04 — history is excluded as a citation SOURCE and INCLUDED as a resolution TARGET. Asserted
      on `SELFHOST-008-P6`, which exists only in `.agents/archive/` and `spec-docs/done/`: excluding
      it from resolution reports `dangling`, which is the wrong answer and the more alarming one.
- [x] TC-05 — a fenced format example is not read as a citation; `CHILD-001-description.md` in
      `.agents/tasks/README.md` stays silent.
- [x] TC-06 — the 12 mechanical `moved` repairs are applied and the scan then reports zero `moved`.
- [x] TC-07 — the `CORE-014` example is made unresolvable rather than repointed, and a rule is
      stated: an example must not use a live ID.
- [x] TC-08 — MUTANT: collapsing the `conflict` branch into `moved` must go RED. This is the one
      that matters — such a scan is green on the whole tree while doing the exact damage the scan
      exists to prevent, and deleting the resolver does not catch it.
- [x] TC-09 — MUTANT: deleting the resolver must go RED on every one of the 20 known cases, not
      merely on the tree as a whole.
- [x] TC-10 — MUTANT: replacing the live-surface directory list with an empty corpus must go RED. A
      scan whose corpus silently excludes its subject passes identically to one that works.
- [x] TC-11 — `run-all-scans` green; the new scan declares what it examined.
- [x] TC-12 — `pnpm lint` checked by EXIT CODE, not by the summary line (issue #1984 / PR #2246).

## Not in scope

The 6 `dangling` citations get a comment on issue #2248, not a guess. Re-pointing a citation by
inference is how the `CORE-014` example reached its current state.

`.agents/memory/agent-run-capability-verification.md` calls SELFHOST-008-P6 a "Concrete open fix"
while P6 exists only as a completed spec-doc and an archived breakdown. That is a claim about
STATUS, not about a path, and it is filed separately. That file is also owned by another lane's
memory-mirroring branch and is excluded from this PR's repairs to avoid a collision.

## Test Plan

The scan is `scripts/harness/` with its cases driven from the real tree rather than fixtures, since
every one of the four outcomes was discovered in the real tree and no fixture would have produced
`conflict`. Gate commands: `node scripts/harness/run-all-scans.mjs`, `pnpm lint` (exit code),
`pnpm typecheck`, and the three mutants above run individually with an applied-check confirming the
mutation is in the tree before the result is read.

## User Execution Test Scenarios

**Not applicable — no runnable user-facing behaviour, and the reason is the change's whole subject.**

This delivers a harness scan over `.agents/` documents plus repairs to sixteen citations inside them.
Its entire surface is repository governance: it changes no product command, no TUI or browser flow,
no SDK or example flow, and no workflow a user of Robota can run. A person using the CLI cannot
observe it at any input, because nothing it touches is reachable from one — the "users" of a
task-record path citation are the agents and readers working inside this repository.

`backlog-execution.md` warns specifically against inventing a scenario for documentation-only,
rule-only or governance-only work, and this is all three. A scenario here would have to be an
engineering command (`node scripts/harness/scan-task-path-citations.mjs`), which the same rule
excludes by name: the engineering test plan above already owns it, and restating it under this
heading would dress a harness invocation as user execution.

Recorded rather than omitted because the rule requires the REASON, not merely the absence of a
scenario — and because this record shipped without the section at all, which is the defect
[issue #2308](https://github.com/woojubb/robota/issues/2308) exists for: nothing emits the section
and nothing checks for it, so an author who fills in the headings they were given produces a
non-compliant record and learns of it, if ever, from a gate long afterwards.
