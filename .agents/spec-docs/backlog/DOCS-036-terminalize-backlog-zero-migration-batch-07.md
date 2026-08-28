---
status: review-ready
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-036: Terminalize backlog-zero migration batch 07

## Problem

Three fixed-population backlog records still disagree with current delivery and ownership truth.
HARNESS-103 was delivered and its bypassed plan was deliberately rejected, but its Task remains
`todo`. SEC-009 delivered environment-reference preservation but still sends a literal credential in
the IPC start payload when no reference exists; its unqualified Task direction remains pending even
though issue #1786 closed. HARNESS-108 delivered the then-current 55-barrel expansion and its 16
findings, but the workspace now has 61 root package barrels, declaration identity is still unresolved,
and the source still carries a stale containment comment claiming only 2 of 55 are checked.

The current `origin/develop` base is `66afbe4e710b15a818127205766fb68c269bc4ad`. All three Task blobs
and the three governed citation-carrier documents match the fixed population exactly; the baseline
has evolved only through prior authorized rekeys. No competing PR, branch, worktree, assignee, or open
loop owns any unit. Leaving these records active preserves a second durable queue; marking every Task
done would falsely claim the SEC-009 and HARNESS-108 residuals were delivered.

Issue #2404 owns prevention of future duplicate durable queues. DOCS-036 is finite containment only.

## Prior Art Research

Waived: RULE-017 and the registered `BACKLOG-ZERO-MIGRATION` class already select the fixed-manifest,
exact current-truth readback, remote grounding, history-preserving terminalization, and no-growth
baseline-rekey mechanism. This batch applies that existing process to three internal records and
makes no package, API, product, or policy implementation decision.

## Architecture Review

### Affected Scope

- Three Task lifecycle moves: SEC-009, HARNESS-103, and HARNESS-108.
- Task-path citation rekeys in the already rejected SEC-009/HARNESS-103 plans and the done ARCH-021
  carrier document.
- One no-growth path rekey in `reference-kind-baseline.json` for HARNESS-108, preserving count `2`.
- The paired DOCS-036 Task/spec and two required loop ledgers.
- One SEC-009-specific canonical handoff to existing open issue #2047, one new exact open issue plus
  canonical handoff for HARNESS-108 residuals, and one control issue for this batch.

No package/app source, API/contract, package or product/user documentation, policy/gate document,
skill/workflow/hook/topology, baseline growth, product direction, or issue implementation is in
scope. The stale HARNESS-108 scanner comment is evidence for its residual issue, not a source edit in
this documentation-only batch.

### Alternatives Considered

1. Leave the three records active. Pro: no migration edits. Con: current GitHub ownership and delivery
   evidence remain split across two durable queues.
2. Mark all three Tasks done. Pro: smallest active count. Con: it would claim literal credentials no
   longer cross IPC and that all current barrels plus declaration identity are governed, both false.
3. Apply mixed evidence-backed dispositions. Pro: delivered HARNESS-103 closes locally while the two
   real residuals remain open under exact GitHub owners. Con: requires exact handoff readback and
   citation/baseline rekeys.

### Decision

Choose alternative 3.

- SEC-009 becomes `skipped` only after a new SEC-009-specific handoff to open issue #2047. PR #1804
  merge `7669851c565c958c455a6572c146d91b21007824` delivered the environment-reference half and its
  focused tests still pass, but `createProviderProfile()` deliberately emits literal `apiKey` when
  `apiKeyEnv` is absent. Existing issue #2047 already owns the stronger JSON-safe DTO and
  credential-absence outcome; issue #1786 remains closed as provenance.
- HARNESS-103 becomes `done` with `completed: 2026-08-17`. PR #1804 aligned the interface-package
  rule with a two-edge scan, moved the zero-production-consumer host to the sanctioned testing
  subpath, and froze the remaining mechanisms as a shrink-only ratchet. Current scans and focused
  tests pass. Its rejected plan remains rejected because its literal zero-runtime and package-move
  criteria were superseded by the delivered, reviewed classification.
