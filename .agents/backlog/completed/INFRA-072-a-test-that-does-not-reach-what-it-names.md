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

| Case                              | Caught?    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks-have-execution-coverage`   | **no**     | the logic under test is IN the test file, so there is no source to reverse and no pair to judge. Per-case granularity operates inside a verdict this case never reaches.                                                                                                                                                                                                                                                                |
| `remaining-hooks-run` (two hooks) | **no**     | the hooks it names were not changed in the range, so no pair exists. INFRA-074's relation now says so precisely instead of approximately, but "no pair" is still no verdict.                                                                                                                                                                                                                                                            |
| `remaining-hooks-run` (extension) | **no**     | it fails reversed for the wrong reason — it crashes before reaching the filter. The gate reads pass/fail and cannot read WHY. This is direction 2/3 territory.                                                                                                                                                                                                                                                                          |
| `remaining-hooks-run` (unset var) | **partly** | it asserts an exit code both paths share, so it passes reversed. It is caught when it is the range's own added case and the file's red comes from a pre-existing case — the masking measured on `2ac10f251..b1f46acf3`. It is NOT caught when a genuine added case fails beside it, because requiring EVERY added case to fail would fail correct work: a range that adds three cases for one fix does not make all three depend on it. |

So direction 1 closes the masking half and nothing else, which is what the item said it would. The
remaining half — a case that fails for the wrong reason, or passes beside a genuine sibling — needs
the branch-level or coverage-delta work, and stays open as a separate decision.

## Decision (2026-08-01, second pass) — direction 3, and direction 2 rejected with the measurement

Directions 2 and 3 were the remaining halves. **Direction 3 (coverage delta per case) is
implemented. Direction 2 (branch-level mutation) is rejected**, and the reason is measurable rather
than a matter of taste.

### Acceptance criterion, set before any code was written

1. Of the four motivating cases, the witness was predicted to catch **0 additional** — direction 1
   already catches #4 partly — with a per-case reason stated in advance and then replayed.
2. It must catch the class direction 1 cannot see: a case that FAILS on the reversed source and
   executed none of the lines the fix wrote.
3. **Zero** false alarms over recent real ranges. A guard that fires on correct work gets switched
   off, and #1568 already established that "every added case must fail" is that kind of guard.

### What was built

Two instruments, one question — did the case that supplied the red actually execute the code this
fix wrote?

- `bash`: `BASH_ENV` names a prelude every non-interactive bash sources before the script it was
  asked to run, so a hook spawned from inside a vitest worker is instrumented without touching the
  test or the hook. `BASH_XTRACEFD` sends the trace to its own descriptor, so a test asserting on the
  hook's stderr is unaffected by being measured.
- `.mjs`/`.ts`: vitest v8 coverage, whose istanbul-shaped output names the executed statements and
  which lines are statements at all.

Per-case attribution comes from re-running the single deciding case with `-t`, because vitest
attributes outcomes to cases but coverage to a run.

Three answers, and only UNREACHED is a finding. UNKNOWN — a comment-only hunk, a pure deletion, a
report that never names the file — leaves the verdict exactly as it was.

### Two formulations were tried, and the first was measured WRONG

The first asked the question of the REVERSED tree against the fix's OLD-side lines. Replayed on
`c08e0dbd6`, it called a **genuine** red proof `unreached`: that fix is an ADDITION, so its old side
held nothing but a comment and one `case` pattern arm. It also turned out that `set -x` never names a
bare `case` arm at all — probed on bash 5.2, `*.ts) echo is-ts ;;` traces at its own line because it
carries a command, while `*.md)` alone never does and only its body traces.

Asked of the FIXED tree against the fix's NEW-side lines, with bare `case` arms excluded from the
executable set, the same replay gives `reached`. That is the formulation that shipped.

### The four motivating cases, judged against what landed

| Case                              | Caught?    | Why                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks-have-execution-coverage`   | **no**     | the logic under test is IN the test file — no source to reverse, no pair, so the gate emits no verdict for the witness to qualify. Out of reach of any diff-scoped pair gate.                                                                                                           |
| `remaining-hooks-run` (two hooks) | **no**     | the hooks named were not changed, so again no pair.                                                                                                                                                                                                                                     |
| `remaining-hooks-run` (extension) | **no**     | REPLAYED on `b1f46acf3`: the fix wrote only comments and one bare `case` arm, so no changed line is traceable and the witness answers UNKNOWN. And the behaviour the case names — the extension filter — is not in the range's diff at all, so no diff-scoped instrument can target it. |
| `remaining-hooks-run` (unset var) | **partly** | unchanged from direction 1. The witness holds for it either way; catching it in the "a genuine added case fails beside it" configuration needs a demand on EVERY added case, which #1568 measured as failing correct work.                                                              |

