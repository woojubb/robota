---
title: 'HARNESS-126: the standing-delegation guard reports its refusal on a path nothing exercises'
issue: https://github.com/woojubb/robota/issues/2388
status: todo
created: 2026-08-27
priority: high
urgency: now
area: scripts/harness
depends_on: []
---

# HARNESS-126: the standing-delegation guard's refusal path is never exercised

## Problem

`scan-standing-delegation-evidence.mjs` shipped with RULE-012 and is live in `pnpm harness:scan`.
Its suite passes 23 cases and the scan exits 0. **Neither establishes that it can refuse.**

## Evidence

Reproduced before the report was accepted:

```
CONTROL   unmutated guard + suite                 -> 21 passed
MUTANT    the guard's ONLY findings.push disabled -> 21 passed     <- SURVIVED
          scan under the mutant                   -> exit 0
          ::examined:: 219 approved spec document(s); 1 DIRECT, 0 CLASS, 218 frozen
          (byte-identical to the unmutated output)
RESTORE   guard restored                          -> 21 passed, git status clean
```

The suite called `classifyApproval` ten times and the entry point twice — once for a counter, once
asserting `findings` is **empty**. That last assertion is the defect: the mutant produces an empty
array too, so the case passes either way. Line 310 is the only join between a classification and a
reported refusal, and nothing ever put the scan in a state where a finding was REQUIRED.

## Reproduction condition

Any guard whose suite tests its classifier rather than its entry point, and whose only integration
assertion is that the live tree produces no findings.

## Why this one matters more than its size

RULE-012 exists because a gate's criterion and its own examples disagreed, and every session resolved
the contradiction privately — an unfalsifiable check in the approval path. **The guard written to
close that carried an unfalsifiable check in its reporting path.**

Fourth instance of one shape in a day, three of them inside this work unit:

1. `M7` — the later-withdrawal branch killed zero cases before its fixture was written.
2. `SEC-015` — dropped from the population unjudged; a count of "no findings" concealed it.
3. `frozen_diff_refusal` — allows the push when its `gh` reads fail, with no output distinguishing
   "checked and clear" from "could not check" (issue #2384).
4. This.

In every one, **the absence of a check and a check that passed are indistinguishable at the output.**

## Test Plan

- One case through the scan entry point asserting the finding IS reported for a document that must be
  refused.
- One case asserting it is NOT reported for compliant documents — without it, the first is satisfied
  by a scan that refuses everything.
- Applied-check mutation as the acceptance test: disabling the refusal must fail the suite, and
  making it refuse unconditionally must also fail the suite.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable**. This changes no product behaviour — it adds two test
cases to a repository verification scan. No package, app, CLI command, TUI surface or published API
changes, so there is no command a product user could run to observe a difference. The verification
surface is the harness gate: the mutation acceptance test recorded above.

## Bound spec document

`.agents/spec-docs/active/HARNESS-126-the-scan-refusal-path-is-never-exercised.md`
