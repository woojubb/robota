---
status: in-progress
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-030: Terminalize backlog-zero migration batch 01

## Problem

At fixed population object `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`, six critical/high legacy
units remain as nonterminal Task/spec records on the integration branch even though four already have
exact open GitHub owners and the two initiative records need exact convergence-only continuation issues.
The stale records make the local tree a second durable queue and misstate current ownership.

## Prior Art Research

Waived: RULE-017 already selected and approved the finite manifest-and-handoff migration mechanism.
This batch applies that mechanism to fixed historical records and introduces no new design.

## Architecture Review

### Affected Scope

- Eight existing Task/spec lifecycle paths for AGREEMENT-001, AGREEMENT-002, and ARCH-043–046.
- The paired DOCS-030 Task/spec and required loop ledgers.
- Exact no-growth rekeys in `standing-delegation-baseline.json`, `spec-user-execution-baseline.json`,
  and `reference-kind-baseline.json`.
- Append-only GitHub issue creation/comments only.

No package/app source, public API/contract, policy/gate rule, skill/workflow/hook, workspace topology,
product direction, or user-authored documentation is in scope.

### Alternatives Considered

1. Leave the records open until implementation finishes. Pro: no lifecycle edits. Con: preserves a
   duplicate durable queue despite exact GitHub ownership and violates the approved migration outcome.
2. Delete the records. Pro: smallest diff. Con: destroys historical decisions and is explicitly
   prohibited by the migration class.
3. Handoff unfinished outcomes and independently close delivered records. Pro: preserves history and
   gives every unfinished criterion one canonical remote owner. Con: requires exact remote readback and
   narrow baseline rekeys.

### Decision

Choose alternative 3. Each row below is independently judged against current source, merge ancestry,
GitHub state, and live ownership. Unfinished records cite the same append-only handoff URL after remote
readback; delivered records retain historical gates and add only current resolution evidence.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — documentation lifecycle and exact frozen keys only
- [x] Sibling scan 완료 — all six fixed units, their paired specs, issues, branches, PRs, worktrees,
      reservations, and current delivery evidence were checked
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Migration Manifest

