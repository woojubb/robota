---
status: review-ready
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-037: Terminalize backlog-zero migration batch 08

## Problem

Three `high/now` fixed-population backlog records remain active even though GitHub must be their sole
durable implementation queue. HARNESS-057 has delivered its central zero-subject refusal and adoption
ratchet, but only 98 of 148 registered scans declare what they examined. PLG-020 still describes four
official plugins that the production lifecycle cannot observe. TOOL-004 still describes model-facing
built-in tool text that names rejected parameters and unenforced mechanisms.

The current `origin/develop` base is `92658e1781be80bb66ccd25db6bac4810d5b4444`. All three Task
blobs match the fixed population, base, HEAD, and worktree. No open PR, matching implementation
branch, extra worktree, assignee, or open loop owns them. Leaving the Tasks active preserves a second
durable queue; marking any of them done would falsely claim unfinished package or migration work.

Issue #2404 owns prevention of future duplicate durable queues. DOCS-037 is finite containment only.

## Prior Art Research

Waived: RULE-017 and the registered `BACKLOG-ZERO-MIGRATION` class already select the fixed-manifest,
exact current-truth readback, canonical GitHub handoff, and body-preserving terminalization mechanism.
This batch applies that mechanism and changes no package, API, product, policy, workflow, hook, or
topology.

## Architecture Review

### Affected Scope

- Three Task lifecycle moves: HARNESS-057, PLG-020, and TOOL-004 become skipped only after exact
  append-only handoffs to open/unassigned GitHub issues.
- The paired DOCS-037 Task/spec and two required loop ledgers.
- One control issue, three new residual issues, and three canonical handoff comments.

No package/app source, API/contract, package or product/user documentation, policy/gate document,
skill/workflow/hook/topology, baseline, carrier, or product-direction change is in scope.

### Alternatives Considered

1. Leave the records active. Pro: no lifecycle edits. Con: GitHub and the repository remain two
   competing durable queues for the same unfinished work.
2. Implement the three records in this batch. Pro: resolves the underlying work. Con: crosses the
   documentation-only delegated boundary and combines unrelated package changes.
3. Retire the duplicate Tasks to exact current GitHub owners. Pro: preserves unfinished truth and
   urgency while restoring one durable queue. Con: requires exact remote owner/comment readback.

### Decision

Choose alternative 3.

- HARNESS-057 becomes `skipped` after exact handoff
  https://github.com/woojubb/robota/issues/2462#issuecomment-5457971404. The central runner rejects an
  unearned `::examined:: 0`, supports explicit expected-empty reasons, and freezes adopting scan names.
  Current `SCAN_COMMANDS` contains 148 registered scans while the adoption baseline contains 98,
  leaving 50. Exact residual issue #2462 owns that adoption work; umbrella tracker issue #2234 remains
  related context and is deliberately not treated as the canonical owner.
- PLG-020 becomes `skipped` after exact handoff
  https://github.com/woojubb/robota/issues/2460#issuecomment-5457939546. Current code still dispatches
  only `beforeRun`, `afterRun`, `beforeProviderCall`, `afterProviderCall`, and `onError`; the affected
  Limits, Webhook, ConversationHistory, and ErrorHandling plugins still depend on undispatched hooks
  or explicit out-of-band methods. Issue #2460 owns the product/package implementation.
- TOOL-004 becomes `skipped` after exact handoff
  https://github.com/woojubb/robota/issues/2461#issuecomment-5457939714. Current Read/Edit/Shell
  descriptions still use `file_path`, `old_string`, `replace_all`, and a nonexistent `description`
  parameter or make mechanism claims their layer does not enforce. Issue #2461 owns the correction.

The initial candidate set included medium/soon HARNESS-118 and HARNESS-900. Independent review found
that it violated the user's urgency order because PLG-020 and TOOL-004 are conflict-free `high/now`
units; it also found one unmet literal HARNESS-118 criterion. Commit
`537703876e02a97da600908c1a60c84b522e5971` remains as withdrawn evidence. No class approval,
checkpoint, implementation, or push occurred before correction.

ARCH-047, ARCH-048, and ARCH-049 were also audited. Their residuals are valid and urgent, but Task
moves require four package-document carrier rekeys, which the delegated class excludes. They require
a separately authorized carrier-safe batch and are not silently included here.

### Architecture Review Checklist

