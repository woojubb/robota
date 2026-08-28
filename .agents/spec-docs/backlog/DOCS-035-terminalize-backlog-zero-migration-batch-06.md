---
status: review-ready
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-035: Terminalize backlog-zero migration batch 06

## Problem

At fixed population object `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`, three valid internal
backlog records remain nonterminal after their current truth has diverged. DOCS-028 and HARNESS-122
were delivered on `develop`, but their local Tasks remain active and their bypassed planning
documents cannot truthfully be promoted to `done`. CONFIG-002 delivered its fail-closed loader axis,
while its exported writer still emits a legacy shape that the loader rejects and no open GitHub issue
owns that residual contract decision.

The current `origin/develop` base is `50ae76f48da52afa37b2d717c42cf74cb9ef8823`. All five governed
Task/spec blobs are unchanged from the fixed population or the base, and no competing PR, branch,
worktree, assignee, session, or loop reservation owns them. Leaving the records active preserves the
repository as a second durable queue; marking every record done would manufacture gate history and
falsely claim CONFIG-002's residual writer contract was delivered.

Issue #2404 owns prevention of future duplicate durable queues. DOCS-035 is finite containment only.

## Prior Art Research

Waived: RULE-017 and the registered `BACKLOG-ZERO-MIGRATION` class already select the fixed-manifest,
exact current-truth readback, remote grounding, and history-preserving terminalization mechanism.
This batch applies that mechanism to three internal backlog units and two paired planning documents;
it makes no package, API, product, or policy implementation decision.

## Architecture Review

### Affected Scope

- Three Task lifecycle moves: DOCS-028, HARNESS-122, and CONFIG-002.
- Two paired planning-document rejections for bypassed/stale plans: DOCS-028 and HARNESS-122.
- The paired DOCS-035 Task/spec and two required loop ledgers.
- One new exact OPEN issue plus an append-only canonical handoff for CONFIG-002's residual writer
  contract, and one control issue for this batch.

No package/app source, API/contract, package or product/user documentation, policy/gate document,
skill/workflow/hook/topology, baseline, carrier, or product-direction change is in scope.

### Alternatives Considered

1. Leave all five records where they are. Pro: no local edits. Con: preserves duplicate and stale
   ownership after delivery/residual work has been measured exactly.
2. Mark every Task and plan done. Pro: smallest active count. Con: invents historical gates for two
   plans and falsely claims CONFIG-002's incompatible writer contract was delivered.
3. Apply mixed evidence-backed dispositions. Pro: delivery truth, plan-history truth, and residual
   ownership remain distinct. Con: requires exact remote issue/comment readback and five byte-level
   preservation checks.

### Decision

Choose alternative 3.

- DOCS-028 Task becomes `done` with `completed: 2026-08-23`; PR #2204 merge
  `918ba647036b700e249d9b301287e5431c00931b` delivered every Task criterion, while promotion PR
  pull request #2257 merely carried the issue-closing keyword. Its approved planning document becomes
  `rejected`
  because implementation landed without GATE-IMPLEMENT through GATE-COMPLETE history; rejection
  preserves delivery truth without manufacturing gate verdicts.
- HARNESS-122 Task becomes `done` with `completed: 2026-08-25`; PR #2341 merge
  `8c8cde208c9510805a82b9e9d7ecec22fb6c07cd` delivered the ledger-kind solution after review proved
  the proposed date-pattern suppression would hide genuine ratios. Its draft planning document
  becomes `rejected` because its stale pattern criteria and absent gate history cannot become done
  retroactively.
- CONFIG-002 Task becomes `skipped` only after a new exact OPEN issue and canonical handoff own the
  residual exported writer/loader contradiction. Closed issue #2023 and PR #2285 delivered the
  fail-closed loader axis but explicitly excluded `updateModelInSettings`; the historical issue link
  remains provenance while `returned_to_issue` names the new sole active owner.

Independent candidate audits mapped every criterion to current code, tests, issue records, delivery
commits, and current ownership. DOCS-028 and HARNESS-122 reported `ACTIONABLE FINDINGS: 0`.
CONFIG-002 reported one required precondition: create and read back the exact residual issue and
handoff before terminalization. The manifest makes that precondition explicit rather than treating a
closed partial-delivery issue as an owner.

