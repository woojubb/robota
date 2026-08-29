---
title: 'INFRA-146: fresh develop fails reference-kind-qualified after backlog record moves'
issue: https://github.com/woojubb/robota/issues/2536
status: done
completed: 2026-08-29
created: 2026-08-29
priority: critical
urgency: now
area: harness documentation reference qualification
depends_on: []
---

# INFRA-146: fresh develop fails reference-kind-qualified after backlog record moves

## Objective

Restore the required `reference-kind-qualified` gate on a clean, current `develop` base by correcting
the two historical references whose kinds are known from live GitHub state. Keep the repair limited
to the affected records; do not weaken the scan or expand its baseline.

## Problem

At `origin/develop` commit `c3c26a1d31c2244acf7ec16ba6a9e2cd7463f886`,
`node scripts/harness/scan-reference-kind-qualified.mjs` exits non-zero with exactly two findings:

- `.agents/spec-docs/done/DOCS-049-terminalize-trans008-docs024-harness124.md:14` uses bare `#2307`.
- `.agents/tasks/completed/HARNESS-123-six-comment-strippers-four-behaviours-and-no-owner-so-a-comment-can-satisfy-a-sc.md:129`
  uses bare `#2258`.

Live GitHub read-back establishes that PR #2307 is merged and issue #2258 is open.
Because this required scan fails on the integration base, subsequent work begins red even when its
own changes are compliant. This is issue #2536 and a `priority:P0` interruption.

## Accepted Recommendation and Decision Authority

Qualify only the two references as `PR #2307` and `issue #2258`, then rerun the individual and full
harness gates. An in-memory counterfactual over all 3,199 tracked Markdown documents showed that
these two substitutions yield no grown, shrunk, unfrozen, or missing baseline entries and make the
scan green. Changing scan policy or baseline data would be broader than the demonstrated defect.

The user explicitly directed:

> 너가 해결해야지. 타당한 근거와 함께 추천안을 제시하면 그게 타당할경우 자동승인합니다.

That instruction approves this grounded P0 interruption: preserve the unfinished issue #2091 work,
resolve its native base blocker issue #2536 first, and then resume issue #2091. It does not approve
any broader scan, baseline, or product change.

The user later narrowed close-out: once the current repair is merged, stop and leave a handoff summary
instead of resuming issue #2091 in this session.

Independent proposal review converged after one correction round:

`ACTIONABLE FINDINGS: 0`

`REVIEW VERDICT: ENDORSE`

The final L2 scope and post-merge session boundary were independently re-reviewed on 2026-08-29:
`ACTIONABLE FINDINGS: 0`; `REVIEW VERDICT: ENDORSE`.

## Scope Boundary

- In scope: the two exact historical-document reference tokens, Task lifecycle evidence, and gate
  verification.
- Out of scope: scan implementation, baseline/freeze data, other historical references, product
  source, APIs, runtime behavior, and issue #2091 implementation.
- Lane: L2 — DOCS-049 is a governed spec record whose existing frontmatter declares L2; the branch
  must use the same declaration even though the textual edit itself is documentation-only.
- Issue #2539 separately records the missing L0 staged-order expression discovered during the first
  landing attempt; changing that guard remains out of scope.

## Plan

- [x] Change bare `#2307` to `PR #2307` in the DOCS-049 completed spec record.
- [x] Change bare `#2258` to `issue #2258` in the HARNESS-123 completed Task record.
- [x] Rerun `reference-kind-qualified` and confirm zero findings.
- [x] Run the relevant Task checks and the full harness scan.
- [x] Record completion evidence, prepare the closing PR, and leave issue #2091 preserved with a
      handoff summary after merge.

## Completion Criteria

- [x] The two known references carry their verified GitHub kinds.
- [x] `node scripts/harness/scan-reference-kind-qualified.mjs` exits zero on the repaired branch.
- [x] The full required harness scan passes without changing scan policy or baseline data.
- [x] The repair is ready for a closing PR, and the post-merge session boundary below names every
      read-back required before this session may terminate.

## Test Plan

1. Before the edit, reproduce exactly the two findings with
   `node scripts/harness/scan-reference-kind-qualified.mjs`.
2. After the edit, rerun that individual scan and require exit code 0.
3. Run Task/frontmatter lifecycle checks for this record.
4. Run `pnpm harness:scan`; treat any residual failure as a failure, not as success by silence.
5. Inspect the final diff to confirm that neither the scan implementation nor baseline data changed.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable — this Task changes only two repository-document reference tokens. It delivers no
product command, API, UI, SDK, output, or runtime behavior that a user can execute. The individual and
full harness scans above are engineering verification and are not presented as user-execution evidence.

Independent scenario-author verdict date: 2026-08-29.

## Post-merge Session Boundary

Repository `done` means the implementation and its gates are ready to land; it does not authorize an
early session stop. This session may terminate only after the PR is read back as `MERGED`, issue #2536
is read back as `CLOSED`, issue #2091's branch/commit/stash are confirmed preserved, and the user
receives a next-session handoff summary. These are close-out checks outside the pre-merge Task DONE
gate.
