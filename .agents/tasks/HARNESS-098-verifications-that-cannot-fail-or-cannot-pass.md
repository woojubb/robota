---
title: 'HARNESS-098: a verification that cannot fail on the condition it names converts unverified into verified — the state nobody re-examines — and its mirror, a check that cannot pass on correct input, is equally live in this repo'
status: todo
created: 2026-08-16
priority: high
urgency: now
area: .agents/rules, .agents/skills, scripts/harness
depends_on: []
---

# HARNESS-098: unfalsifiable checks, in both directions

Converted from [issue #1763](https://github.com/woojubb/robota/issues/1763) (owner directives,
2026-08-16 session), item **3**.

## Problem

A check that cannot go red on the condition it claims to test is worse than no check: it moves a fact
from **unverified** — a state someone might re-examine — to **verified**, which nobody re-examines.
The green is the damage.

**Three measured instances, one session:**

1. The ARCH-030 `latchThrew` observable that measured nothing.
2. A typecheck "proof" that could not catch the second structural re-declaration.
3. An "`rg` finds zero repo-wide" claim that was one off.

**The mirror exists too, and was found in the same session:** the spec public-surface parser stops
counting at the first subheading, so a correctly-structured grouped Public API table reads as
entirely undocumented — a check that cannot PASS on correct input. Filed separately as
[issue #1765](https://github.com/woojubb/robota/issues/1765). Both directions are the same defect:
the check's verdict is not a function of the condition it names.

**This item's own risk is the sharpest argument for it.** Any check built to catch unfalsifiable
checks can itself be unfalsifiable. The prove-it-fails step is not ceremony here; it is the only
thing separating this item from the defect it is about.

## Direction

**Before proposing any check, state what would make it FAIL.** That sentence is the artifact — if it
cannot be written, the check is not ready.

Two properties to design for, since the instances split evenly between them:

- **Can go red** on the named condition (instances 1–3).
- **Can go green** on correctly-formed input (the parser mirror).

`lesson-to-harness` step 9 already requires running a new check against the pre-fix state and
confirming it FAILS. That step exists and these three instances still shipped — so the gap is not the
rule's absence but that nothing verifies the step was performed. Whatever this item builds should make
the step's _result_ recorded and checkable, not merely instructed.

## Mechanism (required — see `lesson-to-harness` step 8)

Candidates, to be decided during design:

- Require every new `scripts/harness/check-*.mjs` / `scan-*.mjs` to ship a fixture test asserting
  **both** directions (red on the violation, green on the conforming case) — the existing
  `__tests__/` fixtures already do this for several scans, so the floor is a coverage assertion over
  scans rather than a new convention.
- A scan over the harness's own test files that fails when a check has only a green-path fixture.

**Infeasible-now is permitted only with a written concrete obstacle plus a tracked item.**

## Test Plan

- Prove-it-fails (step 9): run the mechanism against the three recorded instances' pre-fix state and
  confirm each FAILS; confirm the corrected state PASSES.
- Include the mirror direction: a fixture where correct input must PASS, asserted to fail if the
  check regresses to the parser's shape.
- Sweep (step 5): enumerate every harness check lacking a red-direction fixture.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — harness/process change with no runnable user-facing behaviour. The before/after
mechanism result under Test Plan is the evidence.
