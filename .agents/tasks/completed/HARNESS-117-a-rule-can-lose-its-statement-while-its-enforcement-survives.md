---
title: 'HARNESS-117: a rule can lose its statement while its enforcement survives'
status: done
created: 2026-08-23
completed: 2026-08-23
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-117: a rule can lose its statement while its enforcement survives

Registered as GitHub issue https://github.com/woojubb/robota/issues/2178.

## Problem

`.agents/project-structure.md` § Interface Package Rule states five mandatory rules. If all five were
deleted, no check in `pnpm harness:scan` would go red for the deletion.

The scans that enforce them (`interface-runtime`, `deps`, `interface-imports`) read the CODE. They keep
working with the prose gone — they never verify that the document claiming to own a rule still states
it. `routing-document-size` reads the file, but it is a ratchet on line count: a deletion moves it in
the permitted direction.

## Existing Evidence

Measured on `origin/develop` @ `5ca65a477`.

- It happened. During ARCH-100 (issue #2080) a slice-based extraction took the span between two
  anchors, and a pre-existing `Rules:` block sat inside it. Five mandatory rules were relocated into a
  document that does not own them, and every scan stayed green.
- What caught it was `routing-document-size` — a check about SIZE — because the same change happened
  to ADD lines. A change deleting those rules while removing lines elsewhere would leave that ratchet
  green and nothing else would speak.
- Scans already emit rule IDENTIFIERS in their findings: `check-dependency-direction.mjs` prints
  `[INTERFACE-DEPS]`, `[PLUGIN-LAYER]`, `[DAG-NODES-LEAF]`, `[CORE-ZERO-DEPS]` and more.
- **`INTERFACE-DEPS` is stated in exactly one normative document — `.agents/project-structure.md`.**
  That is the granularity at which the loss actually happens.
- Of 10 rule identifiers emitted by harness scans, **1 (10%) is stated in any normative document**.
  (An initial count of 14 included two regular-expression character ranges and a documentation
  example; excluding comments, regex literals and single-character segments gives the real figure.)

## Directions Considered

- Bind the RULE IDENTIFIER a scan emits to a statement in a normative document (chosen).
- Bind the SCAN FILE to a document that names it. Rejected by measurement: `check-dependency-direction.mjs`
  stays named by three other rule documents after the Interface Package Rule is deleted, so the case
  that motivated this task would not be caught.
- Bind any tracked document. Rejected by measurement: archived documents and completed spec-docs also
  name the scans, so the check would stay green through the deletion — the defect it exists to catch.

## Completion Criteria

- [x] A scan reports a rule identifier emitted by a harness scan that no normative document states.
- [x] Archived and completed documents do not satisfy the requirement.
- [x] Currently-unstated identifiers are frozen in a baseline that may only shrink.
- [x] Deleting `INTERFACE-DEPS` from `.agents/project-structure.md` makes the scan fail.
- [x] `pnpm harness:scan` exit 0.

## Test Plan

- Unit tests over the exported extraction and matching functions, with in-memory fixtures.
- A falsification case: the statement removed from the corpus must flip the verdict.
- Full harness scan and `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

This task delivers no user-facing behavior: it adds a repository verification scan. The verification
surface is the harness gate, recorded in the Test Plan above.

## Sibling filed

Issue #2188 — nine dependency and interface rules are enforced on every push and stated in no
document. Found by this task's measurement, filed rather than absorbed: closing it means writing rule
text, which is a documentation migration and a different decision from adding a scan. The nine are
frozen in this task's baseline so the debt is counted on every run.

## Outcome

Delivered by pull request #2189, squash-merged as `6fb4fe92a` on `develop` and verified present by content.
