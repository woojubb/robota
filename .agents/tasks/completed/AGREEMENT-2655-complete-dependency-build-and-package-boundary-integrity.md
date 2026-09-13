---
title: 'AGREEMENT-2655: Complete dependency build and package-boundary integrity'
issue: https://github.com/woojubb/robota/issues/2655
status: done
completed: 2026-09-13
created: 2026-09-12
priority: high
urgency: now
area: workspace build and verification
children: [INFRA-2655, ARTIFACT-2655, BOUNDARY-2655]
depends_on: []
---

# AGREEMENT-2655: Complete dependency build and package-boundary integrity

Current completion reconciliation: PR #2721 archived BOUNDARY on develop at
`ca214393cac3aa0baf94a811ecc5773837bd5a04` (2026-09-13T10:40:41Z). Hume independently
verified the remote landing and identical reviewed/merged tree; all applicable CI contexts passed.
This parent lifecycle records current completion coordination, not retroactive authorization of
child implementation. Issue #2655 remains open until this parent is completed and landed.

The existing-parent planning route was repaired by PR #2722 at
`27cf0f024701eeb6846bb5fd1e34fab46557e843`, independently merge-verified by Hume.
The earlier failed gates remain historical evidence. The parent's current IMPLEMENT, VERIFY
and COMPLETE gates have now passed; final metadata CI, landing and issue closure remain pending.

Spec: `.agents/spec-docs/done/AGREEMENT-2655-complete-dependency-build-and-package-boundary-integrity.md`

## Objective

Resolve the full four-source register of Issue #2655, including Issue #2154, Issue #2490 and Issue #2653.
Completion requires item-by-item delivery evidence, not just a passing mapping audit.

## Plan

- [x] Verify Issue #2653's exact clean, framework-only affected build/test acceptance using the already-landed fix; do not substitute a global build or planner-only result. Evidence: paired spec TC-01 delivery reconciliation, actual job 103683620725 on `c8e814c62cc1f5263f95ced9360f3e1104b1f5a9`.
- [x] Complete integrated dependency scans and advisory reconciliation (INFRA-2655). Evidence: completed child and paired spec TC-02, including the exact delivering-push scan and all nine advisory dispositions.
- [x] Deliver complete transactional workspace artifacts (ARTIFACT-2655). Evidence: completed child and paired spec TC-03, preserving both previously approved atomicity exceptions.
- [x] Classify shared files across the repository and migrate package-specific content (BOUNDARY-2655). Evidence: completed child Task/spec, six canonical TC records and terminal GATE-COMPLETE PASS; Hume-verified merge `fa7984f59358682ab472b1adf96297767715ef4e` and source delivery comment 5651937294.
- [x] Prepare item-by-item acceptance evidence covering every source outcome. Evidence: paired spec's five delivery reconciliations, verified ancestor identities and actual source/umbrella receipts. Parent terminal gate/lifecycle is a separate completion action.

## Delivery

Verify all deliveries on origin/develop and close Issue #2655 only after every source outcome holds.

The paired spec's Delivery Reconciliation below the Test Plan owns the current TC-by-TC evidence
and remaining acceptance gaps. Hume owns PR #2718 merge verification, Nash owns BOUNDARY-2655
completion, and Main owns Git and final Issue writeback. Do not treat the reported merge, a comment
draft or child implementation as a completed child, a guardian PASS or an already-posted source
delivery record. Both parent/child projections must be updated together when the child is actually
archived; the parent remains open until its own criteria and applicable gates hold.

The existing child Owner Approval (`모듀 승인함`, 2026-09-13) governs TC-04: retain domain-owned,
forward-provisioned public SDK contracts under their owner and dependency-direction rules; apply
the neutral-API/two-independent-package test to retained generic shared material. Public contracts
still belong to the inventory and are not removed solely for a low internal caller count. This
records the already-approved classification decision, not a new exception or smaller population.

## Children

- [x] INFRA-2655 — done — `.agents/tasks/completed/INFRA-2655-scan-integrated-dependencies-without-manifest-changes.md`
- [x] ARTIFACT-2655 — done — `.agents/tasks/completed/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`
- [x] BOUNDARY-2655 — done — `.agents/tasks/completed/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`

## Test Plan

Inspect child regressions, actual build/scan execution, merged commits and original source criteria.
Neither decomposition nor a source Issue's CLOSED state proves delivery.

## Progress

2026-09-13 terminal reconciliation: IMPLEMENT passed 7/7, independent VERIFY passed all five
criteria, and COMPLETE passed 9/9 with five per-TC records. The current child ancestry and source
receipts were read back against the verified integration base. This Task/spec pair is complete
locally; final metadata delivery and the umbrella issue close are still required.

