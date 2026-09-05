---
title: 'INFRA-170: record gate audit dispositions before any deletion'
status: in-progress
created: 2026-09-06
priority: medium
urgency: soon
area: repository governance
depends_on: []
documentation_batch_approval: DIRECT
documentation_batch_instruction: '그런 게이트가 다 꼭 필요한 것들인지 모두 전수 검사해서 과감하게 삭제할 예정입니다.'
---

# INFRA-170: record gate audit dispositions before any deletion

## Objective

Process the full gate audit in `/tmp/robota-gate-audit.md` into an explicit repository decision before
any gate is deleted or consolidated.

## Plan

- [ ] Classify every audited gate as maintain, integrate, or conditional reduction.
- [ ] Record the no-immediate-deletion decision and the prerequisites for each candidate.
- [ ] Preserve the complete external audit at `/tmp/robota-gate-audit.md` for the operator.

## Decision

The audit found no immediately safe deletion. Current red signals must be diagnosed or replaced,
not removed to make scans green. Protected-branch, review-binding, security, release, product
regression, platform-specific, task-evidence, terminal-state, evaluator-isolation, and archival
protections remain required.

Candidate reductions are conditional only: transcript quantification may move to a transcript-bearing
host job; historical reference checks may narrow after migration; task lifecycle evaluators may be
unified after equivalent red coverage; global file-size ratcheting may be scoped after evaluator
decomposition; advisory whitebox and patch coverage may move to owned reports; security and benchmark
jobs may be integrated only with equivalent visibility and a manual fallback.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository governance documentation; it changes no runnable product surface
that an end user can execute directly.

## Test Plan

- `node scripts/harness/check-task-archival.mjs`
- `pnpm harness:scan -- --affected --context pr --base origin/develop`
- Read back `/tmp/robota-gate-audit.md` and verify all 158 registered scans have a disposition.
