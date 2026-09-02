---
status: in-progress
type: AGREEMENT
tags: [agreement, github, product-composition]
lane: L2
---

# AGREEMENT-006: Coordinate ProductPlan and runtime-bindings migration

Paired with `.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`.
Arising from [issue #2070](https://github.com/woojubb/robota/issues/2070) under canonical external
problem [issue #2079](https://github.com/woojubb/robota/issues/2079).

## Problem

Issue #2070 and its three leaves duplicate an internal execution graph in GitHub without an independent
external lifecycle. The code still reproduces the underlying contract defect: `IProductProfile` is called
declarative DATA while carrying live providers, registries, runners, transports, and factories;
`assembleProduct` invokes provider and transport construction while claiming to be a pure fold; optional
winner rules make mutually exclusive provider, preset, and transport sources simultaneously representable.
All four Issues are open P1 children with no assignee, Task marker, Task citation, open PR, matching
branch/worktree, or independent-lifecycle evidence. Their manifest rows remain `OWNER_REVIEW` because exact
Task ownership and batch approval have not yet landed.

## Prior Art Research

Waived: this conversion applies the already researched and approved RULE-023 Issue-to-Task migration
mechanism. It introduces no runtime surface and explicitly defers product-realization placement to
ARCH-116's future recommendation/spec gate. Local structural analog and placement evidence were still
checked during the independent review so the conversion preserves the decision that must later be made.

## Architecture Review

### Affected Scope

- The RULE-023 durable migration manifest and exact candidate rows `{2070,2085,2104,2118}`.
- AGREEMENT-006 plus DATA-008, DATA-009, and ARCH-116 Task records.
- This paired planning spec and generated loop-run ledgers.
- A later, separately authorized GitHub evidence batch for issue #2079 and the four target children.

No package/app source, runtime behavior, public API, package placement, architecture policy, or live GitHub
record changes in this prerequisite work unit.

### Alternatives Considered

1. Retain all four GitHub Issues as the execution hierarchy.
   - Pro: avoids migration writes.
   - Con: none has an independently meaningful external lifecycle, so GitHub and Tasks would duplicate
     priority, ownership, and completion state.
2. Flatten the tracker and all leaves into one Task.
   - Pro: one record is simple to enumerate.
   - Con: it loses three independently verifiable causes and their native dependency order.
3. Convert to one AGREEMENT plus two DATA Tasks and one ARCH Task.
   - Pro: preserves the shared plan/bindings boundary, exact cause split, ordering, external prerequisites,
     and later placement approval without pre-approving product design.
   - Con: requires a prerequisite merge/read-back and a separate recoverable GitHub evidence batch.

### Decision

Choose alternative 3. AGREEMENT-006 owns the shared boundary, dependency sequence, live
[issue #2044](https://github.com/woojubb/robota/issues/2044)/[issue #2443](https://github.com/woojubb/robota/issues/2443)
coordination, future placement-decision gate, old-surface removal condition, and final
[issue #2079](https://github.com/woojubb/robota/issues/2079) map
reconciliation. DATA-008 owns a secret-free structured-cloneable plan vocabulary; DATA-009 owns exhaustive
discriminated source-mode data; ARCH-116 owns the later independently approved placement, realization,
consumer migration, and removal.

This decision authorizes only ownership conversion. It does not approve an effectful `realizeProduct` in
`agent-product`, amend the pure-only carve-out, introduce a new package, change a published contract, or
implement product code. ARCH-116 must make those decisions through its own spec-first recommendation,
independent placement review, and any required user approval.

**Delivery mode:** `sequenced`

**Continuation artifacts:** `.agents/evidence/RULE-023-child-issue-migration-manifest.json`, `.agents/spec-docs/active/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`, `.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`, `.agents/tasks/DATA-008-define-secret-free-structured-cloneable-productplan.md`, `.agents/tasks/DATA-009-encode-product-source-modes-as-discriminated-data.md`, `.agents/tasks/ARCH-116-place-product-realization-and-migrate-consumers.md`

Validated recommendation:

- Reachability: each historical Issue URL maps to one exact Task path and all four remain exposed from
  canonical [issue #2079](https://github.com/woojubb/robota/issues/2079) after the later evidence batch.
- Capability preservation: the three Task boundaries preserve pure/secret-free data, exhaustive mode
  modeling, imperative realization, consumer migration, final removal, and the native order
  `#2085 → #2104 → #2118`.
- Active ownership: open [issue #2044](https://github.com/woojubb/robota/issues/2044) and
  [issue #2443](https://github.com/woojubb/robota/issues/2443) remain live prerequisites; closed
  [issue #2048](https://github.com/woojubb/robota/issues/2048) and completed ARCH-109/CLI-078 are history,
  not delivery.
- Adversarial pass: round 1 found the pure-carve-out placement conflict and omitted
  [issue #2443](https://github.com/woojubb/robota/issues/2443) owner; round 2
  endorsed the corrected authorization boundary and exact prerequisites with no remaining finding.

`REVIEW VERDICT: ENDORSE` on 2026-08-30.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — all four target Issues, their native relations, package source/SPEC, existing
      Tasks, open PRs, branches/worktrees, and live
      [issue #2044](https://github.com/woojubb/robota/issues/2044)/[issue #2443](https://github.com/woojubb/robota/issues/2443)
      owners were checked.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: N/A for this conversion-only work unit. ARCH-116 records the mandatory future
      placement review before any runtime/public surface is changed.

## Fallback & Degradation Declaration

None

## Solution

1. Add the exact AGREEMENT/spec and three child Tasks atomically, preserving native dependency order.
2. Update only the four manifest rows with candidate Task paths while keeping `disposition: OWNER_REVIEW`
   and migration authority false.
3. Run the L2 planning gates and land the prerequisite records on `develop` without GitHub mutation.
4. Re-fetch all four Issues, [issue #2079](https://github.com/woojubb/robota/issues/2079),
   [issue #2044](https://github.com/woojubb/robota/issues/2044),
   [issue #2443](https://github.com/woojubb/robota/issues/2443), native dependencies, Tasks, PRs, branches,
   and population.
5. Only after a fresh independent apply review authorizes the exact rows, update
   [issue #2079](https://github.com/woojubb/robota/issues/2079)'s complete map,
   append/read exact Task markers, remove P labels, close the four children `NOT_PLANNED`, and read every
   body/state/relationship/dependency back. Stop on the first mismatch.
6. Keep the Tasks open for their own implementation lifecycles and terminalize AGREEMENT-006 only after
   all children and the final [issue #2079](https://github.com/woojubb/robota/issues/2079) full-SHA
   mappings are complete.

## Completion Criteria

- [ ] TC-01: the exact four-row candidate set is complete, fresh, independently reviewed, maps to one
      AGREEMENT plus DATA-008/DATA-009/ARCH-116, and remains mutation-unauthorized before merge.
- [ ] TC-02: the parent/child Task and paired spec projections are exact, all four source Issues resolve,
      and dependency order `DATA-008 → DATA-009 → ARCH-116` matches the native Issue graph.
- [ ] TC-03: [issue #2044](https://github.com/woojubb/robota/issues/2044) and
      [issue #2443](https://github.com/woojubb/robota/issues/2443) remain explicit live prerequisites,
      while [issue #2048](https://github.com/woojubb/robota/issues/2048)/ARCH-109/CLI-078 are recorded only
      as history and no migration claims their outcomes complete.
- [ ] TC-04: ARCH-116 cannot implement until its own recommendation/spec gate resolves placement and obtains
      any required package, policy, or published-contract approval.
- [ ] TC-05: a separately approved apply batch preserves all bodies/history/labels/dependencies, writes and
      reads exact Task markers before P-label removal, and closes only the four rows `NOT_PLANNED`.
- [ ] TC-06: AGREEMENT-006 completes only after all three child Tasks are done and issue #2079 contains
      resolvable full-SHA links to their exact completed paths.

## Test Plan

| Criterion | Test Type         | Tool/Approach                                                      | Expected Evidence                                             |
| --------- | ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| TC-01     | Manifest/live     | JSON assertions plus authenticated GitHub read-back                | Exact four candidates; all held; no mutation authority        |
| TC-02     | Lifecycle         | Task placement, AGREEMENT projection, and plan-order scans         | Exact paths, IDs, statuses, and dependency order              |
| TC-03     | Live ownership    | Read linked issues 2044, 2443, and 2048 plus cited Task records    | Live prerequisites and historical evidence remain distinct    |
| TC-04     | Gate/architecture | ARCH-116 Task text plus future recommendation and placement review | No inherited placement or policy approval                     |
| TC-05     | Live migration    | Frozen apply, immediate read-back, and hierarchy audit             | Four exact `NOT_PLANNED` results with preserved history/edges |
| TC-06     | Completion        | Child lifecycle plus issue 2079 map/full-SHA resolution checks     | Three done children and terminal parent reconciliation        |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work unit changes Task/spec governance and GitHub Issue administration only; it exposes no
runnable Robota product surface, so child Tasks must own future public SDK or CLI scenarios.

## Tasks

Paired execution record:
`.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`.

- [ ] DATA-008 — todo — `.agents/tasks/DATA-008-define-secret-free-structured-cloneable-productplan.md`
- [ ] DATA-009 — todo — `.agents/tasks/DATA-009-encode-product-source-modes-as-discriminated-data.md`
- [ ] ARCH-116 — todo — `.agents/tasks/ARCH-116-place-product-realization-and-migrate-consumers.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-30

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — GATE-WRITE is the entry gate, so no prior gate is required; the document has `status: draft` and is in `.agents/spec-docs/draft/`.
- GATE-WRITE — File begins with YAML frontmatter: PASS — the file begins with a delimited `---` YAML frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — the block declares `status: draft`.
- GATE-WRITE — `type:` is one of the permitted values: PASS — `type: AGREEMENT` is one of the 11 permitted values.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags: [agreement, github, product-composition]` is present.
- GATE-WRITE — Contains a concrete symptom: PASS — `IProductProfile` is described as declarative DATA while carrying live runtime objects/factories, and `assembleProduct` is described as invoking provider/transport construction while claiming a pure fold.
- GATE-WRITE — Contains a reproduction condition: PASS — the symptom is located in the current `IProductProfile`/`assembleProduct` composition path, including the condition where provider, preset, and transport source choices are optional and mutually exclusive choices remain simultaneously representable.
- GATE-WRITE — Problem contains no TBD, TODO, or vague single-sentence description: PASS — the Problem is multi-sentence, specific, and contains no `TBD` or `TODO`.
- GATE-WRITE — Prior Art Research section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated or explicitly waived: PASS — the section explicitly waives new external research because this conversion reuses the already researched RULE-023 migration mechanism, and names the limited local structural/placement review performed.
- GATE-WRITE — Explicit `Waived: <reason>` line present: PASS — the section begins with an explicit `Waived:` reason rather than leaving research bare or missing.
- GATE-WRITE — Research findings feed Alternatives Considered and Decision: PASS — the waiver's conversion-only boundary and deferred placement finding directly drive alternative 3 and the Decision's refusal to pre-approve runtime placement, package policy, or product code.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — all five displayed checklist items, including the four required architecture items, are checked.
- GATE-WRITE — Sibling scan is checked with evidence or explicit N/A: PASS — the checked item names the target Issues, native relationships, package source/SPEC, Tasks, open PRs, branches/worktrees, and live prerequisite owners inspected.
- GATE-WRITE — Alternatives Considered has at least two entries with pro and con: PASS — three alternatives are present and each has an explicit pro and con.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — the Decision chooses preserved cause boundaries, dependency order, and later placement approval over either duplicated GitHub lifecycle or a simpler but lossy flattened Task.
- GATE-WRITE — New-surface placement conditional: PASS (N/A) — this work unit changes ownership records only and explicitly introduces no package, app, presentation/interface surface, or layer/product-family reclassification; ARCH-116 retains a future independent placement decision.
- GATE-WRITE — Every Completion Criterion has a TC-N prefix: PASS — all six criteria are prefixed `TC-01` through `TC-06`.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — TC-01 covers the reviewed candidate batch, TC-02 the Task/spec graph, TC-03 live-versus-historical prerequisites, TC-04 the deferred architecture gate, TC-05 the later GitHub apply batch, and TC-06 terminal parent/child reconciliation.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — each criterion identifies inspectable artifacts, states, dependencies, gate evidence, read-back results, or resolvable full-SHA links; none relies on an unobservable quality assertion.
- GATE-WRITE — No banned vague Completion Criteria phrase: PASS — none uses `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — Test Plan section present: PASS — `## Test Plan` is present.
- GATE-WRITE — One Test Plan row exists for each TC-N: PASS — six rows correspond one-to-one with the six Completion Criteria.
- GATE-WRITE — Each Test Plan row has non-empty Test Type and Tool or Approach: PASS — every row has a non-empty Test Type and Tool/Approach and none contains `TBD`.
- GATE-WRITE — Manual rows explain why automation is not possible: PASS (N/A) — no row uses a manual tool, so no manual-only Notes justification is required.
- GATE-WRITE — Tasks section present with placeholder: PASS — `## Tasks` records the paired execution record and the three child Task paths.
- GATE-WRITE — Evidence Log section present and initially empty: PASS — this was the first GATE-WRITE run and the section was empty before this entry.
- GATE-WRITE — No body Status or Classification sections: PASS — there is no body-level `## Status` or `## Classification` section.
- GATE-WRITE — Completion Criteria and Test Plan counts match: PASS — Completion Criteria count `6` matches Test Plan row count `6`.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "타당한 근거와 함께 추천안을 제시하면 타당할 경우 승인하겠다. 지금부터 goal을 달성할 때까지 모두 동일한 기준으로 처리한다"
**Given:** 2026-08-30, this conversation
**Review fingerprint:** 09861a3a69a2 (review 6d381672, type/tags 6b318791)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (09861a3a69a2) equals the document's current fingerprint
- GATE-APPROVAL — Ordering check: PASS — the prior `[GATE-WRITE] — ✅ PASS` entry records `draft → review-ready`; the document declares `status: review-ready` and is in `.agents/spec-docs/backlog/`, the expected GATE-APPROVAL input state.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — immediately after the exact AGREEMENT-006 recommendation and its grounds were presented, the user stated that a recommendation supported by valid grounds is approved when valid and applied that standard from now through this goal; AGREEMENT-006 carries the independent 4/4 LOCAL depth finding, corrected authorization boundary, preserved live prerequisites, and terminal `REVIEW VERDICT: ENDORSE`, so the stated condition is met for the recommendation directly in context.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the entry selects the mutually exclusive DIRECT route, so no delegated class is asserted and the Route CLASS boundary criterion does not apply.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — this conversion-only spec explicitly introduces no package, app, interface/presentation surface, or layer/product-family reclassification; it defers any later runtime placement to ARCH-116's own recommendation/spec gate and independent placement review.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-30

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 4 path(s) outside the paired spec/Task: .agents/evidence/RULE-023-child-issue-migration-manifest.json, .agents/tasks/ARCH-116-place-product-realization-and-migrate-consumers.md, .agents/tasks/DATA-008-define-secret-free-structured-cloneable-productplan.md, .agents/tasks/DATA-009-encode-product-source-modes-as-discriminated-data.md
  **Required action:** commit, stash, or remove them before this gate

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-30; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 522 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 5 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
  "specPath": ".agents/spec-docs/todo/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
    ".agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-31

**Status remains:** in-progress
**Failed criteria:**

- GATE-IMPLEMENT (continuation) — § Decision sequences the delivery and names the artifacts this PR lands:
  the branch base and preceding integration commit
  `3ca5ab0cc5ab550d80ae3b3e3ae08af657d0bb0f` contains no machine-readable
  `**Continuation artifacts:**` declaration under `### Decision`; current pre-gate HEAD contains none
  either. Although the prose describes a later GitHub evidence batch, the checkpoint contract requires
  one exact declaration whose repository paths bind `gateImplementContinuation.sequencedArtifacts`, so
  this continuation cannot identify the artifacts the PR is authorized to land.
  **Required action:** land the exact `**Continuation artifacts:**` declaration on `develop` in a
  planning-only correction PR, cut a fresh continuation branch from that integration commit, and re-run
  GATE-IMPLEMENT (continuation) before any implementation or GitHub Issue mutation.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-02

**Status upgrade:** in-progress → in-progress (correction)

- GATE-IMPLEMENT — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30; status `in-progress`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 659 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 1 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementCorrection",
  "deliveryMode": "sequenced",
  "sequencedArtifacts": [
    ".agents/evidence/RULE-023-child-issue-migration-manifest.json",
    ".agents/spec-docs/active/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
    ".agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
    ".agents/tasks/DATA-008-define-secret-free-structured-cloneable-productplan.md",
    ".agents/tasks/DATA-009-encode-product-source-modes-as-discriminated-data.md",
    ".agents/tasks/ARCH-116-place-product-realization-and-migrate-consumers.md"
  ],
  "priorPass": "sha256:3a2af5a39896d43865314f00a858ea69614b62f9807facae12e5e85372c7d043",
  "firstPassIntroductionSha": "3ca5ab0cc5ab550d80ae3b3e3ae08af657d0bb0f",
  "taskPath": ".agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
  "specPath": ".agents/spec-docs/active/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/active/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
    ".agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-02

**Status upgrade:** in-progress → in-progress (continuation)

- GATE-IMPLEMENT — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-09-02; status `in-progress`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 659 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 0 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementContinuation",
  "deliveryMode": "sequenced",
  "sequencedArtifacts": [
    ".agents/evidence/RULE-023-child-issue-migration-manifest.json",
    ".agents/spec-docs/active/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
    ".agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
    ".agents/tasks/DATA-008-define-secret-free-structured-cloneable-productplan.md",
    ".agents/tasks/DATA-009-encode-product-source-modes-as-discriminated-data.md",
    ".agents/tasks/ARCH-116-place-product-realization-and-migrate-consumers.md"
  ],
  "priorPass": "sha256:9b5a7c1e28638c4f257fa1223f218e511295a0f6cb0890b0b2179379e7744723",
  "ancestorSha": "1fef1658ee4587bde3aee08f082afcaaf2ad3a59",
  "taskPath": ".agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
  "specPath": ".agents/spec-docs/active/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/active/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md",
    ".agents/tasks/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->