- HARNESS-108 becomes `skipped` only after a new exact open residual issue and handoff. PR #1867
  merge `8150363b190d5e4d9a2eb9a72c63783c0592256a` delivered the original 55-barrel/16-finding subset.
  Current config still lists 55 while 61 root package barrels exist; declaration identity remains an
  explicit open limitation; and the containment comment is stale. A read-only 61-barrel run is clean,
  so the residual is governance coverage and identity correctness, not six known type defects.

Independent candidate audits mapped the records to current code, tests, issues, delivery commits,
and competing ownership. HARNESS-103 reported `ACTIONABLE FINDINGS: 0`. SEC-009 and HARNESS-108 each
reported one remote-grounding precondition that this manifest makes explicit.

The duplicate durable-queue cause is foundational: these lifecycle moves cannot prevent a later Task
from surviving beside an issue. Issue #2404 owns that prevention invariant.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — internal lifecycle, citations, ledgers, and one no-growth
      baseline rekey only
- [x] Sibling scan 완료 — blobs, issues, PRs, commits, current code/tests, barrels, branches,
      worktrees, loops, assignees, citations, and baselines checked
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Migration Manifest

Population object: `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

Pre-approval base: `origin/develop` at `66afbe4e710b15a818127205766fb68c269bc4ad`.

Limits: 3 units; 11 final tracked paths. The six governed fixed-population Task/spec/carrier blobs are
identical at population, base, HEAD, and worktree. The baseline current blob is fixed at
`ec67ae89d867028ea2683429f98b89cd4c99dd97`; its population blob
`9ef08cccbdb99f835efd8f5c0b64c2e74f2709f0` differs only because earlier approved batches rekeyed
other entries. This batch moves one key and preserves its value `2`, with zero baseline growth.

| Unit        | Governed original paths and blob OIDs                                                                                                                                                                                                                                                                                                                                                              | Current ownership and evidence                                                                                                                   | Criterion-level disposition                                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-009     | Task `.agents/tasks/SEC-009-subagent-ipc-start-payload-carries-apikey.md` @ `3402b39fb9a50fa57993e76f7d4958b3151222f1`; rejected plan `.agents/spec-docs/rejected/SEC-009-subagent-ipc-start-payload-carries-apikey.md` @ `acd5e186c3aca218870959d71c94f2460ea5e78e`; carrier `.agents/spec-docs/done/ARCH-021-child-process-subagent-composition.md` @ `7bb5725ddad30e844516fc564abaee0d4e53b3a7` | Closed issue #1786 and PR #1804 delivered reference preservation; open/unassigned issue #2047 owns the stronger DTO/credential-absence residual. | Append/read back a SEC-009-specific issue #2047 handoff; preserve Task body; archive skipped to that exact comment; rekey three Task-path citations across the rejected plan and done carrier. |
| HARNESS-103 | Task `.agents/tasks/HARNESS-103-interface-runtime-scan-is-narrower-than-its-rule.md` @ `1ec1965a168a7fff0d2aaf686326e1c388698d6e`; rejected plan `.agents/spec-docs/rejected/HARNESS-103-interface-runtime-scan-is-narrower-than-its-rule.md` @ `04b74ff93f0b92c49238978e640ad0f197d453fa`                                                                                                         | Closed issue #1797; PR #1804 merge `7669851c565c958c455a6572c146d91b21007824`; current interface-runtime scan passes and focused tests pass.     | Preserve Task body, mark done, and rekey its two Task-path citations in the already rejected plan. No remote handoff or plan-state change.                                                     |
| HARNESS-108 | Task `.agents/tasks/HARNESS-108-barrel-parameter-types-covers-two-of-fifty-five-barrels.md` @ `c8883411cc67ea8f78e926f695a3bfed823b9d01`; baseline `scripts/harness/reference-kind-baseline.json` current @ `ec67ae89d867028ea2683429f98b89cd4c99dd97`                                                                                                                                             | Closed issue #1851 and PR #1867 delivered 55/55 and 16/16 at that time; no exact open residual owner exists at manifest freeze.                  | Create exact open residual owner and canonical handoff; preserve Task body; archive skipped to the exact comment; rekey its baseline key root→completed with value `2` unchanged.              |

Live ownership check: no open PR, matching implementation branch, extra worktree, assignee, open loop,
session, or reservation owns any unit. Current branch `docs/backlog-zero-batch-07` is the sole migration
owner and owns no package implementation. Any governed blob, delivery conclusion, or ownership change
excludes that unit and requires fresh manifest approval.

Planned control marker: `backlog-zero:DOCS-036:2c875dd3`. Planned HARNESS-108 residual marker:
`backlog-zero:HARNESS-108-RESIDUAL:2c875dd3`. Both must be unique, open, and unassigned before
approval. The SEC-009 handoff must bind its exact Task/blob to issue #2047. Parent issue #2404 remains
open for later batches and prevention.

### Baseline and carrier disposition

The HARNESS-108 reference-kind baseline key moves to the completed Task path with its exact value `2`;
there is no added key or count change. SEC-009 and HARNESS-103 exact Task-path citations rekey in their
existing planning/carrier documents without changing historical claims. No other baseline or carrier
changes.

## Solution

1. Commit this exact manifest; create/read back the DOCS-036 control issue and HARNESS-108 residual
   issue; append/read back exact SEC-009 and HARNESS-108 canonical handoffs.
2. Record class approval only after independent proof of issue/comment ownership, unchanged blobs,
   eleven-path scope, delivery mappings, and the one no-growth baseline rekey.
3. Create the paired execution/scenario checkpoint, then apply the three Task moves and exact
   citation/baseline rekeys without rewriting historical Task bodies.
4. Run focused lifecycle/path/reference/delegation/scanner checks, preservation audit, full harness
   scan, and CI mirror on final atomic placement.

## Affected Files

- `.agents/loop-runs/backlog-execution-orchestrator.jsonl`
- `.agents/loop-runs/user-execution-scenario.jsonl`
- `.agents/spec-docs/done/DOCS-036-terminalize-backlog-zero-migration-batch-07.md`
- `.agents/tasks/completed/DOCS-036-terminalize-backlog-zero-migration-batch-07.md`
- `.agents/tasks/completed/SEC-009-subagent-ipc-start-payload-carries-apikey.md`
- `.agents/spec-docs/rejected/SEC-009-subagent-ipc-start-payload-carries-apikey.md`
- `.agents/spec-docs/done/ARCH-021-child-process-subagent-composition.md`
- `.agents/tasks/completed/HARNESS-103-interface-runtime-scan-is-narrower-than-its-rule.md`
- `.agents/spec-docs/rejected/HARNESS-103-interface-runtime-scan-is-narrower-than-its-rule.md`
- `.agents/tasks/completed/HARNESS-108-barrel-parameter-types-covers-two-of-fifty-five-barrels.md`
- `scripts/harness/reference-kind-baseline.json`

## Completion Criteria

- [ ] TC-01: the committed manifest contains exactly three units, seven governed current blobs,
      eleven final tracked paths, exact mixed dispositions, and one value-preserving baseline rekey.
- [ ] TC-02: control/residual issues and both canonical handoffs are read back exactly; SEC-009 and
      HARNESS-108 cite their exact open-owner comments while HARNESS-103 has no returned issue.
- [ ] TC-03: HARNESS-103 becomes done; SEC-009 and HARNESS-108 become skipped; all three Task bodies
      remain byte-identical and no rejected plan is promoted.
- [ ] TC-04: five Task-path citations across the SEC-009/HARNESS-103 carrier documents rekey exactly,
      and the HARNESS-108 baseline moves one key while retaining value `2` and cardinality.
- [ ] TC-05: the exact final changed-path set is the eleven approved lifecycle/ledger paths, no
      excluded path changes, and focused/full verification exits 0.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                             | Notes                                                                   |
| ----- | ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| TC-01 | Agreement / manifest   | Git blob comparison, unit/path count, baseline diff         | Test skipped: evidence audit observes fixed documentation state.        |
| TC-02 | Agreement / remote     | Exact issue marker and `gh api` comment readback            | Test skipped: remote state is append-only control-plane evidence.       |
| TC-03 | Agreement / lifecycle  | Task body/frontmatter comparison plus archival/folder scans | Test skipped: lifecycle scanners and Git bytes prove preservation.      |
| TC-04 | Agreement / references | Exact citation diff, reference-kind and Task citation scans | Test skipped: document/baseline state is the observable result.         |
| TC-05 | Agreement / CI         | Exact diff, focused scanners, full harness scan, CI mirror  | Test skipped: no new behavior; existing gates verify the atomic result. |

## Tasks

- [ ] `.agents/tasks/DOCS-036-terminalize-backlog-zero-migration-batch-07.md`

## User Execution Test Scenarios

Not applicable. This changes internal lifecycle evidence, references, and remote queue ownership only.
It adds no runnable user-facing behavior and deliberately leaves SEC-009/HARNESS-108 implementation
to their GitHub owners.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- GATE-WRITE — Frontmatter: the document begins with YAML frontmatter and declares `status: draft`,
  allowed type `INFRA`, non-empty tags, and lane `L2`.
- GATE-WRITE — Problem: the concrete symptoms are HARNESS-103 remaining `todo` after delivery,
  SEC-009 retaining a literal-credential IPC path after its closed issue delivered only reference
  preservation, and HARNESS-108 retaining a 55-barrel/16-finding record while the current workspace
  has 61 root barrels plus unresolved declaration identity and a stale containment comment. The
  reproduction condition fixes population object `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`,
  current base `66afbe4e710b15a818127205766fb68c269bc4ad`, exact governed blobs, current
  code/test/count observations, and the absence of competing ownership. No TBD, TODO, or vague
  single-sentence problem is present.
- GATE-WRITE — Prior Art Research: the explicit waiver identifies RULE-017 and the registered
  `BACKLOG-ZERO-MIGRATION` process. Those findings directly select alternative 3 and drive the
  Decision's fixed manifest, exact remote handoffs, history-preserving mixed dispositions,
  citation rekeys, and value-preserving no-growth baseline rekey rather than asserted completion.
- GATE-WRITE — Architecture Review: all four checklist items are checked with concrete sibling-scan
  evidence; three alternatives each state a pro and con; and the Decision names the governing
  trade-off—truthful delivery and residual ownership require more exact handoff/rekey evidence than
  leaving records active, while avoiding the false claims produced by marking all three done.
- GATE-WRITE — New-surface placement: N/A. The spec introduces or reclassifies no package, app,
  presentation/interface surface, layer, product-family boundary, API, contract, workflow, or
  product behavior; its affected scope is internal lifecycle documentation, citations, two ledgers,
  and one no-growth baseline-key move.
- GATE-WRITE — Completion Criteria: TC-01 through TC-05 cover the distinct manifest boundary,
  remote owners and handoffs, three Task dispositions and body preservation, five citation rekeys
  plus the value-preserving baseline rekey, and the exact path/exclusion/verification result. Every
  criterion is observable through exact counts, URLs, statuses, byte equality, key/cardinality
  equality, path inventories, or command exit codes.
- GATE-WRITE — Test Plan and structure: five non-empty Test Plan rows map one-for-one to the five
  TC-N criteria; no row uses a manual tool; the Tasks placeholder is present; this was the empty
  Evidence Log on the first GATE-WRITE run; and no body `Status` or `Classification` section exists.
- GATE-WRITE — Mechanical criteria: 20/20 PASS; semantic criteria: 7/7 PASS; total: 27/27 PASS;
  TC-N/Test Plan count: 5/5; `ACTIONABLE FINDINGS: 0`.

**Independent guardian verdict:** `GATE VERDICT: PASS`
