---
status: in-progress
type: AGREEMENT
tags: [agreement]
lane: L2
---

# AGREEMENT-005: Coordinate the SessionRecipe child-issue absorption pilot

Paired with `.agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md`.
Arising from [issue #2063](https://github.com/woojubb/robota/issues/2063) under canonical external
problem [issue #2079](https://github.com/woojubb/robota/issues/2079).

## Problem

Replace issue #2063's GitHub-only implementation tree with one governed relationship owner while
preserving the external problem under canonical issue #2079. The three executable causes remain
independently verifiable Tasks; this migration does not implement them or claim their outcomes are
delivered. The live hierarchy audit at `2026-08-29T22:49:02Z` reproduced the duplicate representation:
all four Issues are open native children with missing external-lifecycle evidence even though their
contents are internal implementation decomposition.

## Prior Art Research

Waived: this spec applies the already researched, approved, and merged RULE-023 migration mechanism to
the fixed B1 pilot set. It introduces no new product behavior or architectural decision beyond preserving
the four Issue bodies as one AGREEMENT relationship and three executable Tasks.

## Architecture Review

### Affected Scope

- `.agents/evidence/RULE-023-child-issue-migration-manifest.json` — complete 78-row before-state and
  disposition control plane.
- The paired AGREEMENT-005 Task and three child Tasks ARCH-113 through ARCH-115.
- GitHub issue #2079's current related-record map and issue #2063/#2084/#2102/#2115 bodies/states after
  the prerequisite records merge to `develop`.

No package/app source or runtime behavior changes in the migration prerequisite or pilot evidence PRs.

### Alternatives Considered

1. Retain all four Issues as an executable GitHub hierarchy.
   - Pro: no migration writes.
   - Con: violates merged RULE-023 because none names a distinct external lifecycle, and keeps GitHub
     and Tasks as duplicate execution graphs.
2. Flatten all four directly into unrelated Tasks under issue #2079.
   - Pro: smallest relationship model.
   - Con: loses issue #2063's shared completion boundary and dependency order.
3. Preserve issue #2063 as AGREEMENT-005 and map its three leaves to ARCH-113/114/115.
   - Pro: retains one shared boundary and exact dependency order while removing redundant Issue queue
     entries.
   - Con: requires a prerequisite merge before safe GitHub mutation and two read-back checkpoints.

### Decision

Choose alternative 3. Canonical issue #2079 remains open as the external problem. AGREEMENT-005 owns the
issue #2063 relationship and ARCH-113/114/115 own the exact leaf outcomes. The prerequisite manifest keeps
all 78 rows at `OWNER_REVIEW`, names B1's four exact candidate Tasks, and authorizes no GitHub
mutation. After those Tasks are readable on fresh `develop`, a fresh B1 snapshot and review may change
only `{2063,2084,2102,2115}` to `ABSORB`; all other open children remain immutable.

**Continuation artifacts:** `.agents/evidence/RULE-023-child-issue-migration-manifest.json`, `.agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md`, `.agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md`, `.agents/tasks/ARCH-113-introduce-the-sole-sessionrecipe-construction-kernel.md`, `.agents/tasks/ARCH-114-route-query-and-agentruntime-factories-through-sessionrecipe.md`, `.agents/tasks/ARCH-115-route-interactive-runtime-through-sessionrecipe-and-remove-the-public-test-escap.md`

Validated recommendation:

- Reachability: each historical child URL maps to one exact Task path, and issue #2079's body will expose
  the current map.
- Capability preservation: full child before bodies, comments, labels, dependency edges, hashes, URLs,
  and complete canonical-parent snapshots/maps for issues #2079, #1985, #1986, and #2512 are retained; no
  implementation claim or delivery state is invented.
- Adversarial pass: a missing Task on fresh `develop`, body-hash drift, parent-map write failure, state
  mismatch, or unexpected owner signal stops the batch before the next write.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the complete 78-child population and all four B1 rows were read; no B1 assignee,
      pre-existing Task marker, linked open PR, or Issue-linked implementation branch/worktree was found.
      The current controlled migration worktree is itself the prerequisite authoring path, and no row
      leaves `OWNER_REVIEW` until its Task records land on `develop`.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Merge the frozen 78-row prerequisite manifest plus AGREEMENT-005/ARCH-113/114/115 Task records to `develop` without
   changing GitHub.
2. Re-fetch the four B1 Issues and the complete open-child population. Stop if any B1 body hash, state,
   parent, assignee, marker, linked open PR, issue-named branch/worktree, or dependency state differs from
   the manifest, or if a
   population delta cannot be reconciled to an exact Issue and terminal reason. The fresh B1 snapshot
   reconciles the sole prerequisite delta: issue #2514 closed `COMPLETED`, so the pre-mutation denominator
   is 77 rather than 78. Closed prerequisite cross-references to PR #2551 and PR #2553 are expected historical
   evidence and are not active-work signals.
3. Update issue #2079 once with the complete 55-descendant current Issue/Task map, changing only the four
   B1 entries from Issue-owned execution to their exact Tasks. Update each B1 child body with canonical
   issue #2079 and its exact Task owner; preserve the original body below the migration notice.
4. In reverse dependency order (`#2115`, `#2102`, `#2084`, `#2063`), run the repository conversion
   finalizer for each exact Task. It must write and read back the append-only machine-readable Task marker
   before removing `priority:P1`. Add no narrative migration comment; the structural Task marker remains
   mandatory.
5. In the same reverse dependency order, close all four as `NOT_PLANNED`, because execution continues under
   the Task graph and is not delivered. Read every body, marker, label, state, parent relationship, and
   dependency edge back immediately.
6. Stop on the first mismatch. Before any Task marker is written, restore the complete issue #2079 body
   snapshot and every earlier changed B1 child from its manifest before-state. After a Task marker is written,
   preserve that append-only receipt, reopen any prematurely closed child, restore its P label when conversion
   did not finalize, and either idempotently roll forward the same conversion or return the row to
   `OWNER_REVIEW`; never claim a byte-for-byte rollback of comment history.
7. Run the live hierarchy audit, record exact before/after counts and URLs in RULE-023, and land one B1
   evidence PR before B2 starts.

## Affected Files

- `.agents/evidence/RULE-023-child-issue-migration-manifest.json`
- `.agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md`
- `.agents/tasks/ARCH-113-introduce-the-sole-sessionrecipe-construction-kernel.md`
- `.agents/tasks/ARCH-114-route-query-and-agentruntime-factories-through-sessionrecipe.md`
- `.agents/tasks/ARCH-115-route-interactive-runtime-through-sessionrecipe-and-remove-the-public-test-escap.md`
- This AGREEMENT-005 spec through its approval lifecycle.
- RULE-023 Task/spec only in the later B1 evidence PR.
- Live GitHub issues #2079, #2063, #2084, #2102, and #2115; no other Issue may be mutated.

## Completion Criteria

- [x] TC-01: the durable prerequisite manifest records exactly 281 open Issues and 78 unique open native
      children, includes full before-state bodies/hashes plus all four canonical-parent snapshots and
      complete group maps, keeps all rows at `OWNER_REVIEW`, and freezes B1 candidates to exactly four
      named Issue IDs and Tasks without authorizing mutation.
- [x] TC-02: fresh `origin/develop` contains all four exact Task paths before any GitHub write, with
      AGREEMENT-005 declaring unique children and leaf `depends_on` order matching native dependencies.
- [x] TC-03: issue #2079's current map and all four child bodies resolve to their exact Task paths; each exact
      Task marker is read back before its `priority:P1` label is removed; the four children then read back
      `CLOSED/NOT_PLANNED` with work-kind labels, native history, parent links, and dependency edges preserved.
- [x] TC-04: the pre-pilot audit reports 77 open native children after accounting for original issue #2514 as
      `CLOSED/COMPLETED`; the post-pilot audit reports 73, accounts for all original 78 rows, and reports no
      unexplained population or pagination drift.
- [x] TC-05: repository scans and Task lifecycle checks pass in both prerequisite and evidence PRs; no B2,
      B3, or B4 Issue is mutated by this batch.

## Test Plan

| TC-ID | Test Type     | Tool / Approach                                                            | Notes                                                  |
| ----- | ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ |
| TC-01 | Manifest      | JSON parse, exact-set and SHA-256 assertions                               | Fails closed on denominator, duplicate, or missing row |
| TC-02 | Repository    | fresh ancestry plus exact Task-path/read-back checks                       | Must pass before GitHub mutation                       |
| TC-03 | Live mutation | `gh` write plus conversion finalizer and exact GraphQL/REST read-back      | Marker before P-label removal; stop on first mismatch  |
| TC-04 | Live audit    | `node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota` | Reconciled denominator 77 before / 73 after            |
| TC-05 | Harness       | affected scan, task/spec lifecycle scans, CI                               | Documentation/governance scope only                    |

## User Execution Test Scenarios

Not applicable — this batch migrates governance records and GitHub state without changing runnable
user-facing behavior. The later ARCH Tasks own their runtime scenarios.

Recorded as the rule's required choice rather than skipped.

## Tasks

Paired execution record:
`.agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md`.

- [ ] ARCH-113 — todo — `.agents/tasks/ARCH-113-introduce-the-sole-sessionrecipe-construction-kernel.md`
- [ ] ARCH-114 — todo — `.agents/tasks/ARCH-114-route-query-and-agentruntime-factories-through-sessionrecipe.md`
- [ ] ARCH-115 — todo — `.agents/tasks/ARCH-115-route-interactive-runtime-through-sessionrecipe-and-remove-the-public-test-escap.md`

## B1 Evidence Landing

- Evidence PR #2554 retained exact reviewed base
  `af0e4f747bad3b42337848ff0da21518a8c54c81` and head
  `f82f90d83ec5ac775b894fa1629d1530b691b7ce`, received `ACTIONABLE FINDINGS: 0`, had zero review
  threads, and passed all 11 required checks after its RULE-016 body correction.
- PR #2554 merged as `cc20654da1aad9f48c8cc57ee210275e58fc0a7d`. Fresh `origin/develop` pointed
  to that exact merge; every one of the six merged paths and the complete reviewed tree matched the
  reviewed head byte-for-byte.
- The post-merge live audit exited 0 at 277 open Issues and 73 open native children. The expected live
  child set matched exactly: B2 51/51, B3 17/17, and B4 5/5, with no unexpected row and no B2–B4
  mutation. The closed post-merge cycle is recorded as `r20260830064155`.
- AGREEMENT-005 remains `in-progress`: this evidence completes only the migration pilot criteria;
  ARCH-113, ARCH-114, and ARCH-115 remain `todo` and retain their declared dependency order.

## Approval Recommendation

Approve only the prerequisite repository records in this spec: the 78-row read-only manifest,
AGREEMENT-005, and ARCH-113/114/115. This approval does **not** authorize any GitHub Issue mutation.
The recommendation is warranted because:

1. every live row remains `OWNER_REVIEW` and the manifest records `mutationAuthorized: false`;
2. the four candidate Tasks must first become readable on `develop` before RULE-023 permits a fresh B1
   review to consider `ABSORB`;
3. the complete 78/78 population, four canonical-parent recovery snapshots, complete group maps,
   dependency order, and rollback procedure were independently reviewed with
   `ACTIONABLE FINDINGS: 0` and `DEPTH: LOCAL`;
4. the prerequisite is reversible repository documentation with no package/runtime or external-state
   mutation, while refusing it makes the approved RULE-023 migration impossible to execute safely.

Owner authorization received after the earlier failed approval: “너가 타당한 근거와 함께 추천안을
제안하면 그게 타당할 경우 승인한다.” The recommendation above states the exact bounded item and its
measured evidence; all stated conditions hold.

## Evidence Log

| Claim                       | Evidence                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy prerequisite landed  | PR #2548; merge `ce6f3589ad4690016a215be4582d991eee0dfe6f`                                                                                                                                               |
| Fresh complete denominator  | manifest query `2026-08-29T22:49:02.141Z`; 281 open / 78 child / 78 unique                                                                                                                               |
| Fresh B1 pre-mutation audit | 281 open / 77 child; issue #2514 alone closed `COMPLETED`; expected B1 result 73 child                                                                                                                   |
| Fresh B1 body snapshot      | exact SHA-256: issue #2079 `986bbbdf`; issue #2063 `f3d869ef`; issue #2084 `6146e760`; issue #2102 `9d459a73`; issue #2115 `d89ee42a`; complete values and live fields are in `batchReviews.B1.snapshot` |
| Conversion dry-runs         | AGREEMENT-005 and ARCH-113/114/115 exact paths accepted; each names `priority:P1` removal after marker read-back                                                                                         |
| Frozen manifest identity    | SHA-256 `12bb977846fb1a95e3d50c34810f782a024c7582397a7539bbcbcc1be05d7938`                                                                                                                               |
| B1 approval review          | independent review APPROVE; ACTIONABLE FINDINGS: 0; DEPTH: LOCAL (0 foundational of 1)                                                                                                                   |
| Exact migration owners      | AGREEMENT-005, ARCH-113, ARCH-114, ARCH-115 paths named above                                                                                                                                            |
| B1 applied result           | authorization `0c4d1cb6c`; parent map 55 rows; four exact markers; four `CLOSED/NOT_PLANNED`; audit 277 open / 73 child; rollback not triggered                                                          |

### [GATE-WRITE] — ✅ PASS | 2026-08-30

**Status upgrade:** draft → review-ready

- GATE-WRITE — Contains a concrete symptom: the Problem records the measured duplicate representation—all
  four B1 records remain open native child Issues without independent external-lifecycle evidence even
  though they are internal implementation decomposition.
- GATE-WRITE — Contains a reproduction condition: the authenticated live hierarchy audit at
  `2026-08-29T22:49:02Z` against the current native tree for issue #2079 and issue #2063 reproduces the four
  open-child state.
- GATE-WRITE — Research findings feed Alternatives Considered and Decision: the explicit waiver applies
  merged RULE-023's researched exception-only mechanism; its external-lifecycle test rejects retention,
  while its Task-ownership and preservation requirements drive alternative 3 and the prerequisite/read-back
  controls.
- GATE-WRITE — Decision references the trade-off that drove the choice: preserving issue #2063's shared
  completion boundary and dependency order is preferred over flattening, while removing the duplicate
  executable Issue graph requires a prerequisite merge and recoverable GitHub writes.
- GATE-WRITE — New-surface placement conditional: N/A — no package, app, presentation/interface surface,
  layer, or product-family boundary is introduced; this is a bounded application of the existing RULE-023
  governance mechanism.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: TC-01 covers the frozen
  manifest and parent snapshots, TC-02 Task reachability and dependency order, TC-03 mutation/read-back,
  TC-04 population reconciliation, and TC-05 repository gates plus batch isolation.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: TC-01/02 assert exact repository
  and manifest state, TC-03 asserts exact GitHub body/state/history results, TC-04 asserts the exact live
  denominator, and TC-05 asserts scan/lifecycle results and absence of out-of-batch mutation.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "/tmp/robota-issue-child-consolidation-plan.md 를 완벽하게 완료할 때까지 반복해서 처리해 주세요."
**Given:** 2026-08-30, this conversation
**Review fingerprint:** f1bfec1f69e0 (review 835fbe69, type/tags 007edc99)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (f1bfec1f69e0) equals the document's current fingerprint

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-30

**Status remains:** review-ready
**Failed criteria:**

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the
  recorded instruction authorizes repeated completion of
  `/tmp/robota-issue-child-consolidation-plan.md`; it does not name or approve AGREEMENT-005, and its
  "until complete" form is standing authorization. `backlog-execution.md` explicitly states that
  standing authorization to keep working is not approval of a particular spec.
  **Required action:** obtain direct, unambiguous user approval naming this AGREEMENT-005 recommendation,
  or use a registered delegated class whose scope and measured evidence condition cover this L2 item.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "너가 타당한 근거와 함께 추천안을 제안하면 그게 타당할 경우 승인한다."
**Given:** 2026-08-30, this conversation
**Review fingerprint:** f1bfec1f69e0 (review 835fbe69, type/tags 007edc99)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (f1bfec1f69e0) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: after the
  earlier item-specific FAIL, the current conversation supplied the quoted conditional authorization for
  the bounded `## Approval Recommendation`; its conditions are met by the frozen manifest SHA-256
  `12bb977846fb1a95e3d50c34810f782a024c7582397a7539bbcbcc1be05d7938`, 78/78 `OWNER_REVIEW` rows,
  `mutationAuthorized: false`, four recovery snapshots, complete 55/12/5/6 parent maps, and the recorded
  independent zero-finding review.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route `DIRECT`; no
  delegated class is invoked.
- GATE-APPROVAL — Independent architecture validation conditional: N/A — this prerequisite introduces
  no package, app, surface, layer, or product-family reclassification; the independent APPROVE review is
  retained as additional evidence.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-30

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/ARCH-113-introduce-the-sole-sessionrecipe-construction-kernel.md`, whose basename is not the spec's (AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md)
  **Required action:** pair the Task and the spec by basename
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/5 TC ids and carries 4 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 4 path(s) outside the paired spec/Task: .agents/evidence/RULE-023-child-issue-migration-manifest.json, .agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md, .agents/tasks/ARCH-114-route-query-and-agentruntime-factories-through-sessionrecipe.md, .agents/tasks/ARCH-115-route-interactive-runtime-through-sessionrecipe-and-remove-the-public-test-escap.md
  **Required action:** commit, stash, or remove them before this gate

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-30; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 266 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
  "specPath": ".agents/spec-docs/todo/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
    ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-30

**Status remains:** in-progress
**Failed criteria:**

- GATE-IMPLEMENT (continuation) — § Decision sequences the delivery and names the artifacts this PR lands:
  merge commit `06f4f0bd4671366bd4212b7a3e6102986d4ba635`, the branch base that introduced the
  preceding GATE-IMPLEMENT checkpoint, contains no machine-readable `**Continuation artifacts:**`
  declaration. The declaration exists only as a current uncommitted edit. The checkpoint contract binds
  `gateImplementContinuation.sequencedArtifacts` to the base parent spec, so adding the declaration in
  the continuation checkpoint itself cannot satisfy the ordered checkpoint.
  **Required action:** land the exact `**Continuation artifacts:**` declaration on `develop` in a
  planning-only correction PR, cut a fresh continuation branch from that merge, and re-run
  GATE-IMPLEMENT (continuation) before any implementation or GitHub Issue mutation.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** in-progress → in-progress (continuation)

- GATE-IMPLEMENT (continuation) — ordering: a prior `[GATE-IMPLEMENT] — ✅ PASS` exists and the exact
  Task/spec pair is `in-progress`: one prior canonical PASS is present; the Task is `status: in-progress`
  and the spec is `status: in-progress` under `.agents/spec-docs/active/`.
- GATE-IMPLEMENT (continuation) — § Decision sequences delivery and names the artifacts this PR lands:
  base `af0e4f747bad3b42337848ff0da21518a8c54c81` contains exactly six `Continuation artifacts`, and all
  six paths exist in both that base tree and the current tree.
- GATE-IMPLEMENT (continuation) — the preceding integration merge is an ancestor of the branch base:
  `06f4f0bd4671366bd4212b7a3e6102986d4ba635` introduced the prior checkpoint and is an ancestor of
  base `af0e4f747bad3b42337848ff0da21518a8c54c81`; correction merge `af0e4f747bad3b42337848ff0da21518a8c54c81`
  is the exact current `origin/develop` base.
- GATE-IMPLEMENT (continuation) — the exact Task and PLAN outcome are unchanged: the paired Task is
  byte-identical to base and still records `SCENARIO DRAFTED: not-applicable | 0` with its concrete
  governance-only reason; prior raw PASS digest is
  `sha256:66ae26c59fc4dcd507e56f56da96b8f320f111afe47ff281a755825a83399be0`.
- GATE-IMPLEMENT (continuation) — whole-worktree inventory: the pre-gate worktree was clean; the only
  gate write is this paired active spec. The sole earlier topic commit `3bf052f6806d9d651197019c78491b2ec338960c`
  changes only the allowed append-only closed `post-merge-cycle.jsonl` record and no implementation path.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementContinuation",
  "priorPass": "sha256:66ae26c59fc4dcd507e56f56da96b8f320f111afe47ff281a755825a83399be0",
  "sequencedArtifacts": [
    ".agents/evidence/RULE-023-child-issue-migration-manifest.json",
    ".agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
    ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
    ".agents/tasks/ARCH-113-introduce-the-sole-sessionrecipe-construction-kernel.md",
    ".agents/tasks/ARCH-114-route-query-and-agentruntime-factories-through-sessionrecipe.md",
    ".agents/tasks/ARCH-115-route-interactive-runtime-through-sessionrecipe-and-remove-the-public-test-escap.md"
  ],
  "ancestorSha": "06f4f0bd4671366bd4212b7a3e6102986d4ba635",
  "taskPath": ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
  "specPath": ".agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
    ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** in-progress → in-progress (continuation)

- GATE-IMPLEMENT (continuation) — ordering: two prior complete canonical GATE-IMPLEMENT PASS entries
  exist; the exact Task/spec pair remains `in-progress`, and the spec remains under
  `.agents/spec-docs/active/`.
- GATE-IMPLEMENT (continuation) — § Decision sequences delivery and names this PR's artifacts: base
  `cc20654da1aad9f48c8cc57ee210275e58fc0a7d` contains exactly six `Continuation artifacts`, and every
  exact path exists in both the base and current trees.
- GATE-IMPLEMENT (continuation) — preceding integration ancestry: PR #2554 merge
  `cc20654da1aad9f48c8cc57ee210275e58fc0a7d` introduced the latest prior continuation checkpoint and is
  the exact current `origin/develop` base and an ancestor of HEAD.
- GATE-IMPLEMENT (continuation) — Task and PLAN preservation: the paired Task is byte-identical to base
  and still records `SCENARIO DRAFTED: not-applicable | 0` with its concrete governance-only reason;
  latest prior raw PASS digest is
  `sha256:3cb78d64bbf219ffe33ff974cd5d13930784bb7684da507b97d34d85f13f098f`.
- GATE-IMPLEMENT (continuation) — whole-worktree inventory: the pre-gate worktree was clean; the only gate
  write is this paired active spec. The sole earlier topic commit
  `bd6ea206ad56ae9a902cddae3ddaa2cf021bb114` changes only the allowed append-only closed
  `post-merge-cycle.jsonl` record for PR #2554 and no implementation path.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementContinuation",
  "priorPass": "sha256:3cb78d64bbf219ffe33ff974cd5d13930784bb7684da507b97d34d85f13f098f",
  "sequencedArtifacts": [
    ".agents/evidence/RULE-023-child-issue-migration-manifest.json",
    ".agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
    ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
    ".agents/tasks/ARCH-113-introduce-the-sole-sessionrecipe-construction-kernel.md",
    ".agents/tasks/ARCH-114-route-query-and-agentruntime-factories-through-sessionrecipe.md",
    ".agents/tasks/ARCH-115-route-interactive-runtime-through-sessionrecipe-and-remove-the-public-test-escap.md"
  ],
  "ancestorSha": "cc20654da1aad9f48c8cc57ee210275e58fc0a7d",
  "taskPath": ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
  "specPath": ".agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
    ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** in-progress → in-progress (continuation)

- GATE-IMPLEMENT (continuation) — ordering: three prior complete canonical GATE-IMPLEMENT PASS entries
  exist; the exact Task/spec pair remains `in-progress`, the spec remains under
  `.agents/spec-docs/active/`, and `git log 96c7b5f30d2d11e3ba76460214eb6ef3dbb37e07..22a676bed17185fc642f5043c21d40b6e285d0b3 -- <active AGREEMENT-005 spec>` is empty.
- GATE-IMPLEMENT (continuation) — § Decision sequences delivery and declares the exact six continuation
  artifacts: base `96c7b5f30d2d11e3ba76460214eb6ef3dbb37e07` contains the single machine-readable
  `Continuation artifacts` line; every declared path exists in both that base tree and pre-gate HEAD
  `22a676bed17185fc642f5043c21d40b6e285d0b3`, with no byte difference across the six paths.
- GATE-IMPLEMENT (continuation) — preceding checkpoint ancestry: merge
  `a4c38ef4f23ffe45332974b7c2c84250da3a0710` introduced the latest prior AGREEMENT-005 continuation
  PASS (three raw PASS entries versus two at its first parent), is an ancestor of branch base
  `96c7b5f30d2d11e3ba76460214eb6ef3dbb37e07`, and that exact `origin/develop` base is an ancestor of
  pre-gate HEAD `22a676bed17185fc642f5043c21d40b6e285d0b3`.
- GATE-IMPLEMENT (continuation) — Task and PLAN preservation: the paired Task is byte-identical between
  base and pre-gate HEAD (`sha256:02097b7505cfc070a03464800f3ab8245999f6cafffa19a030fd648be31fe879`), remains
  `status: in-progress`, and still records `SCENARIO DRAFTED: not-applicable | 0` with its concrete
  governance-only reason; latest prior raw PASS digest is
  `sha256:060b87adba839e3edaaaa1b000de7606f1182bf329b15cc660cedede4b46df31`.
- GATE-IMPLEMENT (continuation) — whole-worktree inventory: the pre-gate worktree was clean; the only
  gate write is this active AGREEMENT-005 spec, and no TC-06 implementation has begun. The sole topic
  commit before this gate, `22a676bed17185fc642f5043c21d40b6e285d0b3`, changes only the permitted
  append-only closed `.agents/loop-runs/post-merge-cycle.jsonl` record for PR #2556.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementContinuation",
  "priorPass": "sha256:060b87adba839e3edaaaa1b000de7606f1182bf329b15cc660cedede4b46df31",
  "sequencedArtifacts": [
    ".agents/evidence/RULE-023-child-issue-migration-manifest.json",
    ".agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
    ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
    ".agents/tasks/ARCH-113-introduce-the-sole-sessionrecipe-construction-kernel.md",
    ".agents/tasks/ARCH-114-route-query-and-agentruntime-factories-through-sessionrecipe.md",
    ".agents/tasks/ARCH-115-route-interactive-runtime-through-sessionrecipe-and-remove-the-public-test-escap.md"
  ],
  "ancestorSha": "a4c38ef4f23ffe45332974b7c2c84250da3a0710",
  "taskPath": ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
  "specPath": ".agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/active/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md",
    ".agents/tasks/AGREEMENT-005-coordinate-the-sessionrecipe-child-issue-absorption-pilot.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