The duplicate durable-queue cause is foundational: these lifecycle moves cannot prevent a new record
from surviving beside an issue. Issue #2404 owns that prevention invariant, so this batch remains
bounded finite containment.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — internal lifecycle records and loop ledgers only
- [x] Sibling scan 완료 — blobs, issues, PRs, commits, current code/tests, branches, worktrees,
      reservations, baselines, carriers, and duplicate issues checked
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Migration Manifest

Population object: `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

Pre-approval base: `origin/develop` at `50ae76f48da52afa37b2d717c42cf74cb9ef8823`.

Limits: 3 units; 9 final tracked paths. Every governed Task/spec blob is identical at the population
object where present, base, HEAD, and worktree. There are zero baseline rekeys and zero baseline
additions.

| Unit        | Governed original paths and blob OIDs                                                                                                                                                                                                                                                                                                      | Current ownership and evidence                                                                                                                                                                                                                                        | Criterion-level disposition                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOCS-028    | Task `.agents/tasks/DOCS-028-a-spec-restates-a-fact-its-manifest-owns.md` @ `5c90a1d76a66966a940347b095e8a032c800b55c`; plan `.agents/spec-docs/todo/DOCS-028-a-spec-restates-a-fact-its-manifest-owns.md` @ `ba98347421ca1b75496cf4e12eef21c1e7057565`                                                                                    | CLOSED/COMPLETED issue #2194; implementation PR #2204 merge `918ba647036b700e249d9b301287e5431c00931b`; promotion PR #2257 merge `12a4ecd1b741199c989ded9f956bfaa0e212b9f8`. Current focused tests and scans pass.                                                    | Preserve Task body, mark Task done, and reject the bypassed approved plan with a dated evidence entry plus its completed Task-path rekey. No remote handoff is needed because no implementation remains.                    |
| HARNESS-122 | Task `.agents/tasks/HARNESS-122-progress-report-quantification-reads-an-m-d-date-as-a-partial-completion-ratio.md` @ `6b14d4d9480c1358f1ff1fd460a931707bb14d8c`; plan `.agents/spec-docs/draft/HARNESS-122-progress-report-quantification-reads-an-m-d-date-as-a-partial-completion-ratio.md` @ `488f739e1fb552c24c403e5ba129b188df0c665b` | CLOSED/COMPLETED issue #2339; definitive correction comment https://github.com/woojubb/robota/issues/2339#issuecomment-5411165154; PR #2341 merge `8c8cde208c9510805a82b9e9d7ecec22fb6c07cd`; focused tests 55/55.                                                    | Preserve Task body, mark Task done, and reject the stale draft plan with a dated evidence entry. The ledger-kind design supersedes the refuted pattern proposal; no implementation remains and no remote handoff is needed. |
| CONFIG-002  | Task `.agents/tasks/CONFIG-002-config-loader-silently-drops-corrupt-settings-and-writers-produce-a-shape-it-rejects.md` @ `1e890999cc72eab64bd9f5fe9398c6be16aa40dd`                                                                                                                                                                       | CLOSED/COMPLETED issue #2023 delivered the loader axis via PR #2285 merge `91f11f7c093f7a8f66077fa0927fc68f872c145a`; exact OPEN/unassigned residual issue #2453 carries the canonical handoff https://github.com/woojubb/robota/issues/2453#issuecomment-5457119808. | Preserve the Task body and archive it skipped to the exact residual comment without claiming delivery; retain issue #2023 only as provenance for the delivered half.                                                        |

Live ownership check: no open PR, matching implementation branch, extra worktree, assignee, open
loop run, session, or reservation owns any unit. Current branch `docs/backlog-zero-batch-06` is the
sole migration owner and owns no package implementation. Any governed blob, delivery conclusion, or
ownership change excludes that unit and requires fresh manifest approval.

Control issue #2454 carries `backlog-zero:DOCS-035:2c875dd3`. CONFIG-002 residual issue #2453 carries
`backlog-zero:CONFIG-002-RESIDUAL:2c875dd3` and the canonical handoff above. Both are unique, OPEN,
and unassigned. Parent issue #2404 remains open for later batches and prevention.

### Baseline disposition

No governed Task or planning document requires a baseline/carrier rekey. ID-only containment labels
continue to resolve through completed/rejected lookup and the exact remote owner. No baseline or
carrier file changes.

## Solution

1. Commit this exact manifest; create and read back the DOCS-035 control issue and CONFIG-002
   residual issue; append and read back one canonical residual handoff.
2. Record class approval only after independent proof of issue/comment ownership, unchanged blobs,
   nine-path scope, delivery mappings, and zero baseline/carrier/excluded changes.
3. Create the paired execution/scenario checkpoint, then apply the three Task moves and two exact
   planning-document rejections without rewriting historical bodies.
4. Run focused lifecycle/path/reference/delegation checks, preservation audit, full harness scan, and
   CI mirror on the final tree.

## Affected Files

- `.agents/loop-runs/backlog-execution-orchestrator.jsonl`
- `.agents/loop-runs/user-execution-scenario.jsonl`
- `.agents/spec-docs/done/DOCS-035-terminalize-backlog-zero-migration-batch-06.md`
- `.agents/tasks/completed/DOCS-035-terminalize-backlog-zero-migration-batch-06.md`
- `.agents/tasks/completed/DOCS-028-a-spec-restates-a-fact-its-manifest-owns.md`
- `.agents/spec-docs/rejected/DOCS-028-a-spec-restates-a-fact-its-manifest-owns.md`
- `.agents/tasks/completed/HARNESS-122-progress-report-quantification-reads-an-m-d-date-as-a-partial-completion-ratio.md`
- `.agents/spec-docs/rejected/HARNESS-122-progress-report-quantification-reads-an-m-d-date-as-a-partial-completion-ratio.md`
- `.agents/tasks/completed/CONFIG-002-config-loader-silently-drops-corrupt-settings-and-writers-produce-a-shape-it-rejects.md`

## Completion Criteria

- [ ] TC-01: the committed manifest contains exactly three units, five governed source blobs, nine
      final tracked paths, exact mixed dispositions, and zero baseline/carrier changes.
- [ ] TC-02: control/residual issues and the CONFIG-002 canonical handoff are read back exactly;
      CONFIG-002 cites that exact comment while both delivered Tasks need no returned issue.
- [ ] TC-03: DOCS-028 and HARNESS-122 Tasks become done with byte-identical bodies, CONFIG-002 becomes
      skipped with a byte-identical body, and neither bypassed/stale plan is promoted to done.
- [ ] TC-04: both paired plans become rejected with dated truthful evidence; the DOCS-028 paired path
      rekeys to its completed Task, and no historical gate verdict is manufactured.
- [ ] TC-05: the exact final changed-path set is the nine approved lifecycle/ledger paths, no excluded
      path changes, and focused/full verification exits 0.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                                | Notes                                                                                 |
| ----- | --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| TC-01 | Agreement / manifest  | Git blob comparison, unit/path count, baseline/carrier search  | Test skipped: evidence audit observes fixed documentation state.                      |
| TC-02 | Agreement / remote    | Exact issue marker and `gh api` comment readback               | Test skipped: remote state is append-only control-plane evidence.                     |
| TC-03 | Agreement / lifecycle | Task body/frontmatter comparison plus archival/folder scans    | Test skipped: lifecycle scanners and Git bytes prove preservation.                    |
| TC-04 | Agreement / history   | Rejection-entry, folder/status, and Task-path citation scans   | Test skipped: document state and evidence text are the observable result.             |
| TC-05 | Agreement / CI        | Exact diff, focused scanners, full harness scan, and CI mirror | Test skipped: no new behavior; existing gates verify the atomic documentation result. |

## Tasks

- [ ] `.agents/tasks/DOCS-035-terminalize-backlog-zero-migration-batch-06.md`

## User Execution Test Scenarios

Not applicable. This changes internal lifecycle evidence and remote queue ownership only. It adds no
runnable user-facing behavior and deliberately leaves CONFIG-002 package/API work to its new issue.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- GATE-WRITE — Frontmatter: the file begins with YAML frontmatter and declares `status: draft`, the
  permitted `INFRA` type, and a non-empty `tags` field.
- GATE-WRITE — Problem: the concrete symptom is three fixed-population backlog records remaining
  nonterminal despite two delivered units and one partially delivered unit with no exact open residual
  owner; the reproduction condition names the population/base OIDs, five unchanged governed blobs,
  empty competing ownership sets, and the current incompatible writer/loader behavior. No TBD, TODO,
  or vague one-sentence problem statement is present.
- GATE-WRITE — Prior Art Research: the explicit waiver identifies RULE-017 and the registered
  `BACKLOG-ZERO-MIGRATION` mechanism; that mechanism feeds alternative 3 and the Decision's fixed
  manifest, exact current-truth readback, canonical handoff, and history-preserving mixed disposition.
- GATE-WRITE — Architecture Review: all four checklist items are checked; the sibling scan carries
  concrete completion evidence; three alternatives each state a pro and a con; and the Decision accepts
  exact remote readback and byte-level preservation in exchange for truthful delivery, plan-history,
  and residual-ownership records instead of deletion or false completion.
- GATE-WRITE — New-surface placement: N/A because the spec explicitly introduces or reclassifies no
  package, app, presentation/interface, API/contract, policy, workflow, topology, or product surface.
- GATE-WRITE — Completion Criteria: TC-01 through TC-05 cover the distinct manifest, remote-control and
  residual ownership, three Task dispositions, two planning-document rejections, exact path/exclusion
  boundary, and final verification outcomes; every criterion uses observable counts, issue/comment
  readbacks, blob-preservation conditions, lifecycle statuses, path inventories, or command exits.
- GATE-WRITE — Test Plan: five non-empty rows map one-for-one to the five TC-N criteria, each with a
  Test Type and Tool/Approach; no row uses a manual tool, so manual-only Notes justification is N/A.
- GATE-WRITE — Structure: the Tasks section contains its pre-approval placeholder, this was the empty
  Evidence Log on the first run, and no body `Status` or `Classification` section exists.
- GATE-WRITE — Mechanical criteria: 20/20 PASS; semantic criteria: 7/7 PASS; TC-N/Test Plan count: 5/5;
  `ACTIONABLE FINDINGS: 0`.

### [REMOTE-GROUNDING] — ✅ PASS | 2026-08-29

- Branch and manifest identity: `HEAD` is `09940943e5b37d02a7a9ab153bdf14837c114801`;
  base `50ae76f48da52afa37b2d717c42cf74cb9ef8823` and frozen-manifest commit
  `88243db46600ec413a5a3e0b356d7fb26fe59587` are ancestors; the frozen commit is a direct child of
  the base, and the remote-grounding commit changes only this DOCS-035 spec.
- Governed blobs: all five fixed-population, base, `HEAD`, and worktree OIDs are exact — DOCS-028
  Task `5c90a1d76a66966a940347b095e8a032c800b55c` and plan
  `ba98347421ca1b75496cf4e12eef21c1e7057565`; HARNESS-122 Task
  `6b14d4d9480c1358f1ff1fd460a931707bb14d8c` and plan
  `488f739e1fb552c24c403e5ba129b188df0c665b`; CONFIG-002 Task
  `1e890999cc72eab64bd9f5fe9398c6be16aa40dd`.
- Remote control plane: issue #2454 uniquely carries `backlog-zero:DOCS-035:2c875dd3`; issue #2453
  uniquely carries `backlog-zero:CONFIG-002-RESIDUAL:2c875dd3`; both are OPEN and unassigned.
  Canonical comment https://github.com/woojubb/robota/issues/2453#issuecomment-5457119808 belongs
  to issue #2453, carries the exact residual marker and handoff, and is unmodified
  (`created_at == updated_at == 2026-08-28T19:55:02Z`).
- Delivery provenance: issues #2194, #2339, and #2023 are CLOSED/COMPLETED and unassigned; PRs
  #2204, #2257, #2341, and #2285 are MERGED with the manifest's exact merge commits. Delivery
  commits `918ba647036b700e249d9b301287e5431c00931b`,
  `8c8cde208c9510805a82b9e9d7ecec22fb6c07cd`, and
  `91f11f7c093f7a8f66077fa0927fc68f872c145a` are ancestors of `HEAD` and `origin/develop`;
  DOCS-028 delivery is also an ancestor of main-only promotion merge
  `12a4ecd1b741199c989ded9f956bfaa0e212b9f8`. HARNESS-122 correction comment
  https://github.com/woojubb/robota/issues/2339#issuecomment-5411165154 is exact and unmodified.
- Ownership and scope: no open matching PR, implementation branch, extra worktree, assignee, open
  loop run, long-lived process, or visible competing session owns a unit. The manifest contains
  exactly three unique units and nine final tracked paths, with zero baseline/carrier rekeys or
  additions and zero package/app, API/contract, product/package-documentation, policy/gate,
  skill/workflow/hook/topology, or other excluded paths.
- `ACTIONABLE FINDINGS: 0`.
