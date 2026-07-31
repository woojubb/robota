---
title: 'INFRA-072: a test that passes without reaching the behavior it names'
status: todo
priority: high
urgency: next
type: INFRA
area: scripts/harness
created: 2026-07-31
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
