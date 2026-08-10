---
title: 'HARNESS-085: a branch no run can reach is invisible to every gate'
status: todo
created: 2026-08-10
priority: medium
urgency: soon
area: scripts/harness, .claude/hooks
depends_on: []
---

# HARNESS-085 — a branch no run can reach is invisible to every gate

**Source:** lesson-to-harness pass alongside `measurement-provenance`; the mechanism terminal state
for a second lesson mined in the same session, recorded here rather than closed on prose.

## The problem

Defensive code written for a state the surrounding code has already excluded reads as care and costs
nothing to add, so it accumulates. Two examples landed in a single change: a harness scan that
already throws on an empty population also carried a report branch for the zero case, and a sibling
scan carried the same shape. Neither branch can execute in any run, so:

- it describes the check to a reader as handling a situation the check refuses to enter;
- every test suite passes with it present, absent, or wrong;
- review is the only thing that can find it, and review found both — after they landed.

The class is general: **an unreachable branch is unfalsifiable.** It cannot be red-proved (nothing
makes it run), it cannot rot loudly (nothing depends on it), and it survives every gate the
repository has.

## Why nothing catches it today

Logical reachability is not decidable in general, and the lint layer only sees syntactic
unreachability (`return` followed by a statement) — the branches above are syntactically fine. The
`measurement-provenance` floor added in the same pass checks that a counter is asserted, not that
every branch of the module can run.

## The tractable proxy

**Branch coverage over the harness modules.** An unreachable branch is, by construction, an
uncovered branch, and coverage is a number a gate can hold a line against. The work:

1. Run the `scripts/harness/__tests__` suite under coverage and record the current branch figure per
   module — the baseline, as a frozen SET rather than a single total, so a module that loses coverage
   cannot be hidden by one that gains it.
2. Ratchet: a module's branch coverage may not fall, and a NEW module enters at or above the floor.
3. Report the uncovered branches by location, so a drop names the branch rather than a percentage.

Open questions to settle in the design, not here: whether the floor covers `scripts/harness` only or
extends to `.claude/hooks` (which is shell and needs a different instrument), and what the entry
floor is for a new module.

## Done when

- A registered check fails on a module whose branch coverage falls below its recorded figure.
- The check is proved on a reproducing fixture: a module with a branch no case can reach fails it,
  and the same module with the branch removed passes.
- The baseline is a set, and its anti-rot removes an entry for a module that no longer exists.
