---
title: 'HARNESS-113: a new scan must be proven red-then-green; a new orchestration ships unproven'
status: in-progress
created: 2026-08-19
priority: high
urgency: now
area: scripts/harness, .agents/rules
depends_on: [HARNESS-112]
---

# HARNESS-113: prove a loop before registering it

GitHub issue: https://github.com/woojubb/robota/issues/1876

## Objective

Close the asymmetry between the two harness artifact classes. `learning-loop.md` requires a new CHECK to
demonstrably fail on the triggering incident and pass after the fix. A new SKILL — including the 16 that
drive loops — has no proof obligation at all: grepping the rules and skills trees for a
prove-before-automate requirement returns nothing.

The asymmetry is backwards. A wrong scan exits 1 locally and someone reads it. A wrong orchestration fails
by DISPATCHING, spending a fan-out before anyone learns the routing was wrong.

## Spec

`.agents/spec-docs/active/HARNESS-113-a-new-orchestration-ships-unproven.md`

## Plan

- [ ] TC-01: the scan exits 0 on the tree as shipped, all 16 existing loops accounted for by the baseline.
- [ ] TC-02: the scan fails a loop-declaring skill with no baseline entry, no `proof:` line, and no ledger
      entry — and names it.
- [ ] TC-03: the same fixture passes once its ledger holds one entry with a non-null `terminal`.
- [ ] TC-04: `proof: none — <reason>` passes; an empty reason fails.
- [ ] TC-05: a baseline entry that now has a closed run is a finding (shrink-only ratchet).
- [ ] TC-06: an unparseable ledger fails; it is not read as "no runs yet".
- [ ] TC-07: the rule carries `Enforced by:` and `scan-new-rule-declares-enforcement.mjs` exits 0.
- [ ] TC-08: the scan is `covered` under `measurement-provenance`.
- [ ] TC-09: `pnpm harness:scan` exits 0 with `loop-proof` registered.

## Test Plan

Unit tests drive the scan against a fixture skills tree plus a fixture ledger tree, asserting the floor
can fail (TC-02) before asserting it passes (TC-03/04), and asserting the anti-rot direction (TC-05) so
the baseline cannot outlive its need. TC-07 is the repository's own new-rule floor applied to this item's
rule text. Stated ceiling, carried in the scan's pass line: this establishes that a terminal signal was
reached once, not that the run exercised the loop's hard path.

## Progress