Population object: `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

Pre-approval base: `origin/develop` at `9ae4331742d43e9d8881aff356ce3818ea0897c3`.

Limits: 6 units; 15 or fewer tracked paths. The `/tmp` survey is discovery-only and grants no
authority. Every source blob below is identical at the population object, fresh base, and this branch.

| Unit          | Original path(s) and blob OID(s)                                                                                                                                                                                                                                      | Current ownership and exact evidence                                                                                                                                                                                                                                                                                                                                                                           | Criterion-level disposition                                                                                                                                                                                                                                                                                                                                                                                   | Frozen-baseline rekey                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AGREEMENT-001 | `.agents/tasks/AGREEMENT-001-complete-arch-dag-runtime-backlog.md` @ `f86c69b76a190f295f209582726d45c3f0b533cb`; `.agents/spec-docs/active/AGREEMENT-001-complete-arch-dag-runtime-backlog.md` @ `4f1f88833de8fef90d37378c6c1e824935173b7c`                           | Exact OPEN issue https://github.com/woojubb/robota/issues/2431 and marker `backlog-zero:AGREEMENT-001:2c875dd3` uniquely read back; handoff https://github.com/woojubb/robota/issues/2431#issuecomment-5454657040. This worktree is the sole migration owner; no competing implementation owner                                                                                                                | Delivered and unfinished criteria are mapped below. The issue owns only TC-12 roll-up and final TC-13, depends initially on the still-live DAG-004/RUNTIME-002/RUNTIME-004 Task records, and excludes their implementation. It cannot close until later handoff comments supply each exact child issue URL or terminal delivery evidence. Task `skipped`; spec `rejected`; returned to the cited handoff URL. | standing/spec-user: `active/AGREEMENT-001-complete-arch-dag-runtime-backlog.md` → `rejected/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`                                                                                                                     |
| AGREEMENT-002 | `.agents/tasks/AGREEMENT-002-complete-august-13-agent-architecture-findings.md` @ `63d040e41f5f8d82c79577050804454f9014c244`; `.agents/spec-docs/active/AGREEMENT-002-complete-august-13-agent-architecture-findings.md` @ `6ddd67a331884298fe6a7082c31e624e0e6b81a9` | Exact OPEN issue https://github.com/woojubb/robota/issues/2432 and marker `backlog-zero:AGREEMENT-002:2c875dd3` uniquely read back; handoff https://github.com/woojubb/robota/issues/2432#issuecomment-5454657243. This worktree is the sole migration owner; no competing implementation owner                                                                                                                | TC-08 remains ambiguous and TC-16 remains unfinished. The issue owns only the owner decision/rescope for TC-08 and final TC-16. Open issue #2047 owns generic DTO leakage and, after handoff https://github.com/woojubb/robota/issues/2047#issuecomment-5454657685, the stronger credential-absence implementation criterion. Task `skipped`; spec `rejected`; returned to the issue #2432 handoff URL.       | standing/spec-user: `active/AGREEMENT-002-complete-august-13-agent-architecture-findings.md` → `rejected/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`; reference-kind: spec active → rejected at count 5 and Task source → completed at count 1 |
| ARCH-043      | `.agents/tasks/ARCH-043-workspace-access-is-not-a-session-owned-policy.md` @ `09779128335148af55017d708e155bb28a783477`                                                                                                                                               | Exact OPEN issue https://github.com/woojubb/robota/issues/2139; corrected complete handoff https://github.com/woojubb/robota/issues/2139#issuecomment-5454701029; superseded append-only wording preserved at https://github.com/woojubb/robota/issues/2139#issuecomment-5454657458; unassigned. This worktree is the sole migration owner; no competing implementation PR/branch/worktree/session/reservation | All four criteria remain with immutable session-owned workspace policy, transition authority, restricted-session non-escalation, and shared SDK/CLI composition. Task `skipped`; returned to the cited corrected handoff URL.                                                                                                                                                                                 | none                                                                                                                                                                                                                                                                |
| ARCH-044      | `.agents/tasks/ARCH-044-subagent-child-wire-reuses-live-runtime-contracts.md` @ `73733bb21a1e819958313db1b671e83b462fa3d6`                                                                                                                                            | Exact OPEN issue https://github.com/woojubb/robota/issues/2047; handoff https://github.com/woojubb/robota/issues/2047#issuecomment-5454657685; unassigned. This worktree is the sole migration owner; no competing implementation PR/branch/worktree/session/reservation                                                                                                                                       | JSON-safe DTO ownership, total codec rejection, collaborator exclusion, field coverage, and credential absence all remain. Task `skipped`; returned to the cited handoff URL.                                                                                                                                                                                                                                 | none                                                                                                                                                                                                                                                                |
| ARCH-045      | `.agents/tasks/ARCH-045-child-provider-credentials-and-destinations-have-separate-owners.md` @ `23cd08986f0b7aee2abac08e7d61666fa831789a`                                                                                                                             | Exact OPEN issue https://github.com/woojubb/robota/issues/2138; handoff https://github.com/woojubb/robota/issues/2138#issuecomment-5454657897; unassigned. This worktree is the sole migration owner; no competing implementation PR/branch/worktree/session/reservation                                                                                                                                       | Atomic credential/destination ownership, effective-source validation, pre-secret mismatch failure, and alternate-endpoint canaries all remain. Task `skipped`; returned to the cited handoff URL.                                                                                                                                                                                                             | none                                                                                                                                                                                                                                                                |
| ARCH-046      | `.agents/tasks/ARCH-046-workspace-contribution-inventory-duplicates-loader-ownership.md` @ `b46ad1e48c0875b144acb3a12b4f8171101b5c62`                                                                                                                                 | Exact OPEN issue https://github.com/woojubb/robota/issues/2140; handoff https://github.com/woojubb/robota/issues/2140#issuecomment-5454658133; unassigned. This worktree is the sole migration owner; no competing implementation PR/branch/worktree/session/reservation                                                                                                                                       | One owner registry, fail-closed source coverage, fixed-depth/no-follow pre-trust inspection, and one category vocabulary all remain. Task `skipped`; returned to the cited handoff URL.                                                                                                                                                                                                                       | none                                                                                                                                                                                                                                                                |

Live ownership check immediately before manifest authoring: no competing implementation PR, branch,
worktree, session, or loop-run reservation for the six unit IDs; this unmerged batch branch/worktree is
their sole migration owner; every cited issue is open and unassigned. This batch owns migration only,
not implementation of the remaining outcomes.
Any source-blob or ownership change excludes that unit and requires a fresh manifest approval.

### AGREEMENT-001 criterion map

Every delivered commit below is an ancestor of the base and its archived Task remains in the current
tree with checked completion evidence.

| Criterion | Current evidence and disposition                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01     | Delivered by ARCH-009, `d72acdd412fa8222893b3d48b1bed9e53df616bd`.                                                                                                                                                                                                                    |
| TC-02     | Implemented by ARCH-010 commits `807d161b18820f1f559b484428cfc2aab5653d8c` and `fec722f048ea51efffd5524f09518e23a756b3aa`; `978a11d023f00af3aaa7ccea43283cc623c7d22b` is archival evidence only.                                                                                      |
| TC-03     | Delivered by ARCH-011/012/019 at `9db63ee6f08225f4e3eba0ee9d2a89c79d4e437e` and ARCH-029 at `3a8876b44c0115779dfd458eaad4a1e5776fb1d3`; `22152ef9dba038e5f83306ecad5519a2ff3af854` is later current-tree relocation evidence.                                                         |
| TC-04     | Implemented by ARCH-013 commits `cfd7a3a068f85a3a07463b14bfeca40d0a9b5e9b`, `ac4194da441084001f8711604e7af625cc6f48a9`, and `801420c787e331c731db50866d35ac1e19204962`; `ef7f40d2a325ead087c48b1d83e49ee906f647e5` is archival evidence only.                                         |
| TC-05     | Implemented by DAG-001 commit `caabd3cbf531332df1c61bd69dd071f905a684d3`; `30528738c19fc4abe29d47962e2001160175ab24` records scenario/archive evidence.                                                                                                                               |
| TC-06     | Unfinished DAG-004 canonical-import work remains outside this convergence issue. Its live Task stays in place until a later migration supplies the exact canonical child issue or terminal delivery evidence.                                                                         |
| TC-07     | Unfinished RUNTIME-002 headless-artifact work remains outside this convergence issue. Its live Task stays in place until a later migration supplies the exact canonical child issue or terminal delivery evidence.                                                                    |
| TC-08     | Delivered by RUNTIME-003, `34768aa40523007b88a934d958e3de6d98dbe107`.                                                                                                                                                                                                                 |
| TC-09     | Compaction cancellation delivered by `01aae4f6c2af60711674ed8ab2ab993f9c1ab292`; DAG admission/running-node cancellation remains and resumes remotely.                                                                                                                                |
| TC-10     | Delivered by RUNTIME-005, `dd444c1cf759cf5ac1a198ab3ddb41dee4cf4079`.                                                                                                                                                                                                                 |
| TC-11     | Implemented by RUNTIME-006 commit `1f57e7f2b99fe40fc43ed1e424b3a9c39c0421af`, proved by `ee9323286fdb104fbc672912cc85faac49762f60`; `5016c3a8304bc053ed80aac9babf4f11f720b48d` is archival evidence.                                                                                  |
| TC-12     | Unfinished roll-up because DAG-004, RUNTIME-002, and RUNTIME-004 remain nonterminal. The convergence issue initially depends on their still-live Task records, does not implement them, and cannot close until later comments add each exact issue URL or terminal delivery evidence. |
| TC-13     | Unfinished assembled conformance/CI proof; the convergence issue owns this final proof only after all three child issues close.                                                                                                                                                       |

### AGREEMENT-002 criterion map

Every listed commit is an ancestor of the base; the corresponding archived child Task and checked
criterion remain current-tree evidence.

| Criterion           | Current evidence and disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01, TC-02, TC-09 | ARCH-014/015/023 delivered by `b078afa2d5bb45d91716243ec6c8f59fe43d537b`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| TC-03, TC-04, TC-05 | ARCH-016/017/018 delivered by `2ebff0143b0f52febd804e306e11fa9bc17dbd8d`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| TC-06, TC-07        | ARCH-020/028 originally delivered by `2ebff0143b0f52febd804e306e11fa9bc17dbd8d`; `22152ef9dba038e5f83306ecad5519a2ff3af854` is later current-tree relocation evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| TC-12               | ARCH-022 recursive surface ownership originally delivered by `2d3b2c0284cc5ebcaa42f386cb0c768c65fd8dd1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| TC-08               | Ambiguous/unfinished. ARCH-021 recipe composition is at `0c07176acc4dbfbf67ba79ad7258aac222ba5eb5`; ARCH-033/034 at `d72acdd412fa8222893b3d48b1bed9e53df616bd`; ARCH-035 at `7b85767db227ddb1045b9be7dbfc707f039ba6c4`; ARCH-036/SEC-009 at `7669851c565c958c455a6572c146d91b21007824`; `a0b7891eaba995fed94af7e32e3dfa9a413ab59b` removed redundant parent projection. Issue #1784, issue #1785, issue #1787, issue #1788, and issue #1786 are closed. Current `createProviderProfile()` deliberately emits `{ apiKey: provider.apiKey }` when `apiKeyEnv` is absent, the start payload carries it across `child.send`, and the wire contract permits both forms; the focused subagent-runner test passes 24/24 and asserts literal preservation. Therefore the parent-side credential clause needs an explicit owner decision/rescope. Open issue #2047 owns generic wire cleanup; its planned handoff comment adds the stronger credential-absence implementation scope before approval. |
| TC-10               | ARCH-024 originally delivered by `2d3b2c0284cc5ebcaa42f386cb0c768c65fd8dd1`; `48b9f6f92ce5dc9188f0edf45c6778da3c8a8887` is later current-tree evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| TC-11, TC-14        | ARCH-027/026 delivered by `2d3b2c0284cc5ebcaa42f386cb0c768c65fd8dd1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| TC-13               | ARCH-025 local repair at `baa6863e93fb2d962e55432c785657feb1324557`; total projection is closed by archived ARCH-031 at `47720678af19d6f0ca4adcc7debfbd240ff44751`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| TC-15               | All 14 declared child paths resolve under `.agents/tasks/completed/`; archival/done-evidence scans are re-run by this batch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| TC-16               | Unfinished final CI-equivalent convergence proof. The new issue owns this proof after the recorded TC-08 disposition and any dependency that disposition establishes; open issue #2047 remains independently responsible for its ARCH-044 scope. The migration batch records only its own verification under DOCS-030 TC-05.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Exact frozen-baseline rekeys

| Baseline                                            | Exact old key                                                                              | Exact new key                                                                                | Preserved value |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------- |
| `scripts/harness/standing-delegation-baseline.json` | `active/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`                                | `rejected/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`                                | membership      |
| `scripts/harness/spec-user-execution-baseline.json` | `active/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`                                | `rejected/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`                                | membership      |
| `scripts/harness/standing-delegation-baseline.json` | `active/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`                   | `rejected/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`                   | membership      |
| `scripts/harness/spec-user-execution-baseline.json` | `active/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`                   | `rejected/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`                   | membership      |
| `scripts/harness/reference-kind-baseline.json`      | `.agents/spec-docs/active/AGREEMENT-002-complete-august-13-agent-architecture-findings.md` | `.agents/spec-docs/rejected/AGREEMENT-002-complete-august-13-agent-architecture-findings.md` | `5`             |
| `scripts/harness/reference-kind-baseline.json`      | `.agents/tasks/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`            | `.agents/tasks/completed/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`    | `1`             |

## Solution

1. Commit this manifest, create/read back the two exact convergence issues, and read back the six
   canonical handoffs plus the preserved superseded ARCH-043 wording and its complete correction, then
   record exact issue/comment URLs before approval.
2. Record a CLASS GATE-APPROVAL using the exact registered instruction and evidence that this committed
   manifest is inside the finite scope.
3. Add `returned_to_issue:` to each unfinished record, set canonical terminal status/date, and move Task
   and spec records atomically without deleting history.
4. Preserve AGREEMENT-002 delivery evidence while handing off its ambiguous TC-08 decision and final
   TC-16 proof, then move its Task/spec to skipped/rejected terminal locations.
5. Apply only the exact baseline rekeys in the manifest and run the declared verification.

## Affected Files

- `.agents/tasks/completed/DOCS-030-terminalize-backlog-zero-migration-batch-01.md`
- `.agents/spec-docs/done/DOCS-030-terminalize-backlog-zero-migration-batch-01.md`
- `.agents/tasks/completed/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`
- `.agents/spec-docs/rejected/AGREEMENT-001-complete-arch-dag-runtime-backlog.md`
- `.agents/tasks/completed/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`
- `.agents/spec-docs/rejected/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`
- `.agents/tasks/completed/ARCH-043-workspace-access-is-not-a-session-owned-policy.md`
- `.agents/tasks/completed/ARCH-044-subagent-child-wire-reuses-live-runtime-contracts.md`
- `.agents/tasks/completed/ARCH-045-child-provider-credentials-and-destinations-have-separate-owners.md`
- `.agents/tasks/completed/ARCH-046-workspace-contribution-inventory-duplicates-loader-ownership.md`
- `scripts/harness/standing-delegation-baseline.json`
- `scripts/harness/spec-user-execution-baseline.json`
- `scripts/harness/reference-kind-baseline.json`
- `.agents/loop-runs/backlog-execution-orchestrator.jsonl`
- `.agents/loop-runs/user-execution-scenario.jsonl`

## Completion Criteria

- [ ] TC-01: the committed manifest contains exactly six fixed units, no more than 15 tracked paths,
      exact source blobs, current ownership, one disposition per unit, and every required baseline rekey.
- [ ] TC-02: two unique convergence issues, six canonical handoff comments, and the preserved
      superseded ARCH-043 comment plus its correction are read back; each unfinished terminal record
      cites its exact canonical comment URL and preserves decisions/evidence/remaining
      criteria/dependencies/resumption instructions.
- [ ] TC-03: AGREEMENT-001, AGREEMENT-002, and ARCH-043–046 terminalize as skipped/rejected; no record
      is deleted and historical verdicts are unchanged.
- [ ] TC-04: all six existing baseline keys are rekeyed to exact terminal paths with counts unchanged;
      no baseline grows.
- [ ] TC-05: focused lifecycle/reference/delegation checks, `pnpm harness:scan`, and the current branch's
      CI-equivalent verification exit 0 for this documentation-only batch.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                                        | Notes                                              |
| ----- | --------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| TC-01 | Agreement / manifest  | Git object/blob comparison, `git diff --name-only`, manifest row count | Fail on drift, ownership, or ceiling violation.    |
| TC-02 | Agreement / remote    | `gh issue` create/readback/search and `gh api` comment readback        | Exact URLs are recorded in terminal records.       |
| TC-03 | Agreement / lifecycle | task archival and doc-folder-status scans                              | Also inspect historical Evidence Log preservation. |
| TC-04 | Agreement / baseline  | standing-delegation, spec-user-execution, and reference-kind scans     | Exact old-to-new keys only.                        |
| TC-05 | Agreement / CI        | focused scanners, `pnpm harness:scan`, `pnpm harness:verify-like-ci`   | Documentation-only scope; no product scenario.     |

## Tasks

- [ ] `.agents/tasks/DOCS-030-terminalize-backlog-zero-migration-batch-01.md`

## User Execution Test Scenarios

Not applicable. The batch changes internal lifecycle evidence and exact baseline keys only; it exposes no
runnable user-facing behavior.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- GATE-WRITE — Mechanical criteria: 20/20 PASS, with frontmatter, research waiver, architecture
  checklist, alternatives, criterion numbering, Test Plan coverage, Tasks placeholder, and initial
  Evidence Log shape observed by `gate.mjs judge`.
- GATE-WRITE — Contains a concrete symptom: six fixed nonterminal records preserve a second durable
  queue despite current remote ownership and delivery evidence.
- GATE-WRITE — Contains a reproduction condition: fixed population object, exact base OID, six unit
  rows, and eight source blob OIDs reproduce the condition.
- GATE-WRITE — Research feeds Alternatives and Decision: the approved RULE-017 mechanism directly
  selects manifest, exact readback, handoff, and historical terminalization.
- GATE-WRITE — Decision references the driving trade-off: single remote ownership and preserved
  history are chosen at the cost of exact readback and narrow baseline rekeys.
- GATE-WRITE — New-surface placement: N/A because this batch adds no package, app, presentation,
  interface, API, policy, or product surface.
- GATE-WRITE — Criterion coverage: TC-01 through TC-05 independently cover manifest, remote handoff,
  lifecycle, baseline rekeys, and verification.
- GATE-WRITE — Observable criterion form: each criterion names exact counts, URLs, statuses, keys, or
  command exit results.
- Mechanical judge: 20 PASS, 0 FAIL, 7 semantic criteria referred to the guardian.
- Guardian: all 7 semantic criteria PASS; the Problem and fixed-OID condition are concrete and
  reproducible, the approved RULE-017 mechanism feeds the alternatives/decision, the decision names
  the history-preservation versus exact-readback trade-off, new-surface placement is N/A, and all five
  completion criteria are observable with matching test rows.
- BACKLOG-ZERO manifest audit: exactly 6 units and 15 final tracked paths; all 8 source blobs match
  population object `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`, base, and branch; every cited
  delivery commit is a base ancestor; exactly 6 existing baseline keys are rekeyed without growth.
- Ownership audit: this worktree is the sole migration owner and has no competing implementation
  owner; existing issue #2139, issue #2047, issue #2138, and issue #2140 are OPEN and unassigned;
  the two convergence issues remain required readbacks before class approval.
- Independent deep review after the final corrections: `ACTIONABLE FINDINGS: 0`.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Given:** 2026-08-28, this conversation
**Evidence condition met:** Committed manifest b933e60d1; exact remotely grounded manifest and PROCEED/0 review 6f9019442; six units, fifteen paths, issue/comment readbacks complete, no package/API/policy change.
**Review fingerprint:** 3fda0763ecb8 (review 4a32ac39, type/tags a0d6c0d0)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (Committed manifest b933e60d1; exact remotely grounded manife)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (3fda0763ecb8) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- Planning checkpoint binding: `.agents/tasks/DOCS-030-terminalize-backlog-zero-migration-batch-01.md`;
  `.agents/spec-docs/active/DOCS-030-terminalize-backlog-zero-migration-batch-01.md`;
  `SCENARIO DRAFTED: not-applicable | 0`; whole-worktree inventory: 0 paths before transition.
- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DOCS-030-terminalize-backlog-zero-migration-batch-01.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DOCS-030-terminalize-backlog-zero-migration-batch-01.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 5 checkbox tasks for 5 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 286 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 0 path(s), all within the paired spec/Task and .agents/loop-runs/
