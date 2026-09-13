---
status: approved
type: RULE
tags: [cli]
lane: L1
---

# PRELUDE-2655: Resume an existing Agreement through its normal planning prelude

Paired with `.agents/tasks/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md`. Arising from [issue #2655](https://github.com/woojubb/robota/issues/2655).

## Problem

An existing AGREEMENT-2655 parent Task and its approved/todo spec need a planning-only revision.
The staged and history readers call `agreementPrelude` before `planningPreludeProblems` and
classify the existing parent as a new atomic Agreement manifest. They report `atomic AGREEMENT
parent Task/spec must both be newly added` and require all children to be newly staged, although
this is continuation of an existing planning unit, not creation of a parent/children manifest.

Hume confirmed this LOCAL routing defect. The approved parent records are preserved separately
in main-owned stash `fa772744409666ff2279455fbd0dee9eed305a1a`; this repair neither changes those
records nor claims new implementation authority. The bug occurs for pair edits, spec-only edits
and legitimate pre-checkpoint spec moves. The remedy must preserve all ordinary planning checks
and the stronger atomic requirements for genuine new Agreement creation.

## Prior Art Research

Waived: demonstrated repository-local classifier routing error; the existing generic planning
validator and atomic-manifest validator already define the required behavior. No external
research, architecture sweep or new metadata scheme is needed.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs` — shared `agreementPrelude` classification only.
- `scripts/harness/__tests__/agreement-prelude.test.mjs` — dedicated pure/mocked-process regressions.
- This L1 RULE spec and its exact paired Task; no rule, package API or archival changes.

### Alternatives Considered

1. Make the shared atomic classifier decline already-existing Agreement planning units, allowing
   the normal validator to decide. Pro: one owner fixes staged and both history paths without
   duplicated validation. Con: prior identity must distinguish an Agreement from an ordinary Task.
2. Relax the atomic validator's newly-added parent and child checks. Pro: removes the immediate
   rejection. Con: weakens genuine new-manifest integrity and still misclassifies ordinary planning.
3. Special-case each caller. Pro: each observed path can be repaired independently. Con: duplicates
   routing and risks staged/history divergence; unnecessary when all callers share one classifier.

### Decision

Select alternative 1, following the bounded independent diagnosis. Before applying atomic-new
cardinality/newness checks, establish whether the exact parent Task already had an Agreement
identity in the prior snapshot. If so, return the classifier's existing not-applicable result
(`null`), not a successful atomic result. Existing callers then run their normal planning checks.

Resolve the parent Task by exact basename even when only its spec changes or moves between valid
pre-checkpoint folders. Mere file existence is insufficient: an ordinary Task newly reclassified
as an Agreement must not gain this route. Do not introduce a second validator, parallel graph,
metadata registry, catch-and-accept path or general existing-file exemption. The current user
authorized bounded #2655 harness repair; the paired Task retains that authority and main's
allocation reconciliation. This draft is not a gate verdict or permission to bypass checkpointing.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — shared classifier calls at staged and both history branches, generic planning validator, and existing pure/mock test patterns inspected.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Restrict only `agreementPrelude`'s applicability. The generic validator remains responsible for
same-unit path scope, Task `todo`, spec folder/status agreement, valid same-basename spec moves,
forbidden Task deletion, malformed/rewritten ledgers and pre-checkpoint evidence restrictions.
Caller checks for pending-unit identity, checkpoint ordering and staged residue remain unchanged.
Passing a planning prelude does not authorize a subsequent source edit without a checkpoint.

For genuinely new Agreements, retain exact parent pairing, both-parent-new checks, concrete
source issue, unique newly-added todo children, no nested Agreement, exact Children/Tasks
projections and rejection of unrelated paths. Do not weaken new-manifest validation to accommodate
existing records or grant ordinary-Task reclassification an existing-Agreement exemption.

The inspected shared call sites are history's no-checkpoint branch and pre-checkpoint branch,
plus `findStagedFindings`. Regress all three through in-memory revision/index responses. Reuse
the before/after Map approach in `completion-record-boundaries.test.mjs` and the hoisted
`spawnSync` mock approach in `post-merge-symbolic-cache.test.mjs`; no subprocess may create or
access a fixture repository. Unexpected mock commands fail explicitly. No production reader
redesign or new test framework is needed.

## Affected Files

- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/agreement-prelude.test.mjs`
- `.agents/tasks/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md`
- `.agents/spec-docs/draft/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md`

## Completion Criteria

- [ ] TC-01: An existing Agreement's valid pair edit, spec-only edit with unchanged existing Task, and same-basename pre-checkpoint spec move pass through generic planning validation without requiring new children; each reproduces the original classifier failure before the repair.
- [ ] TC-02: That route still rejects extra source/unrelated Task paths, mixed or conflicting pending units, wrong Task/spec status, invalid deletion/move, malformed/rewritten ledger and premature checkpoint evidence; later unplanned source remains refused.
- [ ] TC-03: Genuine new atomic Agreement manifests still accept only complete valid parent/child projections and reject partial/existing/mismatched parents, missing or existing/non-todo/nested children, invalid issue/projection and extra paths. An ordinary Task reclassified as Agreement does not receive the existing-Agreement exemption.
- [ ] TC-04: The dedicated test file passes as a whole with equivalent staged and history outcomes, including history with no checkpoint and history before a later checkpoint. RED before source edits and GREEN afterward are recorded using only pure snapshots/mocked process boundaries, without Git fixtures or weakened assertions.

## Test Plan

RULE strategy: focused unit cases plus mocked reader integration, in one dedicated file.

| TC-ID | Test Type                 | Tool / Approach                                                                            | Notes                                                                      |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| TC-01 | Unit/integration          | `agreement-prelude.test.mjs`: before/after/index maps through existing readers             | Pair, spec-only and move; capture RED before source edits                  |
| TC-02 | Negative unit/integration | Same dedicated file: mutate paths, lifecycle, ledger, pending unit and checkpoint evidence | Generic refusals remain; no direct atomic success for existing records     |
| TC-03 | Unit/integration          | Same dedicated file: genuine new manifests and ordinary-Task reclassification              | Preserve existing atomic failures; no blanket existing-file exemption      |
| TC-04 | Mocked integration        | `pnpm exec vitest run scripts/harness/__tests__/agreement-prelude.test.mjs`                | Whole file GREEN; staged and both history branches; no real Git subprocess |

Verification is planned, not executed. No local Git fixtures, worktrees, clones, HOME rebinding,
PTY tests or product builds. Main owns subsequent gates/checkpoint and final affected verification;
this authoring step neither runs checks nor supplies historical parent gate judgments.

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-13

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-13, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <4 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 4 changed path(s) — committed and working-tree changes vs origin/develop (merge base ca214393cac3) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md) is at or above the floor L0)
**Review fingerprint:** 6b975875aca1 (review e44a9ced, type/tags 2f92467b)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <4)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (6b975875aca1) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fc7af65e8fbb` · base `origin/develop@ca214393cac3` · document `.agents/spec-docs/draft/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md` blob `61b19be50e91` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-13

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 934 chars, 7 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 4 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 4 Test Plan rows = 4 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 4 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <4)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (6b975875aca1) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fc7af65e8fbb` · base `origin/develop@ca214393cac3` · document `.agents/spec-docs/draft/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md` blob `81d4c04a2ca4` (untracked)
