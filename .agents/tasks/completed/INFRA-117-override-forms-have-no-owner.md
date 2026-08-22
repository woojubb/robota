---
title: 'INFRA-117: a hook escape hatch is declared in five places and compared against none'
status: done
created: 2026-08-20
completed: 2026-08-20
priority: high
urgency: now
area: .claude/hooks, scripts/harness
depends_on: []
---

# INFRA-117: the accepted form is derived from the hook, not restated beside it

## Objective

Issue #1904. Every guard in `.claude/hooks/` declares an escape hatch. What it ACCEPTS is decided by
the code reading the variable; what it is DECLARED to accept was written by hand in up to five other
places, and nothing compared any of them to the code. Both drift directions were live at once.

## Measured before anything was written

Fourteen override variables across 14 hooks, and **three distinct accepted forms** — not one:

| form             | variables                                                                      | how the hook reads it                         |
| ---------------- | ------------------------------------------------------------------------------ | --------------------------------------------- |
| inline only      | `MERGE_GATE_ACK`, `PRE_PUSH_ALLOW_UNREVIEWED`, `WORKTREE_CWD_GUARD_ALLOW_MAIN` | greps the command STRING                      |
| either           | the six `BRANCH_GUARD_ALLOW_*`, `BULK_EDIT_ACK`, `FOREGROUND_WAIT_ACK`         | both, via `stmt_override` or a pair of checks |
| environment only | `HOOK_EDIT_ACK`, `LOCKFILE_CHURN_ACK`                                          | `${VAR:-}` from its own environment           |

The forms are not interchangeable and have opposite lifetimes. Inline excuses only the statement it
prefixes; an exported variable stays armed for every later command until unset. A PreToolUse hook
runs as a separate process, so an inline assignment on the agent's command never reaches one that
reads its environment — the command runs, the guard refuses anyway, and the reader concludes the
guard is broken rather than the declaration.

### What the scan found on its first run

Four live defects, wider than the two issue #1904 named:

| finding                                             | variable                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| declared INLINE, accepted only from the environment | `LOCKFILE_CHURN_ACK` (`pre-push-check.sh` said "inline" in its own refusal) |
| accepted, declared nowhere outside its hook         | `BRANCH_GUARD_ALLOW_BADNAME`                                                |
| accepted, declared nowhere outside its hook         | `BRANCH_GUARD_ALLOW_MAIN_MERGE`                                             |
| accepted, declared nowhere outside its hook         | `WORKTREE_CWD_GUARD_ALLOW_MAIN`                                             |

`AGENTS.md`'s "Each has a documented **inline** override" was false for two of the fourteen and
understated eight more.

## Approach

The accepted forms are **derived from the hook source**, never listed. A hand-kept list of accepted
forms would be a sixth copy of exactly the thing that drifted, and it would drift the same way — one
edit to a hook, none to the list, nothing comparing them.

`hook-overrides.mjs` owns the derivation. `scan-hook-override-declarations.mjs` compares every
declaration site — `AGENTS.md`, `.agents/rules/*.md`, and the hook's own refusal messages — against
it, in both directions.

`git-branch.md` § "Which Form An Override Takes" is the declaration the scan judges. It says on
itself that it is not the authority: the hook source is.

## Plan

- [x] TC-01: every override variable and its accepted form(s) derived from 14 hook files.
- [x] TC-02: an INLINE claim for an environment-only hatch is refused.
- [x] TC-03: a hatch accepted by a hook and declared in no rule is refused.
- [x] TC-04: an indirect acceptor (`stmt_override`) resolves to both forms, so six variables are not
      reported as accepting nothing.
- [x] TC-05: a declaration naming the variable WITHOUT claiming a form passes.
- [x] TC-06: prose proximity is not read as a form claim.
- [x] TC-07: the four live findings are fixed and the scan passes.
- [x] TC-08: the counter is asserted exactly, and again after a second run of the finder.
- [x] TC-09: `pnpm harness:scan` green (128 passed, 3 skipped).
- [x] TC-10: `pnpm harness:pre-push` green, and CI clean on PR #1917.

## Test Plan

Fixture sources rather than the real hooks: a case pinned to `pre-push-check.sh` would fail the day
that hook is reworded, which is drift in the test rather than in the subject.

The cases that carry the most weight are the two FALSE POSITIVES the first cut produced, because each
was a detector claiming a form claim where the text made none:

- `HOOK_EDIT_ACK` was reported as declared-inline because its refusal reads
  `HOOK_EDIT_ACK=1 (git-branch.md)` — a citation, not a command line. The hook says "in the
  environment" two lines above, correctly.
- `MERGE_GATE_ACK` was reported as declared-exported because a wrapped paragraph put the variable on
  the same source line as a sentence about the environment form. Where prose happens to wrap is not a
  claim.

A scan that guesses at prose produces findings whose fix is to reword something no reader ever
misread. Both detectors are now explicit-only, and both false positives are pinned as passing cases.

## User Execution Test Scenarios

**Scenario — the declaration and the code disagree**

- Prerequisites: this repository, no build needed.
- Steps: edit `.agents/rules/git-branch.md` and change the `LOCKFILE_CHURN_ACK` row's form from
  `environment` to `inline`, then run `pnpm harness:scan:hook-override-declarations`.
- Expected: a `[wrong-form]` finding naming the variable and saying the hook reads it from its own
  environment. Revert the edit and it passes.
- Evidence: run 2026-08-20 — the probe produced exactly that finding, and the restore returned the
  scan to green.

**Scenario — a new hatch nobody declared**

- Steps: in any hook, read a new `${SOMETHING_ACK:-0}`, then run the scan.
- Expected: an `[undeclared]` finding naming the hook.
- Evidence: run 2026-08-20 — injecting `BRAND_NEW_HATCH_ACK` into `no-foreground-wait.sh` produced
  `- [undeclared] BRAND_NEW_HATCH_ACK: accepted by no-foreground-wait.sh …`, and the restore returned
  the scan to green.

## Progress

### 2026-08-20

Filed as issue #1904 from review of pull request #1886, as FOUNDATIONAL: that pull request had
corrected one of four copies of a declaration and left three.

Two detectors had to be narrowed after measuring them against the real tree, and both narrowings are
the same lesson — a detector that reads prose loosely reports drift that is not there, and the cost
lands on whoever rewords the sentence to make a scan happy without understanding why.

The derivation had to be widened once in the other direction: the first inline detector required
`[[:space:]]` immediately beside `NAME=1` and so missed `merge-gate.sh` and `pre-push-check.sh`,
whose acceptors put a capture group between them. Checking both directions is what surfaced it —
those two hooks came back accepting NOTHING, and a hook that accepts nothing is a finding rather than
a quiet zero.
