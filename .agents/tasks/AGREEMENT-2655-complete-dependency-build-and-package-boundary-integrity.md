---
title: 'AGREEMENT-2655: Complete dependency build and package-boundary integrity'
issue: https://github.com/woojubb/robota/issues/2655
status: todo
created: 2026-09-12
priority: high
urgency: now
area: workspace build and verification
children: [INFRA-2655, ARTIFACT-2655, BOUNDARY-2655]
depends_on: []
---

# AGREEMENT-2655: Complete dependency build and package-boundary integrity

## Objective

Resolve the full four-source register of Issue #2655, including Issue #2154, Issue #2490 and Issue #2653.
Completion requires item-by-item delivery evidence, not just a passing mapping audit.

## Plan

- [ ] Verify Issue #2653's exact clean, framework-only affected build/test acceptance using the already-landed fix; do not substitute a global build or planner-only result.
- [ ] Complete integrated dependency scans and advisory reconciliation (INFRA-2655).
- [ ] Deliver complete transactional workspace artifacts (ARTIFACT-2655).
- [ ] Classify shared files across the repository and migrate package-specific content (BOUNDARY-2655).
- [ ] Prepare item-by-item acceptance evidence covering every source outcome.

## Delivery

Verify all deliveries on origin/develop and close Issue #2655 only after every source outcome holds.

## Children

- [x] INFRA-2655 — done — `.agents/tasks/completed/INFRA-2655-scan-integrated-dependencies-without-manifest-changes.md`
- [ ] ARTIFACT-2655 — in-progress — `.agents/tasks/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`
- [ ] BOUNDARY-2655 — todo — `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`

## Test Plan

Inspect child regressions, actual build/scan execution, merged commits and original source criteria.
Neither decomposition nor a source Issue's CLOSED state proves delivery.

## Authorization and baseline

User instructions (verbatim):

```text
#2655 이슈를 처리하고 origin/develop 브랜치에 머지할 때까지 반복해서 처리 완료 해줘.
이 깃헙 이슈를 이번에 닫는걸 목표로 하고 #2655 안에 모든 이슈를 처리해야 합니다.
```

Current owner instructions (verbatim):

> 멀티에이전트는 허용합니다. 워크트리는 여전히 불허합니다

> 작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요.

Partition delegated work without duplicate assignments. Only actual independent assessments may be
attributed as independent review. Repair demonstrated rule defects through scoped amendments and
regression evidence; this authorization does not waive valid verification or permit worktrees.

At fee73c215, affected builds include verification dependencies and the workspace-affected suite
passes 27/27 tests. The lockfile resolves xmldom 0.9.12, browserslist 4.28.9, fast-uri 3.1.7 and qs
6.16.0; these versions are evidence to revalidate, not a fresh vulnerability verdict. Full security
scans are dispatch-only. Root build still omits CLI web assembly. Issue #2490 requires actual repository-wide
classification and migrations, not just a new checker.

Current read-only validation at `6bfa55f7c9192320a48bce719c6bac5f5b8a73fa` finds those planner inputs
unchanged and selects fifteen packages, including analytics and replay, without global fallback.
The [original PR #2694 CI](https://github.com/woojubb/robota/actions/runs/34420460000/job/102694607403)
built both producers and passed the three reported framework test files, but used global fallback.
Neither that execution nor the historical 27/27 unit result proves the requested clean partial-build
scenario. Keep that runtime acceptance outstanding; no duplicate graph implementation is planned.

Prerequisite RULE-2655 was independently reviewed and delivered by PR #2704 at
`a4c88243cdd3adefdea32e779074c74b94b5a08d`. All eleven declared checks passed before merge and the
remote tree was independently verified. The repair reconciles named partial deliveries; it does not
complete any of the three outstanding original source outcomes.

The read-only analyses identified copied-artifact reverse propagation and true atomic replacement as
ARTIFACT-2655 design obligations, and text-read versus execution dependencies plus real package-specific
migrations as BOUNDARY-2655 obligations. Their detailed child plans must preserve these findings, not
replace the original acceptance criteria with a smaller checker-only implementation.

Current integration base is `6bfa55f7c9192320a48bce719c6bac5f5b8a73fa`. PR #2706 removed an archive regression's Issue-wide prohibition; PR #2707 removed automatic local CI duplication and worktree side effects while retaining all eleven actual remote check owners. Their landing was independently verified. These are prerequisites, not substitutes for original acceptance criteria.

The three child Tasks all cite the open umbrella because the recorded consolidation dispositions transferred the remaining source outcomes there. Original source links and complete requirements remain in the child records. The unpublished draft IDs were replaced with the available single-prefix IDs ARTIFACT-2655 and BOUNDARY-2655; this avoids the observed compound-prefix checkpoint parser defect without changing any external Issue identity.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This Agreement coordinates repository build, dependency auditing and package ownership;
it adds no independently runnable Robota SDK or application feature. Artifact correctness remains a
child engineering integration requirement.