The restored approved pair is committed as a planning-only prelude on the repaired integration
base. Main now enters the parent's completion coordination gate; no new product implementation
is introduced, and the remaining terminal verification and issue writeback are still pending.

2026-09-13 final child/acceptance audit: all three children now have actual completed Task and
done spec paths. BOUNDARY's terminal GATE-COMPLETE records 9/9 PASS after GATE-VERIFY 5/5 and
six canonical TC records; the child was manually archived with its exact completed Task pointer.
GitHub compare confirms INFRA commit `1c52df898f7a6df9adf715821bc9c8638a3dd967` and ARTIFACT
commit `4f3c0755dd70d3830127ffecdbdc8cb7a9704abc` are ancestors of Hume-verified BOUNDARY
merge `fa7984f59358682ab472b1adf96297767715ef4e` (each merge-base equals the child commit,
behind_by=0). All five parent acceptance criteria now have real evidence, including the source
and umbrella receipts below. This updates both declaring parent projections without rewriting
historical gate evidence. Parent terminal gate/lifecycle is not yet recorded; Issue #2655 remains
OPEN until that last completion requirement is truthfully resolved.

2026-09-13 delivery preparation after the API-confirmed PR #2718 owner merge:
`fa7984f59358682ab472b1adf96297767715ef4e` at `2026-09-13T07:18:14Z`.
The reviewed/tested head remains `c8e814c62cc1f5263f95ced9360f3e1104b1f5a9`;
the merge identity is not substituted for that CI binding. Actual run 34742172142 completed
successfully with all 13 non-skipped jobs passing. The paired spec now records the current
clean-partial proof, 104-pass/1-skip artifact corpus and BOUNDARY evidence, alongside existing
INFRA delivery. Nash's terminal child record, parent completion audit/gates and final umbrella
writeback are still required. The missing control-plane
landing record was [posted and read back](https://github.com/woojubb/robota/pull/2718#issuecomment-5651926138):
actual owner `woojubb`, scans cache v2 and build framework-count/membership changes, other owning
contexts unchanged, provenance RED. Main subsequently supplied Hume's final `MERGE VERIFIED: PASS`
for the actual merge, content, CI and landing record. This is Hume's verdict, not this author's
independent rerun. The [actual issue #2490 delivery comment](https://github.com/woojubb/robota/issues/2490#issuecomment-5651937294)
was posted and read back after that PASS; its prior consolidation closure is not delivery evidence.
The [umbrella partial-delivery receipt](https://github.com/woojubb/robota/issues/2655#issuecomment-5651949683)
was also posted and read back with Issue #2655 still OPEN. It explicitly retains the pending
child/parent completion metadata and audit; it is not a terminal parent verdict.
TC-05 still requires the complete child/ancestry and parent writeback audit. No Issue is closed by
this edit.
The dated progress and baseline paragraphs below remain historical evidence, including the former
15-package closure and earlier incomplete-child descriptions; they are not current population or
verification claims.

2026-09-13 current child projection: BOUNDARY-2655 is in-progress, with its implementation proposed
in PR #2718. Its Task records completed local population reconciliation, owner migrations and six
direct example executions with independent DONE-GATE-STAGE-2 PASS. Its TC-03 and TC-06 remain
unchecked for outstanding remote runtime/CI and landing evidence. The earlier read-only inventory
description below is historical, not the current implementation state. This projection does not
complete the Agreement, change its acceptance criteria or authorize closing Issue #2655.

2026-09-13: PR #2715 delivered artifacts and the current clean framework-only acceptance to
`origin/develop` at `4f3c0755dd70d3830127ffecdbdc8cb7a9704abc`. Final CI run 34706938357
passed on head `3310019a22d6bc445f9daaac4b54893b9e32276c`; actual build job 103588603553
includes successful clean-partial proof, full build/quality, exact output/pack/release-path and
desktop/CLI binary checks. Native Windows also passed. Hume verified exact head/merge tree
identity and remote ancestry. The owner-only provenance exception is recorded on the PR and
is not reported as green. MERGE-2655 reconciles the confirmed-empty required-check projection
with actual check evidence; no product verification or merge permission was waived.

Actual delivery evidence is posted to source Issues #2154 and #2653, and the umbrella register
is updated. The prior source closures were consolidation, not implementation evidence. The
original Windows atomicity-only and first physical-dist migration exceptions remain narrow.
BOUNDARY-2655 is still unfinished: its read-only candidate inventory is not full classification,
does not establish neutral API ownership for every file, and has performed no migrations.

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

**Reason:** This Agreement reconciles the ownership and delivery records of existing capabilities;
it adds no independently callable SDK function, interactive session behavior, command, or application
interface for an end user.
