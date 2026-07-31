---
title: 'INFRA-072: a test that passes without reaching the behavior it names'
status: done
priority: high
urgency: next
type: INFRA
area: scripts/harness
created: 2026-07-31
completed: 2026-08-01
depends_on: [INFRA-071]
issue: https://github.com/woojubb/robota/issues/1537
---

# INFRA-072 — the defect class reverse-apply cannot reach

## Problem

INFRA-071 widened the accidental-green gate to `.claude/hooks/**` and `scripts/harness/**`, and in
doing so measured something worth its own item: **the four accidental-greens that motivated it are
not the class that gate catches.**

`check-regression-red-proof` asks one question — _does this test depend on the fix?_ — by reversing
the source and re-running. All four misses passed that question and failed a different one:

| Test                              | Failed question                                                      |
| --------------------------------- | -------------------------------------------------------------------- |
| `hooks-have-execution-coverage`   | logic under test is IN the test file — nothing to reverse            |
| `remaining-hooks-run` (two hooks) | the hooks named were not changed — no pair exists                    |
| `remaining-hooks-run` (extension) | fails reversed, but for the wrong reason (crashes before the filter) |
| `remaining-hooks-run` (unset var) | asserted an exit code both paths share                               |

The shared shape: **the test never reaches the behavior its own name claims.** It is PROC-003's
third question — "is it reached?" — asked one level down, of a test case rather than of a guard.

## Why the existing floors do not cover it

- `check-regression-red-proof` (HARNESS-041) reads pass/fail. It cannot read WHY a test failed, so a
  case that fails for an unrelated crash is indistinguishable from one that fails on its assertion.
- `hooks-have-execution-coverage` (PROC-003) asks whether a hook is executed by ANY test. It says
  nothing about whether a given case reaches a given branch — and it was itself one of the four.
- File-granularity masking (the test-side face of [INFRA-073](INFRA-073-one-verdict-for-an-aggregate.md)): a changed test FILE is red-proved by any one of its cases failing, so a
  vacuous case beside a genuine one is invisible. Measured on `2ac10f251..b1f46acf3`.

## Directions, none chosen yet

1. **Per-case granularity.** Require at least one case ADDED in the range to fail on the reversed
   source, not merely any case in the file. Cheap; catches the masking half; still blind to "fails
   for the wrong reason".
2. **Mutation at the branch level.** Delete/negate the branch the test names and require that case
   to fail. Strongest, and directly answers "does it reach it" — but needs a way to name the branch,
   which for a shell hook is not obvious.
3. **Coverage delta per case.** Run the case with coverage and assert the named branch executed.
   Precise for `.mjs`/`.ts`; `bash` needs its own instrumentation (`BASH_XTRACEFD`), which is
   feasible but new machinery.

Pick after INFRA-071 has produced a few real verdicts, so the choice is made against measured
behavior rather than in the abstract.

## Done when

- A vacuous case — one that passes whether or not the behavior it names exists — fails a mechanical
  check, demonstrated by replaying at least one of the four above.
- The check distinguishes "this case reached the behavior" from "this file contains some case that
  failed", since the second is what already passes today.

## Decision (2026-08-01) — direction 1, and what it does not reach

INFRA-071 has produced verdicts and INFRA-073 has landed, so the choice is made against measured
behaviour rather than in the abstract. **Direction 1 (per-case granularity) is implemented.**

A changed test file's diff is read for the case titles the range ADDED, and at least one of those
must fail on the reversed source. A case that fails while every case the range added passes is no
longer a proof: the outcome is `added-cases-pass` and the verdict is `accidental-green-fail`. A range
that adds no title this can read — a regression fixed by EDITING an existing case — keeps FILE
granularity, because demanding a new title there would fail correct work.

Directions 2 and 3 are NOT taken, and the reason is that both need a way to name a branch inside a
`bash` hook. Neither is closed by this item; whoever picks one up should read the four rows below
first, because they are what a stronger check would have to reach.

### The four motivating cases, judged against what landed

| Case | Caught? | Why |
| --- | --- | --- |
| `hooks-have-execution-coverage` | **no** | the logic under test is IN the test file, so there is no source to reverse and no pair to judge. Per-case granularity operates inside a verdict this case never reaches. |
| `remaining-hooks-run` (two hooks) | **no** | the hooks it names were not changed in the range, so no pair exists. INFRA-074's relation now says so precisely instead of approximately, but "no pair" is still no verdict. |
| `remaining-hooks-run` (extension) | **no** | it fails reversed for the wrong reason — it crashes before reaching the filter. The gate reads pass/fail and cannot read WHY. This is direction 2/3 territory. |
| `remaining-hooks-run` (unset var) | **partly** | it asserts an exit code both paths share, so it passes reversed. It is caught when it is the range's own added case and the file's red comes from a pre-existing case — the masking measured on `2ac10f251..b1f46acf3`. It is NOT caught when a genuine added case fails beside it, because requiring EVERY added case to fail would fail correct work: a range that adds three cases for one fix does not make all three depend on it. |

So direction 1 closes the masking half and nothing else, which is what the item said it would. The
remaining half — a case that fails for the wrong reason, or passes beside a genuine sibling — needs
the branch-level or coverage-delta work, and stays open as a separate decision.

## GATE-COMPLETE (2026-08-01)

- `addedCaseTitleMatchers` reads titles off ADDED diff lines only; a context line and a REMOVED line
  are excluded, pinned by a case that would otherwise hand the verdict back to the pre-existing case
  the granularity exists to exclude.
- The table form `it.each(rows)(...)` with an interpolated title is read: the interpolations become
  wildcards, so a wider match is a weaker check rather than a wrong verdict.
- Through the orchestrator: a vacuous new case beside an old failing one now reports
  `accidental-green-fail (added-cases-pass)` where it previously reported `red-proof-ok`.
- C1 is preserved: a sibling file that failed to collect still outranks a passing added case, so the
  verdict is INCONCLUSIVE and never a false accidental-green.
