---
title: 'HARNESS-071: two skills carry a no-progress escape and eleven do not, and the rule that now requires one was landed over them'
status: todo
issue: https://github.com/woojubb/robota/issues/1616
created: 2026-08-03
priority: medium
urgency: next
area: .agents/skills, .agents/rules
depends_on: []
---

# HARNESS-071: a loop that cannot notice it is stuck

## Problem

`.agents/rules/enforcement-architecture.md` now states, as a mandatory form for every auto-re-drive
loop:

> Every such loop MUST have an escape, and the escape MUST be **no-progress detection**: if a round
> returns the same finding set unchanged, stop and escalate to the user.

Almost nothing satisfies it. The rule was landed in PR #1615 (the PR-review round cap removal); review
round 8 found it violated at landing by its own subjects — including the exemplar the rule's own
sentence names — and rounds 9 and 10 each found the count of those subjects too low again.

## Evidence

Measured 2026-08-03 by grepping every `.agents/skills/*/SKILL.md` for re-drive language
(`Bounded:`, `bounded at/to/by`, `round cap`, `**Loop**`, `loop until`, `re-drive`, `repeat phase`)
and then for an escape (`recurs unchanged`, `no-progress`):

| Carries the escape                                                                    | Describes a bounded re-drive without one                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-review-orchestration` (Round B step 4), `delegated-refactor-green-gate` (line 86) | `architecture-refresh`, `automated-review-convergence`, `backlog-execution-orchestrator`, `capability-extraction`, `documentation-refresh`, `npm-otp-publish`, `post-implementation-checklist`, `post-merge-cycle`, `release-orchestration`, `user-execution-scenario`, `user-request-gate` |

Two carry it; eleven do not. Spot-checked cites for the shape of what is missing:
`architecture-refresh:58` "**Loop** 1–5 until step 2 says converged" — no escape of any kind;
`documentation-refresh:28` a "**round cap** … only a safety checkpoint" — count-only, which the rule
says must never be the only bound; `backlog-execution-orchestrator:59,93` "Bounded: 2 revisions" /
"Bounded: 2 rounds"; `post-merge-cycle:87` "bounded at 2 attempts"; `user-execution-scenario:63,85,96`
per-round caps on a guardian verdict.

**Treat the right-hand column as a LOWER BOUND, not a census.** It comes from a keyword grep, which
will miss a loop phrased differently and may include a bounded step that is not a re-drive. That is
deliberate: three successive review rounds each corrected a hand-kept count here — three, then six,
then eleven — which is the argument for not keeping one by hand. Establishing the exact set is the
Test Plan's job.

`architecture-refresh` is the loop the rule cites as the exemplar of the shape ("the
`architecture-refresh` shape: converge on `ACTIONABLE FINDINGS: 0`"), so the rule names as its model
a loop that does not satisfy it.

## Why this is foundational (or not)

**FOUNDATIONAL to the rule, LOCAL to each skill.** Each skill is independently fixable and none blocks
the others, but the rule is not honestly in force until they are: a non-negotiable that its own
subjects break teaches the next reader that the rule group is aspirational. It is filed rather than
fixed in #1615 because that PR's subject is three unrelated cleanup items, and quietly widening it to
rewrite a dozen orchestration skills is the scope creep the depth rule exists to prevent.

The class is the one this repository measures most: **adding enforcement is cheap to write and
expensive to verify reachable.** A rule stating a MUST is not the same as the MUST holding.

## Direction

Add to each loop the escape `pr-review-orchestration` Round B step 4 uses: identify each finding
(`file:line + severity`), compare the round's finding-identity SET to the previous round's, and on an
unchanged set STOP and escalate rather than spin. A count is permitted as a second bound and must not
be the only one.

`documentation-refresh` is the smallest change — it already pauses and reports on reaching its cap, so
it needs the set comparison added ahead of the count, not a new control flow.

The identity-set comparison is ONE rule, so a dozen restatements of it is what HARNESS-068 is about.
Prefer a single owner — a rule section, or a shared skill fragment the loops route to — over a
paragraph pasted into each. Decide that before editing the first skill.

Note that the identity is itself defined three different ways today (`file:line + severity` in
`pr-review-orchestration`, `file:line + rule/category` and `file:line+rule` in the HARNESS-018 draft).
With no round cap, the identity is the sole bound of the PR-review loop, so two definitions mean two
different stuck-detections. Settle it as part of this item.

## Test Plan

- **Required red-first regression:** a mechanical check that every skill file describing an
  auto-re-drive loop states a no-progress escape — proven to FAIL against the eleven above before it
  is trusted, and proven to PASS on the two that comply. Without it this closes by editing prose and
  nothing keeps it closed, and the count in this file goes stale a fourth time.
- The check defines the population; this file's table does not. If the check finds a loop the table
  misses, the table was wrong, not the check.
- `pnpm harness:scan` and `pnpm harness:test` green.

## User Execution Test Scenarios

**Does not apply.** Agent-process documents and their guard; no user-facing surface.
