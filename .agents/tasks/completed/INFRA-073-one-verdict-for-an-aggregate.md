---
title: 'INFRA-073: the red-proof gate reports one verdict for an aggregate, so a pass hides inside a fail'
status: done
completed: 2026-07-31
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
- **[INFRA-072](completed/INFRA-072-a-test-that-does-not-reach-what-it-names.md)** — file-level vs
  case-level, for the tests doing the proving. Decided 2026-08-01: per-case granularity, which
  closes the masking half only.

They should be decided together, because a fix that splits one and not the other leaves the same
shape one level down.

## Direction

Reverse and judge **per source file**: for each changed source, reverse only it, run the tests that
exercise it, classify, and let the worst verdict carry — reporting each source's verdict rather than
one for the set. The cost is one vitest run per changed source instead of one per pair, which is why
it is a design decision and not a patch.

## Resolved (2026-08-01), and one acceptance line retracted on measurement

Each changed source is now reversed alone, judged by the tests that exercise THAT source, and given
its own verdict; the worst carries. The cost is one vitest run per changed source instead of one per
pair — the reason this was a decision rather than a patch.

Replaying `2ac10f251..b1f46acf3`, which is the range the problem was measured on:

```
before   3 sources -> 1 verdict    red-proof-ok
after    .claude/hooks/branch-guard.sh     -> red-proof-ok   (assertion-fail)
         .claude/hooks/lib/command-scan.sh -> inconclusive
         .claude/hooks/post-tool-format.sh -> red-proof-ok   (assertion-fail)
```

**The Done-when line below asked for `ACCIDENTAL_GREEN` from that replay, and it does not come — the
premise was wrong.** Both hooks with tests that exercise them are genuinely red-proved; the third
source is a LIBRARY that no test spawns, so it is correctly INCONCLUSIVE. What the replay does prove
is the thing the item is about: the aggregation is gone. A source nothing exercises used to be
covered by its siblings' proof and is now visible as unjudged.

The accidental-green-hidden-behind-a-proof case is covered directly instead, by a fixture that fails
on the unfixed gate with the message `the sources were reversed together, so one proof covered both`.

Expect more INCONCLUSIVE verdicts as a result. That is the honest reading of a source nothing
exercises, and it is what the aggregate was hiding.

## Containment in force

`check-regression-red-proof.mjs` carries a comment at the aggregation point naming this item. The
gate is ADVISORY (`REGRESSION_RED_PROOF_ENFORCE` is unset), so the aggregation cannot currently
approve anything on its own — that is what makes containment acceptable rather than a hold on a
required check. **This item must be resolved before the gate is promoted to enforcing** (INFRA-046),
because at that point an aggregate verdict starts deciding merges.

## Done when

- Each changed source in a range receives its own verdict, and the log shows them separately.
- ~~A range where one source is red-proved and another is accidental-green reports
  `ACCIDENTAL_GREEN`, proven by replaying `2ac10f251..b1f46acf3`.~~ **Retracted on measurement — that
  range has no accidental-green source.** Replaced by a fixture that fails on the unfixed gate.
- Decided jointly with INFRA-072, or with a written reason for deciding them apart.

## Completion (2026-07-31)

Resolved on `develop`: `check-regression-red-proof.mjs` judges per source pair (`decidePairVerdict`, `qualifyingPairs`, both exported and unit-tested) instead of reporting one verdict for the aggregate, so a pass no longer hides inside a fail.

Reconciled 2026-08-04: the work had landed and the issue was closed with its evidence, but the Task
file was never moved. Verified against the tree before moving, not taken from the closed issue.
