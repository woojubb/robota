---
title: 'HARNESS-098: a verification that cannot fail on the condition it names converts unverified into verified — the state nobody re-examines — and its mirror, a check that cannot pass on correct input, is equally live in this repo'
status: done
created: 2026-08-16
completed: 2026-08-16
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

## Delivered (2026-08-16)

**Mechanism terminal state: MECHANIZED (first stage).**
`scripts/harness/check-fixture-floor.mjs`, registered in `run-all-scans.mjs`: every
`scripts/harness/{check,scan}-*.mjs` has a same-named fixture test. 116 modules examined.

**Prove-it-fails (step 9) — the strongest form available:** the check went red **on itself** the first
time it ran, demanding its own fixture. That is the condition it names, met by the file that names it.
The fixture then covers all three red branches (no fixture; a baselined entry that has since gained
one; a baseline entry naming a check that no longer exists) and the green ones.

**Ratchet, not amnesty:** five pre-existing checks lack fixtures and are listed in
`fixture-floor-baseline.json`. Nothing may be added to it, and a baselined check that gains a fixture
must be removed from the baseline — the check fails if it is not, so the gain is locked in.

**Second stage, NOT delivered, and named rather than implied:** fixture EXISTENCE is not fixture
QUALITY. A test asserting only the green path satisfies this floor and still leaves the check
unfalsifiable. Detecting the red direction textually was considered and rejected — a heuristic over
assertion shapes would itself be a check that cannot reliably fail, which is this item's own defect
committed by the file closing it. The both-directions half does NOT stay open under this Task — a
`done` record cannot be the thing an undelivered half stays open under (issue #2264). It was split out
to `.agents/tasks/HARNESS-101-fixture-existence-is-not-fixture-quality.md`, which owns it, with the
obstacle written above rather than "hard to check".

**Related mechanism found during the work, not duplicated:** `check-regression-red-proof.mjs`
(HARNESS-041) already enforces the red proof for `fix:` PRs by reverse-applying source hunks. It is
scoped to same-package source+test pairs, so it does not reach harness checks — which is why this
floor exists rather than an extension of it. Whether it can be widened is the natural next step for
the second stage.

## Closed

Stage 1 delivered and on `main`, MECHANIZED, with the strongest red proof available — the check went
red on itself.

**Stage 2 is now HARNESS-101**, filed rather than left as an open note inside a closed item: fixture
EXISTENCE is not fixture QUALITY, and the textual approach to the red direction was rejected during
this work for a reason that item carries forward.
