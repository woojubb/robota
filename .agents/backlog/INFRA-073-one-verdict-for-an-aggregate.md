---
title: 'INFRA-073: the red-proof gate reports one verdict for an aggregate, so a pass hides inside a fail'
status: todo
priority: high
urgency: soon
type: INFRA
area: scripts/harness
created: 2026-07-31
depends_on: []
issue: https://github.com/woojubb/robota/issues/1536
---

# INFRA-073 — the unit the gate judges is not the unit the defect lives in

## Problem

`check-regression-red-proof` reverses a range's source changes, re-runs the changed tests, and emits
**one verdict per subject**. `classifyVitestOutcome` returns `assertion-fail` if ANY deciding test
fails, and `assertion-fail` means `RED_PROOF_OK`.

So when a `fix:` range touches two sources with their tests, a genuine red proof in one produces
`RED_PROOF_OK` for both — even when the other's test is accidental-green. The defect the gate exists
to catch, occurring across files instead of within one.

This is not a consequence of INFRA-071's widening. Aggregation was there from the first version: a
`packages/x/src` range changing five source files and five tests had the identical hole. The widening
made subjects coarser (`.claude/hooks` and `scripts/harness` are whole directories, not packages), so
it made the hole easier to hit and easier to see. It did not create it.

## Measured

Replaying `2ac10f251..b1f46acf3` through the widened gate returns `red-proof-ok` for `.claude/hooks`.
Three hooks were reversed together; exactly one test failed
(`post-tool-format > … outside the formatted set`). The other two hooks' cases passed reversed and
the verdict said nothing about them.

## Root

The gate judges an **aggregate** and reports a **scalar**. Any pass hides inside any fail. Every
granularity complaint against this gate is the same statement at a different level:

- **This item** — subject-level vs source-file-level, for the code under test.
- **[INFRA-072](INFRA-072-a-test-that-does-not-reach-what-it-names.md)** — file-level vs case-level,
  for the tests doing the proving.

They should be decided together, because a fix that splits one and not the other leaves the same
shape one level down.

## Direction

Reverse and judge **per source file**: for each changed source, reverse only it, run the tests that
exercise it, classify, and let the worst verdict carry — reporting each source's verdict rather than
one for the set. The cost is one vitest run per changed source instead of one per pair, which is why
it is a design decision and not a patch.

## Containment in force

`check-regression-red-proof.mjs` carries a comment at the aggregation point naming this item. The
gate is ADVISORY (`REGRESSION_RED_PROOF_ENFORCE` is unset), so the aggregation cannot currently
approve anything on its own — that is what makes containment acceptable rather than a hold on a
required check. **This item must be resolved before the gate is promoted to enforcing** (INFRA-046),
because at that point an aggregate verdict starts deciding merges.

## Done when

- Each changed source in a range receives its own verdict, and the log shows them separately.
- A range where one source is red-proved and another is accidental-green reports `ACCIDENTAL_GREEN`,
  proven by replaying `2ac10f251..b1f46acf3`.
- Decided jointly with INFRA-072, or with a written reason for deciding them apart.