- [x] Affected scope listed — seven internal lifecycle/ledger paths only.
- [x] Sibling scan completed — blobs, priorities, issues, code premises, branches, worktrees, loops,
      assignees, citations, baselines, and competing urgent records checked.
- [x] At least two alternatives considered.
- [x] Decision rationale documented.

## Fallback & Degradation Declaration

None.

## Migration Manifest

Population object: `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

Pre-approval base: `origin/develop` at `92658e1781be80bb66ccd25db6bac4810d5b4444`.

Limits: 3 units; 7 final tracked paths. Each governed Task blob is identical at population, base,
HEAD, and worktree. There are zero baseline, carrier, package-document, or excluded-path changes.

| Unit        | Governed original path and blob OID                                                                                                   | Current ownership and evidence                                                                                                                                          | Criterion-level disposition                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| HARNESS-057 | `.agents/tasks/HARNESS-057-a-scan-must-report-the-size-of-what-it-examined.md` @ `779a5cbe5c639e1e2ba9deea6c9f91c2d1d3dc26`           | Unique OPEN/unassigned residual issue #2462; exact handoff https://github.com/woojubb/robota/issues/2462#issuecomment-5457971404; measured adoption 98/148.             | Preserve the Task body; archive skipped to the exact comment. The remaining 50 scan declarations stay open.       |
| PLG-020     | `.agents/tasks/PLG-020-official-plugins-cannot-observe-the-runtime.md` @ `46b45d902d65fe3aa3d46f815bbc8868358f790e`                   | Unique OPEN/unassigned issue #2460; exact handoff https://github.com/woojubb/robota/issues/2460#issuecomment-5457939546; current dispatcher/plugin mismatch confirmed.  | Preserve the Task body; archive skipped to the exact comment. Package behavior and docs remain with issue #2460.  |
| TOOL-004    | `.agents/tasks/TOOL-004-builtin-tool-descriptions-name-parameters-the-schema-rejects.md` @ `b6110f422457ea3e81cf3b272500466f8108da04` | Unique OPEN/unassigned issue #2461; exact handoff https://github.com/woojubb/robota/issues/2461#issuecomment-5457939714; current description/schema mismatch confirmed. | Preserve the Task body; archive skipped to the exact comment. Package behavior and tests remain with issue #2461. |

Live ownership check: no open PR, matching implementation branch, extra worktree, assignee, open
loop, or reservation owns any unit. Current branch `docs/backlog-zero-batch-08` is the sole migration
owner and owns no package implementation. Any governed blob, remote owner, disposition, or scope
change excludes that unit and requires fresh manifest approval.

Control issue #2459 uniquely carries `backlog-zero:DOCS-037:2c875dd3` and records the pre-approval
correction. Issues #2460, #2461, and #2462 uniquely carry their residual markers. All four exact
owner/control issues (issue #2459, issue #2460, issue #2461, and issue #2462) are OPEN and unassigned;
all three handoff comments are exact and unmodified. Parent issue #2404 and related umbrella issue #2234
remain open.

### Baseline and carrier disposition

No exact Task-path carrier or baseline key exists for PLG-020 or TOOL-004. HARNESS-057's two relative
links from completed HARNESS-064 become valid when HARNESS-057 joins it in `completed/`; no carrier
edit is required. Zero baseline and carrier changes are permitted by this manifest.

## Solution

1. Preserve the withdrawn initial manifest; freeze this corrected exact three-unit/seven-path
   manifest and read back the control/residual issues and all three canonical handoffs.
2. Record class approval only after independent proof of urgency, remote ownership, unchanged blobs,
   current premises, zero carrier/baseline changes, and the excluded-scope boundary.
3. Create the paired execution/scenario checkpoint, then apply only the three Task moves and lifecycle
   frontmatter additions.
4. Run focused lifecycle, citation, delegation, and current-premise tests; preservation audit; full
   harness scan; and CI mirror on the final tree.

## Affected Files

- `.agents/loop-runs/backlog-execution-orchestrator.jsonl`
- `.agents/loop-runs/user-execution-scenario.jsonl`
- `.agents/spec-docs/done/DOCS-037-terminalize-backlog-zero-migration-batch-08.md`
- `.agents/tasks/completed/DOCS-037-terminalize-backlog-zero-migration-batch-08.md`
- `.agents/tasks/completed/HARNESS-057-a-scan-must-report-the-size-of-what-it-examined.md`
- `.agents/tasks/completed/PLG-020-official-plugins-cannot-observe-the-runtime.md`
- `.agents/tasks/completed/TOOL-004-builtin-tool-descriptions-name-parameters-the-schema-rejects.md`

## Completion Criteria

- [ ] TC-01: the committed corrected manifest contains exactly three `high/now` units, three governed
      blobs, seven final tracked paths, exact skipped dispositions, and zero baseline/carrier changes.
- [ ] TC-02: the control/residual issues and all three canonical handoffs are read back exactly; each
      archived Task cites its exact OPEN/unassigned issue comment.
- [ ] TC-03: all three Tasks become skipped with byte-identical bodies and only approved lifecycle
      frontmatter/path changes.
- [ ] TC-04: no package/app source, API/contract, package/product doc, policy/gate, skill/workflow/hook,
      topology, baseline, or carrier path changes.
- [ ] TC-05: the exact final changed-path set is the seven approved lifecycle/ledger paths, and
      focused/full verification exits 0.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                                  | Notes                                                                   |
| ----- | --------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| TC-01 | Agreement / manifest  | Git blob comparison, priority/unit/path counts                   | Test skipped: evidence audit observes fixed documentation state.        |
| TC-02 | Agreement / remote    | Exact issue/comment marker and owner readback                    | Test skipped: remote state is append-only control-plane evidence.       |
| TC-03 | Agreement / lifecycle | Task body/frontmatter comparison plus archival/folder scans      | Test skipped: lifecycle scanners and Git bytes prove preservation.      |
| TC-04 | Agreement / exclusion | Exact changed-path classification and carrier/baseline search    | Test skipped: path inventory is the observable result.                  |
| TC-05 | Agreement / CI        | Exact diff, focused scanners/tests, full harness scan, CI mirror | Test skipped: no new behavior; existing gates verify the atomic result. |

## Tasks

- `.agents/tasks/DOCS-037-terminalize-backlog-zero-migration-batch-08.md`

## User Execution Test Scenarios

Not applicable. This changes internal lifecycle evidence and remote queue ownership only. It adds no
runnable user-facing behavior and deliberately leaves all product/package work to GitHub issues.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- Frontmatter, concrete Problem, Prior Art waiver, Architecture Review, five observable Completion
  Criteria, one-to-one Test Plan, Tasks placeholder, and subject-bound non-applicability are present.
- The corrected manifest freezes three units, three blobs, seven final paths, exact skipped
  dispositions, zero carrier/baseline changes, and the excluded-scope boundary.
- `ACTIONABLE FINDINGS: 0`.

### [RECOMMENDATION REVIEW ROUND 1] — 🔴 REVISE | 2026-08-29

- High — urgency ordering: the initial HARNESS-118/HARNESS-900/HARNESS-057 set included two
  `medium/soon` units while conflict-free PLG-020 and TOOL-004 remained `high/now`.
- Medium — criterion mapping: HARNESS-118 retained an unmet literal TC-07 despite delivery of its
  resolver/scan mechanism.
- Medium — current-truth wording: the initial document said the citation scan currently passed even
  though its prospective paths correctly fail before atomic placement; any such statement must bind
  to the base or final tree.
- Initial manifest commit `537703876e02a97da600908c1a60c84b522e5971` is withdrawn before
  approval. `ACTIONABLE FINDINGS: 3`.

**Independent reviewer verdict:** `REVIEW VERDICT: REVISE`

### [RECOMMENDATION REVIEW ROUND 2] — 🔴 REVISE | 2026-08-29

- High — exact ownership: issue #2234 is explicitly an umbrella tracker that proposes no new work of
  its own. RULE-017 forbids treating a related-only or umbrella issue as an exact implementation owner.
- Create a dedicated OPEN/unassigned HARNESS-057 residual issue and canonical handoff, then update
  every owner URL before approval. All other unit, blob, priority, path, and class-boundary checks pass.
- `ACTIONABLE FINDINGS: 1`.

**Independent reviewer verdict:** `REVIEW VERDICT: REVISE`

### [REMOTE-GROUNDING] — ✅ PASS | 2026-08-29

- Base is `92658e1781be80bb66ccd25db6bac4810d5b4444`; all three population/current Task
  blobs match the manifest exactly.
- Issue #2459, issue #2460, issue #2461, and issue #2462 are OPEN and unassigned. Control/residual
  markers are unique; umbrella issue #2234 is related context only and is not used as an owner.
- Canonical comments #5457971404, #5457939546, and #5457939714 belong to the exact owner issues,
  carry the exact Task paths/blobs/current residuals, and have `created_at == updated_at`.
- Current code confirms all three residuals. There is no competing open PR, branch, worktree,
  assignee, or open loop. The final manifest is exactly three `high/now` units and seven paths with
  zero carrier/baseline or excluded paths.
- `ACTIONABLE FINDINGS: 0`.

### [RECOMMENDATION REVIEW ROUND 3] — 🔴 REVISE | 2026-08-29

- Low — remote count: Affected Scope said two new residual issues after the exact HARNESS-057 owner
  was added. The actual set is three: issue #2460, issue #2461, and issue #2462.
- All ownership, blob, premise, urgency, path, carrier/baseline, and class-boundary checks otherwise
  passed. `ACTIONABLE FINDINGS: 1`.

**Independent reviewer verdict:** `REVIEW VERDICT: REVISE`

### [RECOMMENDATION REVIEW ROUND 4] — ✅ ENDORSE | 2026-08-29

- Exact review target: clean commit `75a22a590e149ef304339978e4ffcdfcb3090c03`.
- The sole round-3 count error is fixed. HARNESS-057, PLG-020, and TOOL-004 remain the exact three
  `high/now` units; issue #2462 is the dedicated HARNESS-057 owner and issue #2234 is related-only.
- The manifest remains seven permitted final paths with three exact skipped dispositions, three
  unchanged Task blobs, zero carrier/baseline or excluded changes, and no competing ownership.
- `ACTIONABLE FINDINGS: 0`.

**Independent reviewer verdict:** `REVIEW VERDICT: ENDORSE`

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Given:** 2026-08-28, this conversation
**Evidence condition met:** Independent round-4 recommendation review ENDORSE with ACTIONABLE FINDINGS: 0; live readback confirms three high/now units, seven final paths, exact OPEN/unassigned owners and unmodified handoffs, three unchanged population blobs, zero carriers/baselines, and no excluded or competing scope.
**Review fingerprint:** f0125c804afa (review 56855639, type/tags a0d6c0d0)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (Independent round-4 recommendation review ENDORSE with ACTIO)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (f0125c804afa) equals the document's current fingerprint

### [GATE-APPROVAL] — 🔴 NON-COMPLIANCE | 2026-08-29

- A focused `reference-kind-qualified` scan after the first planning checkpoint found 12 unqualified
  issue references in this document, including one sentence in Architecture Review.
- The prior approval fingerprint `f0125c804afa` is withdrawn. The corrections qualify issue references
  only; they do not change the three governed units, their blobs, urgency, exact owners, dispositions,
  seven-path manifest, zero-baseline/carrier boundary, or excluded scope.
- The first checkpoint and paired control Task are withdrawn. Their sealed loop records remain
  append-only evidence of the rolled-back attempt. No implementation commit or push occurred under
  the stale fingerprint, and the three Task moves and completion checkmarks were rolled back.
- Remote ownership was also clarified without editing history: umbrella issue #2234 now contains
  supersession comment https://github.com/woojubb/robota/issues/2234#issuecomment-5458041985, which
  leaves it related-only and identifies OPEN/unassigned issue #2462 as the exact HARNESS-057 owner.
- The corrected document returns to `review-ready` for a fresh independent recommendation review and
  class approval.

### [RECOMMENDATION REVIEW ROUND 5] — ✅ ENDORSE | 2026-08-29

- Exact review target: clean commit `0f6b308a8461ab8c5fbcd3ff01df66987b67e7d7` against base
  `92658e1781be80bb66ccd25db6bac4810d5b4444`.
- The stale fingerprint is mechanically non-standing. The reference-kind corrections qualify issue
  references only, and supersession comment
  https://github.com/woojubb/robota/issues/2234#issuecomment-5458041985 leaves umbrella issue #2234
  related-only while OPEN/unassigned issue #2462 remains the exact HARNESS-057 owner.
- HARNESS-057, PLG-020, and TOOL-004 remain the exact three `high/now` units with their population
  blobs unchanged at the root. Their exact owner issues #2462, #2460, and #2461 are OPEN and
  unassigned; control issue #2459 is also OPEN and unassigned.
- The manifest remains seven permitted final paths, below the class ceilings, with zero baseline,
  carrier, package/API/policy/workflow/topology/product-document, or other excluded paths.
- `ACTIONABLE FINDINGS: 0`.

**Independent reviewer verdict:** `REVIEW VERDICT: ENDORSE`
