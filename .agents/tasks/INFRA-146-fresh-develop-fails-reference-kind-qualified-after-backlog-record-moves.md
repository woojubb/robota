---
title: 'INFRA-146: fresh develop fails reference-kind-qualified after backlog record moves'
issue: https://github.com/woojubb/robota/issues/2536
status: todo
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

Independent proposal review converged after one correction round:

`ACTIONABLE FINDINGS: 0`

`REVIEW VERDICT: ENDORSE`

## Scope Boundary

- In scope: the two exact historical-document reference tokens, Task lifecycle evidence, and gate
  verification.
- Out of scope: scan implementation, baseline/freeze data, other historical references, product
  source, APIs, runtime behavior, and issue #2091 implementation.
- Lane: L0 — documentation-only correction with no source or L2-controlled path change.

## Plan

- [ ] Change bare `#2307` to `PR #2307` in the DOCS-049 completed spec record.
- [ ] Change bare `#2258` to `issue #2258` in the HARNESS-123 completed Task record.
- [ ] Rerun `reference-kind-qualified` and confirm zero findings.
- [ ] Run the relevant Task checks and the full harness scan.
- [ ] Record completion evidence, merge the repair, close issue #2536, and resume issue #2091.

## Completion Criteria

- [ ] The two known references carry their verified GitHub kinds.
- [ ] `node scripts/harness/scan-reference-kind-qualified.mjs` exits zero on the repaired branch.
- [ ] The full required harness scan passes without changing scan policy or baseline data.
- [ ] Issue #2536 is closed by the merged repair and issue #2091 can resume from a green base.

## Test Plan

1. Before the edit, reproduce exactly the two findings with
   `node scripts/harness/scan-reference-kind-qualified.mjs`.
2. After the edit, rerun that individual scan and require exit code 0.
3. Run Task/frontmatter lifecycle checks for this record.
4. Run `pnpm harness:scan`; treat any residual failure as a failure, not as success by silence.
5. Inspect the final diff to confirm that neither the scan implementation nor baseline data changed.

## User Execution Test Scenarios

Not applicable. This Task corrects repository-document reference syntax only; it does not change a
product command, API, output, or runtime behavior that a user can execute. The individual and full
harness scans above are engineering verification and are not presented as user-execution evidence.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`
