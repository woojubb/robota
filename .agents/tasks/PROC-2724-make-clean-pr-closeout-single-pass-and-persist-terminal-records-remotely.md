---
title: 'PROC-2724: make clean PR closeout single-pass and persist terminal records remotely'
issue: https://github.com/woojubb/robota/issues/2724
status: in-progress
created: 2026-09-13
priority: medium
urgency: soon
area: harness governance and pull-request delivery
depends_on: []
---

# PROC-2724: make clean PR closeout single-pass and persist terminal records remotely

## Objective

Remove the repeated clean-PR closeout work and the structural dead end where terminal facts that
exist only after the PR diff is frozen or merged are required to be appended to a Git-tracked loop
ledger. Preserve the actual merge safety gates while making GitHub the durable, auditable owner of
remote terminal evidence.

**Source:** GitHub issue [#2724](https://github.com/woojubb/robota/issues/2724).

**Reproduction:** A metadata-only PR reaches a zero-finding local review, passes CI, and merges. The
current procedure observes CI more than once, repeats an empty Round B, separately judges successful
job warnings, and then asks the merged branch to append `.agents/loop-runs/post-merge-cycle.jsonl`.
That final record cannot be part of the already-merged PR and remains as local residue or requires a
bookkeeping PR.

**Recommendation:** Keep Round A and all merge gates, but use one structured merge-decision comment
as the terminal record for clean open-PR convergence and one structured issue completion comment as
the post-merge record. Add a bounded readback command that rejects missing, duplicate, stale, or
mis-bound receipts. Retain historical ledger parsing without requiring new post-merge ledger rows.

Combined lifecycle eligibility: eligible; work-kind=enhancement; priority=P1; issue-state=OPEN; child-causes=0; security=none; data-correctness=none; user-decision=none; contract-change=none; owner-count=1

Conversion evidence: issue=https://github.com/woojubb/robota/issues/2724; task=PROC-2724; marker=https://github.com/woojubb/robota/issues/2724#issuecomment-5653672140; marker-readback=2026-09-13T13:48:33Z; priority-removed=2026-09-13T13:48:33Z; base=develop; base-oid=afb07ff35d5be62f626c70e10c21432130515ee3

## Plan

- [ ] TC-01, TC-02: Specify and implement canonical merge-decision and delivery-completion receipt
      parsers, selectors, trusted-comment checks, and bounded GitHub readback.
- [ ] TC-03: Route clean PRs through one remote no-feedback terminal decision and make the merge hook
      consume it without a redundant Round B verdict or ledger entry.
- [ ] TC-04: Make one CI observer own each PR/SHA gate and exclude successful-job informational
      warnings from separate finding-depth work.
- [ ] TC-05: Replace new post-merge Git ledger writes with one neutral completion receipt after
      cleanup while preserving read compatibility for historical ledgers.
- [ ] TC-06: Run the focused tests and affected harness verification.

## Test Plan

- TC-01/TC-02: Run `scripts/harness/__tests__/post-findings-authorization.test.mjs` for receipt grammar,
  uniqueness, trust, ordering, identity binding, and live-state consistency.
- TC-03: Run the focused merge-gate contract tests for the clean no-feedback path.
- TC-04: Run the focused skill/rule contract tests for CI ownership and warning classification.
- TC-05: Run post-merge delivery and plan-order tests for new remote receipts plus legacy read support.
- TC-06: Run the affected harness scan in PR context.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change only governs repository-maintainer PR review, CI observation, merge, and issue
closeout evidence; it does not change a Robota runtime, CLI, provider, API, or other end-user surface
that a product user can execute.
