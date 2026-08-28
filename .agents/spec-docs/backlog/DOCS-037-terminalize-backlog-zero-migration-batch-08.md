---
status: review-ready
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-037: Terminalize backlog-zero migration batch 08

## Problem

Three fixed-population harness backlog records no longer describe the repository's durable ownership
truth. HARNESS-118 and HARNESS-900 were delivered and their GitHub issues were closed, but their Task
records remain active. HARNESS-057 delivered the suite-wide zero-subject refusal and an adoption
ratchet, but the migration is incomplete: 98 of 148 registered scans currently declare what they
examined, leaving 50 under the tracking issue that already names HARNESS-057.

The current `origin/develop` base is `92658e1781be80bb66ccd25db6bac4810d5b4444`. All three Task
blobs, the HARNESS-900 active spec, and the standing-delegation baseline match the frozen manifest.
No open PR, matching branch, extra worktree, assignee, or open loop owns these units. Leaving the
records active preserves a second durable queue; marking HARNESS-057 done would falsely claim the
remaining 50 scans have adopted the invariant.

Issue #2404 owns prevention of future duplicate durable queues. DOCS-037 is finite containment only.

## Prior Art Research

Waived: RULE-017 and the registered `BACKLOG-ZERO-MIGRATION` class already select the fixed-manifest,
current-truth readback, exact GitHub ownership, history-preserving terminalization, and no-growth
baseline-rekey mechanism. This batch applies that existing mechanism and changes no package, API,
product, policy, workflow, hook, or topology.

## Architecture Review

### Affected Scope

- Three Task lifecycle moves: HARNESS-118 and HARNESS-900 become done; HARNESS-057 becomes skipped
  only after an exact handoff to open tracking issue #2234.
- The already verifying HARNESS-900 planning document becomes done with a completion entry and its
  two exact Task-path citations rekeyed to the completed Task.
- The standing-delegation baseline moves the HARNESS-900 spec key from `active/` to `done/`, retaining
  cardinality 218 and adding no exemption.
- The paired DOCS-037 Task/spec and two required loop ledgers.
- One control issue and one append-only HARNESS-057 canonical handoff.

No package/app source, API/contract, package or product/user documentation, policy/gate document,
skill/workflow/hook/topology, baseline growth, or product-direction change is in scope.

### Alternatives Considered

1. Leave all three records active. Pro: no lifecycle edits. Con: two delivered units and one exact
   open-owner residual remain duplicated in the repository queue.
2. Mark all three done. Pro: smallest active count. Con: falsely claims HARNESS-057's remaining
   adoption work is complete.
3. Apply evidence-backed mixed dispositions. Pro: delivered work closes locally while unfinished
   adoption remains solely owned by its open GitHub tracker. Con: requires exact remote handoff and
   value/cardinality-preserving baseline proof.

### Decision

Choose alternative 3.

- HARNESS-118 becomes `done` with `completed: 2026-08-25`. PR #2274 merge
  `2b0ab1dbf6bac776b8ac91f4bc3a7301a1e36fcf` added and wired the Task-path citation resolver and
  scan, repaired the mechanical citations, and made unresolved conflicts explicit exemptions rather
  than unsafe inferred repairs. Issue #2248 closed after remote-tree verification. The current scan
  passes and reports four intentionally outstanding human decisions, which the Task declared out of
  scope rather than unfinished implementation of the resolver.
- HARNESS-900 becomes `done` with `completed: 2026-08-26`. PR #2372 merge
  `ccdb5e65a8c586ad63b13e1c2449162040967634` added the independent manifest-edge oracle; issue
  #2215 closed after verifying the merge on `develop`. The current scan cross-checks four manifest
  edges, its focused suite covers the historical disappearing-projection defect, and every Task plan
  item is checked. Its verifying spec is completed truthfully rather than rejected.
- HARNESS-057 becomes `skipped` only after an exact current-truth handoff to open/unassigned tracking
  issue #2234. The central mechanism is live, but `examined-adoption-baseline.json` currently contains
  98 names while `SCAN_COMMANDS` registers 148 scans. The remaining 50 declarations are real work;
  issue #2234 explicitly requires every scan to report its examined size and is the canonical owner.