**0 of 4 additional, as predicted.** The three the item still names are not reachable from inside
this gate: two produce no verdict at all, and the third names a behaviour the diff does not contain.
Closing that would take a per-case reachability check over the WHOLE suite rather than over a fix
range — a different gate, and the honest next item.

### Why direction 2 was rejected

Branch-level mutation was traced through the same four cases and the same false-positive test:

- Per-hunk reversal (the tractable reading of "negate the branch a case names") catches none of the
  four. #3's fix is entirely within the crash region, so every hunk kills the case; #4's vacuous case
  hides behind a genuine sibling that kills every hunk.
- The reading that WOULD catch #4 — every added case must be killed by some mutant — is the same
  shape as "every added case must fail on reversal", which #1568 measured as failing correct work: a
  range routinely adds cases that do not depend on the fix.
- Cost: one vitest run per hunk. Over the 31 recent ranges this gate judges, source files carry up to
  617 changed lines across many hunks.

Strictly more expensive, and it catches nothing direction 3 does not.

### Measured, on real ranges

Eight recent merged ranges replayed through the real gate (worktree detached at each merge, this
branch's gate copied in). **17 sources judged, 13 of them offering a red proof:**

| Witness   | Of the 13 red proofs | Effect                |
| --------- | -------------------- | --------------------- |
| REACHED   | 12                   | verdict unchanged     |
| UNKNOWN   | 1                    | verdict unchanged     |
| UNREACHED | **0**                | **zero false alarms** |

The other 4 rows never offered a proof (3 `outcome=null`, 1 `run-error`) and are UNKNOWN by
construction.

Ranges: `63fa0c0cf`, `2ac10f251`, `631aa9e27`, `02f5a84b9`, `a668df9e3`, `2b0c454e0`, `4719efe5a`,
`8589d58fa`. Both instruments are exercised there — `.sh` sources through the tracer, two `.mjs`
sources through coverage.

An earlier draft of this section reported "15 sources, 12 red proofs, 11 REACHED" — a miscount of the
same run, corrected here against `outcome=… witness=…` pairs counted mechanically rather than by eye.
The conclusion is unchanged and the corrected numbers are stronger.

The gate stays ADVISORY and `red-proof-unreached` is report-only even under
`REGRESSION_RED_PROOF_ENFORCE`; promotion is INFRA-046's decision, not this one.

### Three review findings, all fixed

None could turn CI red today — `red-proof-unreached` never sets a non-zero exit — which is the reason
to fix them now: they are cheap while the verdict is advisory and expensive the moment INFRA-046
promotes it. The first two are false-alarm sources, where the gate reports a finding against correct
work. The third is the opposite and the more costly direction: a missed detection, where the gate
reports a sound proof over a masking bug.

**1. The `case`-arm exclusion over-matched, and excluded a line bash DOES trace.** `BARE_CASE_ARM`
matched any `(...)` line with no inner parens, so a full-line subshell in an arm BODY —
`(cd "$dir" && cmd)` — was dropped from the executable set. Reproduced red before fixing: with that
subshell as the only fix-written line the witness answered UNKNOWN, and with an unreached sibling
line beside it, **UNREACHED — a finding against correct work**, which the acceptance criterion
promised zero of.

Fixed by recognising an arm by POSITION rather than by shape alone: arm position is straight after
`case … in` and after each `;;` / `;&` / `;;&`; everything between is a body, where a parenthesised
line is a command. The state is a stack, so a `case` nested in an arm body does not reset its
enclosing block.

**2. The run budget's comment promised what the loop did not do.** It replayed only the first
`MAX_WITNESS_RUNS` (3) deciding failures while the comment claimed "the answer is settled by the
first REACHED" — true only if every deciding failure is checked. A range whose only fix-reaching case
sat 4th fell through to UNREACHED.

This was not hypothetical. Measured across the same eight ranges, the deciding-failure counts per
source were **1, 1, 4, 5, 1, 10, 1, 2, 19, 3, 3, 9** — the cap of 3 truncated the walk for **5 of 12**
sources. It changed no verdict there only because an early case reached the fix in each.

Kept as a budget, and made honest, rather than removed: every deciding case is now asked until one
answers REACHED or the budget stops the walk, and **a stopped walk answers UNKNOWN, never
UNREACHED** — "we stopped looking" and "nothing reached it" are different answers and only the second
is grounds for a finding. The size is raised to 25, covering the observed maximum of 19 with headroom.
Raising it is nearly free on the healthy path, because a REACHED short-circuits and a sound range pays
for ONE run whatever the number is; only a range heading for a finding walks the list.

Re-measured after both fixes: the corpus result is **unchanged** — 12 REACHED, 1 UNKNOWN, 0 UNREACHED
across the 13 red proofs.

**3. `-t` selected the deciding case's SIBLINGS too, and that one hid a missed detection.**
`--testNamePattern` is an UNANCHORED regex over the full test name, so a case called `parses config`
also selected `parses config with defaults` — the ordinary shape of descriptive titles. The isolated
run executed both, and every line the sibling touched was credited to the deciding case, turning a
genuine UNREACHED into a reported REACHED.

This is the finding that mattered most, and the corpus measurement was structurally blind to it: the
failure direction is a MISSED DETECTION, not a false alarm. Zero-false-alarms was measured and would
have stayed zero while the feature quietly did not work. The previous two findings were "a correct fix
reported wrong"; this one is "a wrong fix reported correct".

Reproduced red against a REAL vitest run — an injected runner implementing my own idea of `-t` would
have been an accidental green — with two cases whose names are prefix/suffix of one another, only the
longer touching the fix-written line, and the shorter as the deciding failure: `expected 'reached' to
be 'unreached'`.

WHAT `-t` ANCHORS AGAINST was measured, not read, because anchoring the wrong string matches nothing
and answers UNKNOWN for everything — a worse bug than the one being fixed. Probed on vitest 3.2.6
against `describe('outer group')` + `it('parses config')`:

| Pattern                       | Result                                          |
| ----------------------------- | ----------------------------------------------- |
| `parses config`               | **2 ran** — the collision                       |
| `^parses config$`             | **0 ran, 2 skipped** — the bare title is NOT it |
| `^outer group parses config$` | **1 ran, 1 skipped** — correct                  |

So the subject is the describe chain and the title joined by single spaces, byte-identical to the json
reporter's `fullName`, which is what `decidingFailures` already hands over. The pattern is now
`^<escaped fullName>$`, and when only a bare title is known (no `fullName`) it anchors the END only —
still immune to the sibling collision, and never the empty-match trap.

**The anchoring needed its own guard**, since an anchoring that matched nothing would look like a
clean pass. Re-measured on the same eight ranges after the change: **12 REACHED, 1 UNKNOWN,
0 UNREACHED — the 12 are still 12.** Those verdicts come from real `-t` invocations against real
describe chains, so had the pattern stopped matching they would all have flipped to UNKNOWN.

### Re-measured against the current hooks

`#1582` rewrote `.claude/hooks/lib/command-scan.sh`, which the traced hooks source, so the
instrumentation was re-run against the current tree: `branch-guard.sh`, `pre-push-check.sh`,
`check-forbidden-patterns.sh`, `worktree-cwd-guard.sh` and `post-tool-format.sh` — **5 of 5**
instrumented cleanly, each tracing its own lines plus its two sourced lib files, with exit status and
stderr byte-identical to an untraced run, and no line classified untraceable that the trace actually
named. That last check is an independent cross-check of the tightened arm rule against real hooks
rather than fixtures.

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
