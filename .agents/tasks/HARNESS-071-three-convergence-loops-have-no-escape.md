---
title: 'HARNESS-071: three convergence loops have no escape, and the rule that now requires one was landed over them'
status: todo
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

Three of the loops it governs do not have it. The rule was landed in PR #1615 (the PR-review round
cap removal) and review round 8 found it violated at landing by its own subjects — including the
exemplar the rule's own sentence names.

## Evidence

Measured 2026-08-03 at `676265488`:

| Loop                                            | Line   | What it has                                                                                                           |
| ----------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `.agents/skills/architecture-refresh/SKILL.md`  | 58     | "**Loop** 1–5 until step 2 says converged" — no escape of any kind                                                    |
| `.agents/skills/documentation-refresh/SKILL.md` | 28     | a "**round cap** … only a safety checkpoint" — a COUNT-only bound, which the new rule says must never be the only one |
| `.agents/skills/capability-extraction/SKILL.md` | 28, 36 | "loop until ENDORSE", "Never stop on a round count" — no escape                                                       |

Compliant today: `pr-review-orchestration` (Round B step 4) and
`delegated-refactor-green-gate` (line 86).

`architecture-refresh` is the loop the rule cites as the exemplar of the shape ("the
`architecture-refresh` shape: converge on `ACTIONABLE FINDINGS: 0`"), so the rule names as its model
a loop that does not satisfy it.

## Why this is foundational (or not)

**FOUNDATIONAL to the rule, LOCAL to each skill.** Each skill is independently fixable and none
blocks the others, but the rule is not honestly in force until they are: a non-negotiable that its own
subjects break teaches the next reader that the rule group is aspirational. It is filed rather than
fixed in #1615 because that PR's subject is three unrelated cleanup items, and quietly widening it to
rewrite three orchestration skills is the scope creep the depth rule exists to prevent.

The class is the one this repository measures most: **adding enforcement is cheap to write and
expensive to verify reachable.** A rule stating a MUST is not the same as the MUST holding.

## Direction

For each of the three, add the same escape `pr-review-orchestration` Round B step 4 uses: identify
each finding (`file:line + severity`), compare the round's finding-identity SET to the previous
round's, and on an unchanged set STOP and escalate rather than spin. A count is permitted as a second
bound and must not be the only one.

`documentation-refresh` is the smallest change — it already pauses and reports on reaching its cap,
so it needs the set comparison added ahead of the count, not a new control flow.

Consider whether this belongs in a shared place rather than three copies of the same paragraph: the
identity-set comparison is one rule, and three restatements of it are what HARNESS-068 is about.

## Test Plan

- **Required red-first regression:** a mechanical check that every skill file describing an
  auto-re-drive loop states a no-progress escape — proven to FAIL against the three loops above
  before it is trusted. Without that, this closes by editing prose and nothing keeps it closed.
- `pnpm harness:scan` and `pnpm harness:test` green.

## User Execution Test Scenarios

**Does not apply.** Agent-process documents and their guard; no user-facing surface.
