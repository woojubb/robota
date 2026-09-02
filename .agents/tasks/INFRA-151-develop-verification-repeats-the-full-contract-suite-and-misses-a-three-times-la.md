---
title: 'INFRA-151: develop verification repeats the full contract suite and misses a three-times latency target'
issue: https://github.com/woojubb/robota/issues/2489
status: in-progress
created: 2026-09-03
priority: critical
urgency: now
area: scripts/harness, .github/workflows, verification policy
depends_on: []
---

# INFRA-151: develop verification repeats the full contract suite and misses a three-times latency target

## Objective

Reduce the median elapsed time from a push of a develop-targeting pull request to all required checks
being conclusive to at most one third of the measured 6.4-minute baseline (128 seconds), without
turning an unknown applicability result, test failure, cancelled shard, or missing review into a pass.

Issue #2489 reported intermittent exit 137 in the pre-push contract suite. The 2026-09-03
remeasurement found the wider cause: the now-224-file repository-contract tier is executed in both
local pre-push and PR CI, its CI step alone has a 249-second p50, and pull-request CodeQL adds a
4.07-minute p50 predecessor to the required review verdict. The original 54-second local cost cited
when the policy was introduced is no longer representative.

The user explicitly authorized repository-wide CI policy work with “이제부터는 ci들을 불필요하다고
생각하면 조건적으로 발동하게 한다거나 아예 제거하는 쪽으로 할거니까 측정해봐” and set the
completion target with “지금보다 develop브랜치의 작업속도를 3배 이상 빠르게 만들 때까지 반복해서
개선해 보세요.” This authorization covers the CI workflow and pre-push policy changes in this Task;
it does not authorize weakening a failure into success or merging to `main`.

## Plan

- [ ] TC-01 — Register every repository-contract file with validated declared inputs or an always-run
      reason, rejecting incomplete or malformed inventory.
- [ ] TC-02 — Select changed tests, matching product/docs/policy inputs, static-import dependants, and
      both sides of renames with a machine-readable reason.
- [ ] TC-03 — Route unreadable, empty, unmatched, invalid, control-plane, and zero-selection cases to the
      complete plan instead of success.
- [ ] TC-04 — Shard the complete fallback deterministically across four shards while preserving exact-once
      membership and the isolated contract boundary.
- [ ] TC-05 — Keep the required `scans` context stable, run hermetic and contract work in parallel, and
      aggregate every non-success conclusion fail-closed.
- [ ] TC-06 — Make default pre-push and pull-request CI consume the same planner while retaining an
      explicit complete local route.
- [ ] TC-07 — Keep required pull-request CodeQL, use JavaScript/TypeScript `build-mode: none`, remove
      Autobuild, and measure the resulting Actions mode and cache reuse.
- [ ] TC-08 — Condition automatic `scans-full` on control-plane/release changes while retaining manual
      dispatch.
- [ ] TC-09 — Add timeout, cancellation, signal, selector/shard failure, and worktree-immutability
      regression coverage.
- [ ] TC-10 — Record three successful exact-head Actions samples with required-check p50 at or below 128
      seconds and finish the affected, complete, and CI-equivalent verification set.
- [ ] TC-11 — Classify every root pnpm script exactly once and require each selected workspace operation
      to have a real script or an explicit capability N/A reason.
- [ ] TC-12 — Implement ownership-first scopes for build, test, typecheck, lint, explicit
      consumer-build, and directly owned capability suites with fail-closed full fallback.
- [ ] TC-13 — Route ordinary pull-request build/quality/example work through affected commands while
      preserving full verification for control-plane, release, manual, and uncertain plans.

## Test Plan

- Focused Vitest tests cover declared-input selection, unknown-input expansion, shard completeness,
  deterministic membership, isolated-test handling, pre-push routing, and fail-closed aggregate
  conclusions.
- Workflow contract tests parse `ci.yml`, `review-gate.yml`, `codeql.yml`, and `scans-full.yml` and prove
  the stable required contexts, required CodeQL predecessor, no-build extraction, and routed full-scan
  responsibilities.
- Workspace planner/executor tests enumerate every root script and operation capability, prove each
  graph traversal independently, and reject missing package-script results rather than treating an
  absent `pnpm --if-present` invocation as success.
- Run the affected harness scan suite and the repository's CI-equivalent verification once on the final
  tree; do not repeat a stronger successful gate with weaker commands.
- Rerun the final PR workflows until three successful exact-head observations exist, then compute the
  p50 from GitHub job timestamps and compare it with the 128-second target.

## User Execution Test Scenarios

Not applicable: this changes repository verification latency and no runnable product behavior.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Not applicable because this Task changes internal repository verification, GitHub Actions
status checks, and maintainer pre-push behavior only; it introduces no runnable Robota CLI, TUI, browser,
or public SDK behavior for an end user to execute.
