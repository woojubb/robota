---
title: 'HARNESS-127: plan-order requires a spelling its catalogue never writes'
issue: https://github.com/woojubb/robota/issues/2378
status: in-progress
created: 2026-08-27
priority: high
urgency: now
area: scripts/harness
depends_on: []
---

# HARNESS-127: plan-order requires a spelling its catalogue never writes

## Problem

`scripts/harness/scan-user-execution-plan-order.mjs` decides whether a GATE-IMPLEMENT evidence entry
counts as a complete planning checkpoint. One of its four structural tests is a token no reader of the
document it enforces would know to write:

```js
/whole-worktree/i.test(body); // scan-user-execution-plan-order.mjs:435
```

The criterion it enforces, `.agents/specs/gate-catalogue.md` § GATE-IMPLEMENT, is spelled without the
hyphen — and so is the rule that owns the checkpoint. A guardian that quotes the criterion verbatim
produces an entry the scan refuses; one that paraphrases with a hyphen passes.

## Evidence

Re-measured on `develop` `6802df180` (2026-08-27 22:51 KST), not taken from the issue:

```
$ grep -n "whole" scripts/harness/scan-user-execution-plan-order.mjs
435:    /whole-worktree/i.test(body);
$ grep -c 'whole-worktree' .agents/specs/gate-catalogue.md
0
$ grep -n -i 'whole worktree\|whole-worktree' .agents/specs/gate-catalogue.md
223:- [ ] The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the
$ grep -n 'whole worktree' .agents/rules/backlog-execution.md
377:`DONE-GATE-STAGE-1` PASS. GATE-IMPLEMENT judges that outcome while the whole worktree contains no change
```

Every committed checkpoint that passed wrote the hyphen: 4 spec documents carry `whole-worktree`
(`git grep -il 'whole-worktree' -- .agents/spec-docs`), and the scan's own test fixture writes
`Whole-worktree precondition:`. The spelling that passes is learned from earlier passes, never from
the catalogue. The suite's own binding test (`scan-user-execution-plan-order.test.mjs:1940`) asserts
the RULE contains `whole worktree` — the unhyphenated form — three lines from the scan that refuses it.

## Reproduction condition

Any GATE-IMPLEMENT PASS entry whose worktree line quotes the catalogue (`whole worktree`) rather than
the fixture (`Whole-worktree`). The refusal message names the missing PASS, not the missing hyphen —
which is why ARCH-112 spent three diagnostic rounds on it (issue #2378).

## Why it is worth fixing rather than working around

The incentive runs backwards: the gate rule asks guardians to quote criteria exactly, and the check
punishes exactly that. The fix is small; the recurrence is what matters. The catalogue and the scan
can drift apart again the next time either is edited, so the change must bind the scan's accepted
vocabulary to the catalogue's actual wording, not merely widen a regex once.

## Depth verdict

`finding-depth-triager` (2026-08-27): **FOUNDATIONAL**. The cause is that GATE-IMPLEMENT's and
DONE-GATE-STAGE-1's machine-checked evidence forms are declared only in the scan and its fixture,
never in the catalogue or rule that own the gates; a second undeclared form (`surface=…;
surface-rationale=…` keys, `completeStageOneEntry` line 778) sits in the same file. Root item: **HARNESS-128**
(`.agents/tasks/HARNESS-128-checkpoint-evidence-forms-are-declared-only-in-the-scan.md`, registered as
issue #2394). This Task lands as a **labelled containment** under it: the smallest change that makes
the catalogue's wording acceptable, no new abstraction, and `Contained — HARNESS-128.` opening the
regex line's comment and named in the commit body.

Filed separately, not folded in: the refusal message names a missing PASS rather than the failed
structural test — issue #2395 (a different cause with its own tests). Issue issue #2376 — the same criterion
against `AUTO_GENERATED_CHURN` — is a different cause and stays its own item.

## Recommendation gate

`proposal-reviewer`, three rounds on 2026-08-27: REVISE (F1–F5: TC-03 extraction could be circular,
the wrapped Evidence-to-record phrase must be bound too, A3's stated reason was wrong, A4 must be
filed) → REVISE (the containment label must be a backlog ID, TC-03 split so mutation (c) has a victim,
the test's worktree line must replace the fixture line and keep the path tokens) →
**REVIEW VERDICT: ENDORSE** (2026-08-27), with one procedural sentence added to the spec's sequencing
note. Alternative chosen: A2, as a labelled containment under HARNESS-128.

## Test Plan

- A case through `findHistoryFindings` where the checkpoint's worktree line quotes the catalogue
  criterion verbatim (`The whole worktree contains no …`) — must produce no finding. Red before the
  fix.
- A control where the worktree line carries neither spelling — must still produce the checkpoint
  finding. Without it, the first case is satisfied by a scan that accepts anything.
- Two binding cases (`it.each`) that locate the GATE-IMPLEMENT worktree criterion item and the
  Evidence-to-record instruction (soft-wrap intact) in `.agents/specs/gate-catalogue.md` at test time
  and feed each, alone, as the checkpoint's worktree line — so the catalogue and the scan cannot
  drift apart silently again.
- Applied-check mutation as the acceptance test: restoring `/whole-worktree/i` must fail the suite,
  and replacing the test with one that accepts any body must also fail the suite.
- `pnpm harness:scan` exits 0 on the branch; the existing 79 cases in the file still pass, plus the
  four added (83).

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable**. This changes one regular expression in a repository
verification scan and adds test cases to its suite. No package, app, CLI command, TUI surface or
published API changes, so there is no command a product user could run to observe a difference. The
verification surface is the harness gate — the binding test and the mutation acceptance test above.

## Bound spec document

`.agents/spec-docs/active/HARNESS-127-plan-order-requires-a-spelling-its-catalogue-never-writes.md`
