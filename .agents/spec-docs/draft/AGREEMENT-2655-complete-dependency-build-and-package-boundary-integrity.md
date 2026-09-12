---
status: draft
type: AGREEMENT
tags: [cli]
lane: L2
---

# AGREEMENT-2655: Complete dependency build and package-boundary integrity

Paired with `.agents/tasks/AGREEMENT-2655-complete-dependency-build-and-package-boundary-integrity.md`.
Source: https://github.com/woojubb/robota/issues/2655.

## Problem

The four-source register has independent incomplete outcomes: full artifact assembly, shared package
boundaries and integrated dependency scanning. Closing only the original scan defect would leave
inherited work undelivered. Source Issue #2653 already has a build-closure fix at 1b9098b64; it needs current
exact clean partial-build verification rather than duplicate implementation. Its original passing CI
used global fallback, so planner tests and that full build do not establish the requested partial path.

## Prior Art Research

Waived: this Agreement records source acceptance and execution ownership. Each executable child
evaluates technical alternatives before implementation.

## Architecture Review

### Affected Scope

Root build orchestration, workspace graph/plans, package artifact assembly, shared package ownership,
security workflows and their tests. No new package or application is planned.

### Alternatives Considered

1. Deliver only the original dependency-scan defect. Small patch, but loses inherited scope.
2. Implement everything in one patch. Preserves scope, but conflates distinct verification outcomes.
3. Execute three cause-owned child Tasks serially and verify the already-landed fourth outcome.
   Preserves scope and bounds each review; coordination requires explicit parent projections.

### Decision

Choose alternative 3. Retain the entire umbrella objective until every child is delivered.
ARTIFACT-2655 retains transactional output, exact manifest and fault-injection requirements.
BOUNDARY-2655 must classify and migrate the actual repository population; a handpicked manifest is
insufficient. Inspect root/affected build consumers and PR/manual security scans before changing them.
Keep prior dependency, permission and failure contracts unless the child explicitly supersedes them.
Adversarial completion check: a green scan alone cannot establish a complete artifact or complete
population. Multiple agents may work in the existing checkout under the owner's latest instruction,
with disjoint write scopes and no worktrees. Independent review is now permitted; earlier local
assessments must not be retroactively described as independent.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — root/affected build and PR/manual audit paths inspected.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Execute children serially, retaining separate verification plans. Reconcile the four source Issues
against landed code, tests, actual outputs and commit ancestry. Partial delivery keeps Issue #2655 open.

## Affected Files

- `.agents/tasks/AGREEMENT-2655-complete-dependency-build-and-package-boundary-integrity.md`
- The child Task records below and their subsequent paired specifications.
- Child-owned workflow, build and boundary paths declared in their detailed specifications.

## Completion Criteria

- [ ] TC-01: From a checkout with no pre-existing package build output and a framework-only changed-file scope, affected build and affected test exit 0 without global fallback; analytics/replay dist is built before the three originally failing framework test files run and pass. The focused graph suite also passes; a full/global build or planner-only result is not substitute evidence.
- [ ] TC-02: Every develop push scans its full lockfile; all original advisory families have verified dispositions.
- [ ] TC-03: Root/affected builds assemble complete node, types and copied-web generations, propagate copied-artifact changes, replace publishable output atomically and enforce exact emitted/packed manifests with stale/failure tests.
- [ ] TC-04: Repository-wide shared files have verified owners, neutral APIs and at least two independent package consumers; required migrations are delivered and precise affected/full selection and promotion reasons are reported and enforced.
- [ ] TC-05: All child deliveries are ancestors of origin/develop and source Issues carry delivery evidence before Issue #2655 is closed.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                              | Notes                                                                                                                |
| ----- | ----------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Integration | Clean-output framework-only affected build/test execution plus `workspace-affected.test.mjs` | Assert non-global selection, fresh analytics/replay outputs, and the three source-issue framework test files passing |
| TC-02 | CI smoke    | Child event fixtures and live lockfile scan                                                  | Bind execution to delivered commit                                                                                   |
| TC-03 | Integration | Clean/stale/failure/packed build corpus                                                      | Cover root and affected paths                                                                                        |
| TC-04 | Integration | Repository inventory, negative fixtures and affected/full plans                              | Cover actual population                                                                                              |
| TC-05 | Integration | git ancestry and gh issue/pr/check readback                                                  | Partial delivery is insufficient                                                                                     |

## User Execution Test Scenarios

Not applicable.

**Reason:** This Agreement coordinates existing build and verification work without adding a new
conversation, command or application interface for an end user to operate.

## Tasks

- [ ] INFRA-2655 — todo — `.agents/tasks/INFRA-2655-scan-integrated-dependencies-without-manifest-changes.md`
- [ ] ARTIFACT-2655 — todo — `.agents/tasks/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`
- [ ] BOUNDARY-2655 — todo — `.agents/tasks/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`

## Evidence Log
