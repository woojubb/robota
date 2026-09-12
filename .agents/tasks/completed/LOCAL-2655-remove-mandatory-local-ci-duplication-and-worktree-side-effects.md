---
title: 'LOCAL-2655: Remove mandatory local CI duplication and worktree side effects'
issue: https://github.com/woojubb/robota/issues/2655
status: done
created: 2026-09-12
priority: high
urgency: now
area: harness verification and execution guidance
depends_on: []
completed: 2026-09-12
---

# LOCAL-2655: Remove mandatory local CI duplication and worktree side effects

## Objective

Remove automatic duplication of the required CI scans job and its hidden worktree side effects.
Keep affected local verification and the existing remote required checks; never label a local
subset as CI-equivalent. This is one prerequisite under Issue #2655, not completion of its inherited
artifact, ownership/migration, or unconditional dependency-scan outcomes.

Owner direction, 2026-09-12, current conversation (verbatim):
"너가 작업하는데 방해가 되는 하네스는 제거하는 방향으로 갈겁니다."
"작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요."
"멀티에이전트는 허용합니다. 워크트리는 여전히 불허합니다"

Spec: `.agents/spec-docs/done/LOCAL-2655-remove-mandatory-local-ci-duplication-and-worktree-side-effects.md`

## Plan

- [x] Remove automatic CI scans repetition, worktree hygiene and full-mirror receipt reuse at pre-push.
- [x] Remove the three local scans-mirror stages and temporary worktree materializer; preserve useful explicit product diagnostics without CI-equivalent claims.
- [x] Align active guidance and required-check local declarations; keep all remote checks and their actual CI execution unchanged.
- [x] Verify focused regressions, affected static scans and formatting, recording their actual scope.

## Verification

Integrated focused verification passed 295/295 tests across eleven inspected files in
`/tmp/robota-2655-local-removal-tests.log`. The staged affected static scan passed 92 checks with one
declared skip in `/tmp/robota-2655-local-removal-scans-staged.log`; this is not pristine CI evidence.
Metadata RED logs are `/tmp/robota-2655-local-ci-map-red.log` and
`/tmp/robota-2655-local-reachability-red.log`. Carson and Nash supplied tool-output RED/GREEN evidence
for the execution and pre-push paths; no real worktree was created or pruned by those checks.

The initial unstaged scan found deleted files still listed by the index, unqualified document
references, and a seven-day-old zero-round execution record. Staging the intentional deletions and
correcting reference metadata resolved the first two. The historical execution record was closed as
abandoned without changing its STRUCT-012 Task or claiming that work was delivered.

## Delivery

PR #2707's first remote scans run failed on the renamed worktree heading's missing enforcement
declaration; its live-repository contract test reported the same cause. Adding the explanation then
exposed a parser false positive: zero-context diff hunks separated the heading from its declaration
at an unchanged blank line. The bounded repair uses three context lines while preventing declaration
borrowing across other headings and existing normative bullets. It adds no gate or required context.
The original local scans read committed HEAD, so their pass did not establish the uncommitted rule
change. Verify this repair at its committed head and record actual results on PR #2707 before merging.

Independent local review passed with MUST 0 / SHOULD 0. The guardian's final DONE verdict passed
after completing test-name references; implementation and already-green verification did not change.
Final commit binding and exact-head remote CI remain delivery requirements before integration.
Record integration evidence on the Issue after it occurs.

Implementation clarification: automatic package test/scenario invocation also reaches a real
worktree fixture in `agent-framework`. Remove that automatic pre-push invocation together with the
CI mirror. Local affected tests remain the implementation owner's explicit responsibility; the
pre-push summary names them as not executed there. No product fixture is deleted or skipped in CI.

The full Issue #2655 conversion is preserved in the existing stash and resumes after this prerequisite.
Live develop protection currently does not apply despite its declared eleven contexts. This change
does not alter remote protection, bypass permissions, freshness policy, or required contexts. Before
an agent merge, inspect actual owning-workflow results for every declared context at the exact head;
missing, failed, cancelled or skipped results are not success. Do not claim automatic remote
enforcement has been repaired. Record this residual operational gap with the PR evidence.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Only repository contributor verification orchestration changes; installed SDK, CLI and
application interactions are unchanged. Harness command behavior is covered by the engineering tests.
