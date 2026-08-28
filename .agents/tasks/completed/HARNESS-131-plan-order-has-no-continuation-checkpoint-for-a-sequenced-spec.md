---
title: 'HARNESS-131: plan-order recognises only a first checkpoint, so the second PR of a spec whose delivery is sequenced across PRs cannot pass the scans check'
issue: https://github.com/woojubb/robota/issues/2418
status: done
completed: 2026-08-28
created: 2026-08-28
priority: high
urgency: now
area: scripts/harness
depends_on: []
---

# HARNESS-131: plan-order has no continuation checkpoint for a sequenced spec

## Problem

`scripts/harness/scan-user-execution-plan-order.mjs` recognises exactly one shape of planning
checkpoint (`isCheckpointTransition`, lines 813–824): the paired Task and spec go from
not-`in-progress` to `in-progress`, the parent spec holds no `### [GATE-IMPLEMENT] — ✅ PASS`
entry, and the child spec holds exactly one, bound to the Task's exact PLAN signal. Every
implementation path on a branch needs such a checkpoint as an ancestor inside the branch's own
`base..HEAD` range, on the history path (the `scans` required check) and on the staged path
(pre-commit). A spec approved for delivery across two sequenced PRs is `in-progress` with one PASS
at the base of its second branch, so no commit on that branch can satisfy the definition: the
second PR's implementation is refused as "no planning checkpoint ancestor", by construction.

## Evidence

Measured 2026-08-28 on `origin/develop` `c59e9d028`. RULE-016 (issue #2403) was approved as one
recommendation gate with two sequenced PRs (spec § "Delivery — two sequenced PRs, and why": the
`review-gate` job loads the judge from the base revision, so the step cannot land in the PR that
adds the script). PR #2409 (PR 1) is merged; the spec is `active/`, `status: in-progress`, one
GATE-IMPLEMENT PASS. On a branch cut from `c59e9d028` with PR 2's twelve paths staged (the held patch `pr2.patch`: ten modified files, the new memory record, and the `verify-like-ci` test corrected after the first run — re-measured 2026-08-28 against that patch):

```
$ HARNESS_BASE_REF=origin/develop node scripts/harness/scan-user-execution-plan-order.mjs --staged
✗ user-execution-plan-order: staged implementation has no planning checkpoint ancestor.
::examined:: 12 staged path(s)
```

The history path has the same outcome once committed (`implementation exists with no planning
checkpoint`), which is what the `scans` required check runs. Five gate runs on that spec (GATE-WRITE
×3, GATE-APPROVAL, GATE-IMPLEMENT) did not ask whether the delivery the spec states is one the
checkpoint scan can accept; the catalogue's GATE-IMPLEMENT takes `approved` as its only input state.

## Reproduction condition

Any spec whose § Decision sequences delivery across more than one PR, at the branch of its second or
later PR: the pair is already `in-progress` at the base, with a GATE-IMPLEMENT PASS.

## Depth

The defect is in the scan's definition of a checkpoint, which has one form — LOCAL to the scan and
the catalogue section that owns the form. The evidence forms being declared in the scan rather than
the catalogue is HARNESS-128 (issue #2394), unchanged here: the continuation's status line is
declared in the catalogue text AND accepted by the parser, the same pattern as the first form.

## Test Plan

- Fixture (history path): a base holding an `in-progress` pair with one bound PASS; a branch whose
  first commit is pair-only and adds a second bound PASS whose status line is the continuation form
  → accepted as the checkpoint; an implementation commit after it → no finding. Red before the fix
  (`implementation exists with no planning checkpoint`).
- Fixture (refusals survive): implementation committed before the continuation → refused as changed
  before the planning checkpoint; two
  continuation commits on one branch → `multiple planning checkpoint candidates`; a second PASS
  whose status line is the first form (`approved → in-progress`) on an `in-progress` parent → not a
  checkpoint; a continuation whose Task changes the PLAN signal → not a checkpoint.
- Staged path: with the continuation committed, staged implementation is accepted; without it, the
  refusal measured above is unchanged; the continuation itself staged is accepted; a staged first-form
  entry on an in-progress pair is refused with a message naming both forms.
- Live: in a throwaway worktree at this branch's tip after the fix commit, `HARNESS_BASE_REF=<tip>`,
  a continuation commit for RULE-016 (its real spec, a second GATE-IMPLEMENT PASS in continuation
  form) committed through the pre-commit hook, then PR 2's held patch staged → the scan accepts,
  examined count and exit code recorded.
- Catalogue binding: the test asserts the continuation status line the scan accepts is the one the
  catalogue's GATE-IMPLEMENT section declares. The rule's MUST sentence, the pipeline row and the
  orchestrator's Phase 2.5 entry are present (grep, recorded); `new-rule-declares-enforcement` passes.
- Applied-check mutation: removing the continuation clause makes the TC-01, TC-02 and TC-03 cases
  red (the TC-02 before-continuation arm's premise is that the continuation is the checkpoint) and
  no case outside the HARNESS-131 cases; `pnpm harness:scan` exit 0.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable** — confirmed independently by the scenario author.
One additional checkpoint form in a repository verification scan (the `scans` required check and the
pre-commit hook), its fixture, and the catalogue sentence that declares it; no package, app, CLI, TUI
or published API changes, so no product surface exists for a user to drive. Seam check: the
capability (recognising a continuation GATE-IMPLEMENT entry) is reachable only through the scan's own
invocation, which is engineering verification, not an unexposed user-facing capability. The
verification surface is the fixture, the live worktree run (TC-04), and the mutation (TC-06).

## Bound spec document

`.agents/spec-docs/done/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md`
