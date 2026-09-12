---
title: 'ARTIFACT-2655: Assemble complete transactional workspace artifacts'
issue: https://github.com/woojubb/robota/issues/2655
status: in-progress
created: 2026-09-12
priority: high
urgency: now
area: workspace build and verification
depends_on: []
---

# ARTIFACT-2655: Assemble complete transactional workspace artifacts

## Objective

Make root and affected builds discover complete publishable artifact tasks, including copied web assets. Assemble node/types/web in staging, commit complete dist generations atomically, derive exact emitted/packed manifests, and verify stale-file and partial-failure rejection.

Parent: AGREEMENT-2655; canonical umbrella: https://github.com/woojubb/robota/issues/2655.

Spec: `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`.

Owner decision (verbatim, 2026-09-12): "windows 빌드의 원자성 보장 제외를 허용합니다."
Windows remains a supported build path with staging, complete-output validation and failure recovery;
only atomic replacement is exempted. Subsequent owner decision (verbatim, 2026-09-12):
"dist 최초 전환도 승인합니다." This separately allows the first legacy-output transition with
backup, explicit interruption/recovery handling and no atomicity claim. Normal Linux/macOS managed
publication remains atomic. The paired spec records both exceptions and their verification scope.

Source acceptance: [Issue #2154](https://github.com/woojubb/robota/issues/2154), transferred to the umbrella by its [recorded disposition](https://github.com/woojubb/robota/issues/2154#issuecomment-5642810131). The original complete, atomic and exact artifact criteria remain binding except for the two explicit atomicity exceptions above.

Independent recommendation review, Carson, 2026-09-12: `REVIEW VERDICT: ENDORSE` (revision 1).
The existing full-scope Task addresses the foundational cause; no new Task is required.

## Plan

- [ ] Validate the detailed design against current code and inherited source criteria, including TC-07 legacy and Windows transition boundaries.
- [ ] Implement TC-01 complete graph/assembly, TC-02 publication and recovery, TC-03 exact emitted manifests, and TC-04 exact pack consumers with failure-reproducing regressions.
- [ ] Verify TC-05 real release-path corpus and TC-06 current clean framework-only partial build/test; prepare CI and delivery evidence.

## Delivery

Merge into origin/develop after verification and record the delivering commit in the source Issue.

## Test Plan

Focused positive/negative regressions plus actual execution at the owning boundary. Verify every
requirement in Objective and the source Issue before marking this Task complete.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** ARTIFACT-2655 changes internal artifact assembly, storage, replacement and publication.
The initial-transition and Windows atomicity exceptions remain within that boundary; installed CLI
commands, web-monitor interactions and public API behavior are preserved. No new product interaction
is introduced. Nash independently confirmed this applicability decision on 2026-09-12.