ARCH-047, ARCH-048, and ARCH-049 were considered first because of their `now` urgency. They remain
valid, but moving them requires four package-document carrier rekeys, which the delegated class
excludes. They are not silently deprioritized or smuggled into this batch.

### Architecture Review Checklist

- [x] Affected scope listed — internal lifecycle records, one existing spec, two ledgers, and one
      no-growth baseline rekey only.
- [x] Sibling scan completed — blobs, issues, PRs, commits, current scans/tests, branches,
      worktrees, loops, assignees, citations, and baselines checked.
- [x] At least two alternatives considered.
- [x] Decision rationale documented.

## Fallback & Degradation Declaration

None.

## Migration Manifest

Population object: `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

Pre-approval base: `origin/develop` at `92658e1781be80bb66ccd25db6bac4810d5b4444`.

Limits: 3 units; 9 final tracked paths. The three Task blobs are identical at population, base,
HEAD, and worktree. The HARNESS-900 spec and standing-delegation baseline current blobs are frozen
below. The baseline changes one existing key, preserves 218 entries, and adds nothing.

| Unit        | Governed original paths and blob OIDs                                                                                                                                                                                                                                                                                                                                                                | Current ownership and evidence                                                                                                                                           | Criterion-level disposition                                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HARNESS-118 | Task `.agents/tasks/HARNESS-118-citations-of-a-task-record-path-are-not-re-derived-when-the-record-moves-is-rena.md` @ `ae95019cc09a962c815e335d192c62f5ec2d913d`                                                                                                                                                                                                                                    | CLOSED/COMPLETED issue #2248; PR #2274 merge `2b0ab1dbf6bac776b8ac91f4bc3a7301a1e36fcf`; current Task-path citation scan passes.                                         | Preserve the Task body, mark done, and archive it. No remote handoff or carrier rekey is required.                                                                        |
| HARNESS-900 | Task `.agents/tasks/HARNESS-900-cross-check-the-projected-interface-graph-against-the-package-manifests.md` @ `7dbe2f6da1eb818c8cdc3cb1f7e79c1cccdbcbc8`; active spec `.agents/spec-docs/active/HARNESS-900-cross-check-the-projected-interface-graph-against-the-package-manifests.md` @ `3e6fba7960ce5aabddb74d3a61ce4313b7130051`; standing baseline @ `9988892ae31e368fd2ffc43ee937b826e9e1d464` | CLOSED/COMPLETED issue #2215; PR #2372 merge `ccdb5e65a8c586ad63b13e1c2449162040967634`; current oracle scan passes with four manifest edges.                            | Preserve the Task body, mark done, complete the verifying spec with exact Task-path rekeys, and move its baseline key `active/`→`done/` with value/cardinality unchanged. |
| HARNESS-057 | Task `.agents/tasks/HARNESS-057-a-scan-must-report-the-size-of-what-it-examined.md` @ `779a5cbe5c639e1e2ba9deea6c9f91c2d1d3dc26`                                                                                                                                                                                                                                                                     | OPEN/unassigned tracking issue #2234 explicitly names HARNESS-057; current measured adoption is 98/148, leaving 50. Exact canonical handoff is required before approval. | Preserve the Task body and archive skipped to the exact open-owner comment; no source, rule, or baseline migration work is performed here.                                |

Live ownership check: no open PR, matching implementation branch, extra worktree, assignee, open
loop, or reservation owns any unit. Current branch `docs/backlog-zero-batch-08` is the sole migration
owner and owns no package implementation. Any governed blob, delivery conclusion, ownership change,
or excluded carrier excludes the affected unit and requires a fresh manifest approval.

The pending control marker is `backlog-zero:DOCS-037:2c875dd3`. The pending HARNESS-057 handoff
marker is `backlog-zero:HARNESS-057:779a5cbe`. Both must be unique and read back unmodified before
class approval. Parent issue #2404 remains open for later batches and prevention.

### Baseline and carrier disposition

The standing-delegation baseline replaces exactly one HARNESS-900 spec key, `active/` with `done/`,
and retains cardinality 218. The HARNESS-900 spec rekeys its two exact Task citations. HARNESS-118 has
no exact Task-path carrier. HARNESS-057's relative links from completed Tasks become valid when the
Task joins them in `completed/`, so no carrier edit is required. No other baseline or carrier changes.

## Solution

1. Commit this exact manifest; create/read back the DOCS-037 control issue; append/read back the
   HARNESS-057 canonical handoff on issue #2234.
2. Record class approval only after independent proof of remote ownership, unchanged blobs,
   nine-path scope, delivery mappings, and the one no-growth baseline rekey.
3. Create the paired execution/scenario checkpoint, then apply the three Task moves, HARNESS-900
   spec completion/citation rekeys, and exact baseline key move.
4. Run focused lifecycle, citation, delegation, and feature checks; preservation audit; full harness
   scan; and CI mirror on the final tree.

## Affected Files

- `.agents/loop-runs/backlog-execution-orchestrator.jsonl`
- `.agents/loop-runs/user-execution-scenario.jsonl`
- `.agents/spec-docs/done/DOCS-037-terminalize-backlog-zero-migration-batch-08.md`
- `.agents/tasks/completed/DOCS-037-terminalize-backlog-zero-migration-batch-08.md`
- `.agents/tasks/completed/HARNESS-118-citations-of-a-task-record-path-are-not-re-derived-when-the-record-moves-is-rena.md`
- `.agents/tasks/completed/HARNESS-900-cross-check-the-projected-interface-graph-against-the-package-manifests.md`
- `.agents/spec-docs/done/HARNESS-900-cross-check-the-projected-interface-graph-against-the-package-manifests.md`
- `scripts/harness/standing-delegation-baseline.json`
- `.agents/tasks/completed/HARNESS-057-a-scan-must-report-the-size-of-what-it-examined.md`

## Completion Criteria

- [ ] TC-01: the committed manifest contains exactly three units, five governed current blobs, nine
      final tracked paths, exact mixed dispositions, and one value/cardinality-preserving baseline rekey.
- [ ] TC-02: the control issue and HARNESS-057 canonical handoff are read back exactly; HARNESS-057
      cites that exact open-owner comment while the two delivered Tasks need no returned issue.
- [ ] TC-03: HARNESS-118 and HARNESS-900 become done; HARNESS-057 becomes skipped; all three Task
      bodies remain byte-identical and only approved lifecycle frontmatter/path changes occur.
- [ ] TC-04: the HARNESS-900 spec becomes done with truthful completion evidence, its two Task paths
      rekey exactly, and the standing-delegation baseline retains 218 entries.
- [ ] TC-05: the exact final changed-path set is the nine approved lifecycle/ledger paths, no excluded
      path changes, and focused/full verification exits 0.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                               | Notes                                                                   |
| ----- | --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| TC-01 | Agreement / manifest  | Git blob comparison, unit/path count, baseline diff           | Test skipped: evidence audit observes fixed documentation state.        |
| TC-02 | Agreement / remote    | Exact issue marker and `gh api` comment readback              | Test skipped: remote state is append-only control-plane evidence.       |
| TC-03 | Agreement / lifecycle | Task body/frontmatter comparison plus archival/folder scans   | Test skipped: lifecycle scanners and Git bytes prove preservation.      |
| TC-04 | Agreement / history   | Spec status/evidence, citation, and standing-delegation scans | Test skipped: document and baseline state are the observable result.    |
| TC-05 | Agreement / CI        | Exact diff, focused scanners, full harness scan, CI mirror    | Test skipped: no new behavior; existing gates verify the atomic result. |

## Tasks

- `.agents/tasks/DOCS-037-terminalize-backlog-zero-migration-batch-08.md` — created only after approval.

## User Execution Test Scenarios

Not applicable. This changes internal lifecycle evidence and remote queue ownership only. It adds no
runnable user-facing behavior and deliberately leaves HARNESS-057 implementation to its GitHub owner.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- Frontmatter, Problem, Prior Art waiver, Architecture Review, five observable Completion Criteria,
  one-to-one Test Plan, Tasks placeholder, and subject-bound non-applicability rationale are present.
- The manifest freezes three units, five current blobs, nine final paths, exact dispositions, one
  no-growth baseline rekey, and the excluded-scope boundary.
- Independent candidate review remains required after remote grounding; this entry makes no approval
  or delivery claim beyond the measured draft contents.
- `ACTIONABLE FINDINGS: 0`.
