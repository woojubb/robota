---
title: 'LOCAL-2655: Remove mandatory local CI duplication and worktree side effects'
issue: https://github.com/woojubb/robota/issues/2655
status: todo
created: 2026-09-12
priority: high
urgency: now
area: harness verification and execution guidance
depends_on: []
---

# LOCAL-2655: Remove mandatory local CI duplication and worktree side effects

## Objective

Remove automatic duplication of the required CI scans job and its hidden worktree side effects.
Keep affected local verification and the existing remote required checks; never label a local
subset as CI-equivalent. This is one prerequisite under #2655, not completion of its inherited
artifact, ownership/migration, or unconditional dependency-scan outcomes.

Owner direction, 2026-09-12, current conversation (verbatim):
"너가 작업하는데 방해가 되는 하네스는 제거하는 방향으로 갈겁니다."
"작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요."
"멀티에이전트는 허용합니다. 워크트리는 여전히 불허합니다"

Spec: `.agents/spec-docs/todo/LOCAL-2655-remove-mandatory-local-ci-duplication-and-worktree-side-effects.md`

## Plan

- [ ] Remove automatic CI scans repetition, worktree hygiene and full-mirror receipt reuse at pre-push.
- [ ] Remove the three local scans-mirror stages and temporary worktree materializer; preserve useful explicit product diagnostics without CI-equivalent claims.
- [ ] Align active guidance and required-check local declarations; keep all remote checks and their actual CI execution unchanged.
- [ ] Verify focused regressions, affected static scans, final review, and record remote delivery evidence.

## Delivery

The full #2655 conversion is preserved in the existing stash and resumes after this prerequisite.
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
