---
title: 'INFRA-2664: Normalize workflow-dispatch branch inputs through one resolvable-ref owner'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-20
priority: medium
urgency: soon
area: .github/workflows/ci.yml, scripts/harness
depends_on: []
---

# INFRA-2664: Normalize workflow-dispatch branch inputs through one resolvable-ref owner

## Objective

Make the manually dispatched CI contract true for both input forms it advertises: a caller may pass
either a branch name or a commit SHA for `base_ref` and `head_ref`, and every downstream consumer
receives one canonical pair of resolvable refs or immutable commit OIDs.

## Problem

The DATA-2664 stacked pull request exposed a pre-existing workflow-dispatch defect. CI run
[`35486374808`](https://github.com/woojubb/robota/actions/runs/35486374808) accepted
`fix/2664-gate-correctness` and `fix/2664-checkpoint-inventory` as documented branch inputs, but
checkout created a local branch for the head while the base existed only as
`origin/fix/2664-gate-correctness`. At least the dependency-audit and commitlint jobs then consumed
the raw base string directly and failed with `Not a valid object name` and `ambiguous argument`
errors before evaluating the DATA change.

This is not a DATA-2664 implementation defect:

- the exact parent and child lockfile blobs are identical;
- all six child commits pass commitlint when compared through resolvable remote refs;
- the same ref-resolution failure is present in earlier runs `34252976861` and `34252677949` after
  commit `bf1f459ee`;
- an independent depth review classified the cause as `FOUNDATIONAL`, because roughly ten workflow
  consumers independently interpret the same unnormalised inputs.

The finding is registered under GitHub
[issue #2664](https://github.com/woojubb/robota/issues/2664), whose gate-correctness scope contains the
failed enforcement path. It is deliberately re-planned here rather than patched in DATA-2664.
Registration evidence: [foundational finding record](https://github.com/woojubb/robota/issues/2664#issuecomment-5747336973).

## Directions Considered

1. Patch only dependency-audit and commitlint to prepend `origin/`. Rejected: commit SHAs are also
   accepted inputs, and per-job interpretation would preserve multiple owners.
2. Require callers to pass only commit SHAs. Rejected: that silently narrows the workflow's current
   branch-or-commit contract and leaves misleading input documentation.
3. Resolve both inputs once after checkout, fail loudly when either cannot resolve, and expose the
   canonical OIDs to every job. Recommended: one owner can cover local branches, remote-tracking
   branches, tags, and SHAs while downstream comparisons consume an immutable pair.

## Disposition

**Re-plan as an independent Task.** DATA-2664 may use the workflow's already-supported immutable-SHA
input form to validate its exact base/head pair; that is evidence for DATA-2664, not containment or a
claim that this defect is fixed.

## Plan

- [ ] Inventory every `workflow_dispatch` consumer of `base_ref` and `head_ref` and define the
      canonical resolution/failure contract in one owner.
- [ ] Add falsifying tests for branch names that exist only as remote-tracking refs, direct commit
      SHAs, tags if retained by the contract, and unresolvable inputs.
- [ ] Resolve the input pair once and route all affected CI jobs through the canonical outputs.
- [ ] Run the workflow with both branch-name and immutable-SHA inputs and show equivalent commit
      ranges and green gates.

## Test Plan

- Unit or harness tests prove branch, SHA, and invalid-ref behavior without requiring a live runner.
- Workflow lint and affected harness scans pass.
- Two manual dispatches over the same base/head pair—one with branch names and one with SHAs—select
  the same commits and complete the same required jobs.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This Task changes repository-internal GitHub Actions ref resolution and has no Robota CLI,
TUI, browser, public SDK, or installed-package behavior that an end user can execute. Branch/SHA
dispatch equivalence remains engineering verification owned by the Test Plan above.
