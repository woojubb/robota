---
status: in-progress
type: BEHAVIOR
tags: [harness, gate]
lane: L2
---

# BEHAVIOR-2663: Bind mechanical GATE-VERIFY checks without prose drift

Paired with `.agents/tasks/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md`. Arising from [issue #2663](https://github.com/woojubb/robota/issues/2663).

## Problem

The GATE-VERIFY catalogue calls two Task-plan criteria mechanical, but
`scripts/harness/gate-operations.mjs` binds their evaluators by regular expressions over the prose.
The catalogue now says “Every item in the `## Plan` section…” and “No Plan item…”, while the
evaluator still matches the older “All tasks…” and “No tasks…” wording. Both decidable criteria
therefore become `PENDING-GUARDIAN` even though `task-plan-items` can answer them, and another
editorial change can silently reproduce the same routing defect.

## Prior Art Research

Waived: this is a repository-private catalogue-to-evaluator identity correction; the relevant
precedent is the repository's existing stable judgement IDs and fail-closed registry behavior, not
an external product contract.

## Architecture Review

### Affected Scope

- `.agents/specs/gate-catalogue.md` — authoritative GATE-VERIFY criteria and their binding metadata.
- `scripts/harness/gate-catalogue.mjs` — single parser for catalogue criteria.
- `scripts/harness/gate-operations.mjs` — judgement registry lookup and fail-closed verdict routing.
- `scripts/harness/__tests__/gate.test.mjs` — parser, binding, prose-drift, and missing-evaluator cases.

### Alternatives Considered

1. Update the two regular expressions to the catalogue's current wording.
   - Pro: smallest code change and immediately restores both evaluators.
   - Con: keeps prose as identity, so the next editorial change can silently unbind them again.
2. Add an explicit stable judgement ID to the two catalogue criteria and resolve it through the
   existing per-gate judgement registry (chosen).
   - Pro: prose can change without changing evaluator identity, and a missing registry member is an
     exact machine-detectable configuration failure.
   - Con: adds optional binding metadata to the catalogue parser and one more invariant to test.
3. Infer the evaluator from the existing `task-plan-items` parenthetical or from criterion order.
   - Pro: avoids adding a new catalogue token.
   - Con: overloads a scan name or list position as identity and leaves intent implicit and brittle.

### Decision

Choose alternative 2. A criterion may carry an explicit trailing
`(`judgement:<stable-id>`)` annotation after its mechanical tag. `parseCatalogue` removes that
annotation from displayed criterion text and exposes the ID separately. `judgeCriteria` resolves an
explicit ID by exact equality inside the existing gate-local `JUDGEMENTS` registry; it uses legacy
wording patterns only for criteria that have not yet opted into explicit binding. Any mechanical
criterion that cannot resolve an evaluator returns a mechanical FAIL with the missing ID or wording,
never `PENDING-GUARDIAN`.

The recommendation preserves capability because the two existing evaluator functions and their
gate-local ownership do not move. Reachability is proven through the real GATE-VERIFY judgement path,
not only through parser unit tests. Adversarial cases rewrite both criterion sentences while keeping
their IDs, remove or mutate an ID, and retain one legacy pattern-bound criterion as a compatibility
control. No fallback maps an unknown ID by prose.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — catalogue parsing, the gate-local judgement registry, composite selection,
      and GATE-VERIFY execution were inspected as the complete binding path.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no package, app, presentation/interface surface, layer
      boundary, or product-family classification changes.

## Fallback & Degradation Declaration

None

## Solution

1. Extend `scripts/harness/gate-catalogue.mjs` to parse an optional explicit judgement ID without
   leaving binding metadata in the user-facing criterion text.
2. Annotate the two Task-plan GATE-VERIFY criteria in `.agents/specs/gate-catalogue.md` with their
   existing gate-local judgement IDs.
3. Update `scripts/harness/gate-operations.mjs` to resolve explicit IDs exactly, retain pattern lookup
   only for unannotated criteria, and fail closed when a mechanical criterion resolves no evaluator.
4. Extend `scripts/harness/__tests__/gate.test.mjs` with current-wording, rewritten-prose,
   missing/unknown-ID, and legacy-pattern controls through the real judgement path.

## Affected Files

- `.agents/specs/gate-catalogue.md`
- `scripts/harness/gate-catalogue.mjs`
- `scripts/harness/gate-operations.mjs`
- `scripts/harness/__tests__/gate.test.mjs`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` exits 0, and the new
      current-wording GATE-VERIFY case reports both Task-plan criteria as unbound against the pre-fix
      evaluator.
- [ ] TC-02: Rewording either annotated Task-plan criterion while preserving its judgement ID still
      invokes the intended evaluator and produces its PASS or FAIL result rather than
      `PENDING-GUARDIAN`.
- [ ] TC-03: A mechanical criterion with a missing or unknown evaluator binding produces a
      mechanical FAIL that names the unresolved binding and writes no PASS entry.
- [ ] TC-04: Existing unannotated mechanical criteria continue to resolve through their legacy
      patterns, and
      `HARNESS_BASE_REF=origin/integration/agreement-2664 node scripts/harness/run-all-scans.mjs --affected --context pr --base origin/integration/agreement-2664`
      exits 0 apart from explicitly identified pre-existing PR-context advisories.

## Test Plan

| TC-ID | Test Type          | Tool / Approach                                 | Notes                                                        |
| ----- | ------------------ | ----------------------------------------------- | ------------------------------------------------------------ |
| TC-01 | Unit / regression  | focused `gate.test.mjs` GATE-VERIFY fixture     | Capture both current prose forms failing before the fix.     |
| TC-02 | Unit / integration | parsed catalogue plus real `judgeCriteria` path | Rewrite prose but preserve exact stable IDs.                 |
| TC-03 | Unit / negative    | unknown and absent evaluator fixtures           | Assert FAIL, diagnostic identity, and no written PASS entry. |
| TC-04 | Regression / suite | legacy pattern control plus affected scan       | Preserve unmigrated bindings and repository-wide invariants. |

## User Execution Test Scenarios

Not applicable.

**Reason:** This changes a private repository gate-routing contract and has no Robota CLI, TUI,
browser, public SDK, or installed-package interaction that an end user can execute.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — ordering: PASS — this is the entry gate; the document is in `draft/` with
  `status: draft`, and no prior gate is required.
- GATE-WRITE — mechanical criteria: PASS — `gate.mjs judge --gate GATE-WRITE --dry-run` judged 27
  criteria as 20 PASS, 0 FAIL, and 7 PENDING-GUARDIAN; every mechanical criterion passed.
- GATE-WRITE — concrete symptom: PASS — the Problem names the two current GATE-VERIFY sentences,
  their stale regular-expression bindings, and the observed `PENDING-GUARDIAN` misrouting.
- GATE-WRITE — reproduction condition: PASS — the Problem identifies the real L2 GATE-VERIFY path
  where the catalogue's current wording is parsed and no evaluator pattern matches.
- GATE-WRITE — research feeds the recommendation: PASS — the explicit waiver is appropriate for a
  repository-private identity correction, and the inspected internal stable judgement IDs and
  gate-local registry directly motivate alternatives 2 and 3 and the exact-ID decision.
- GATE-WRITE — Decision trade-off: PASS — the Decision chooses exact stable IDs over the smaller
  regex edit because it prevents recurrence, while retaining legacy pattern lookup only for
  unmigrated criteria to bound the compatibility cost.
- GATE-WRITE — new-surface placement: PASS (N/A) — the spec introduces no package, app,
  presentation/interface surface, layer boundary, or product-family classification.
- GATE-WRITE — Completion Criteria coverage: PASS — TC-01 covers the current regression, TC-02
  prose-independent exact binding, TC-03 fail-closed missing/unknown evaluators, and TC-04 legacy
  compatibility plus affected repository verification.
- GATE-WRITE — Completion Criteria form: PASS — each TC names an executable command or a bounded
  observable verdict and diagnostic; none relies on vague success language.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `6ebcd6a75a95` · base
`origin/integration/agreement-2664@6ebcd6a75a95` · document
`.agents/spec-docs/draft/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md`
blob `faad858681c5`

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** d6b156acf44d (review 2e1d1559, type/tags a4c76bad)

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: [GATE-WRITE] — ✅ PASS | 2026-09-20 (the PASS that upgraded the status; a later out-of-order entry does not revoke it); status `review-ready`
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (d6b156acf44d) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `6ebcd6a75a95` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/backlog/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md` blob `92e6455c63c0` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** d6b156acf44d (review 2e1d1559, type/tags a4c76bad)

- GATE-APPROVAL — ordering: PASS — the prior GATE-WRITE entry passed and the document remains
  `status: review-ready` in `backlog/`.
- Route DIRECT — explicit approval in the current conversation: PASS — the exact user instruction
  `승인함.` is recorded by the mechanical approval entry with the current date and conversation.
- Route DIRECT — document-directed approval: PASS — the current goal is the user-approved
  `/tmp/robota-harness-model-execution-plan.md` execution through #2664 completion; BEHAVIOR-2663 is
  the next named #2664 child, and the agent presented this document's exact stable-ID recommendation,
  affected path, fail-closed behavior, and rationale under the user's instruction that evidence-backed
  recommendations are automatically approved. The approval is therefore applied to this presented
  recommendation, not inferred from silence or another item.
- Route CLASS — registry criteria: PASS (N/A) — the mutually exclusive route is DIRECT; no delegated
  class is cited or used.
- Gate-definition approval boundary: PASS — `.agents/specs/gate-catalogue.md` is explicitly in the
  approved #2664 gate-correctness plan and this entry relies on the user's DIRECT `승인함.`, not a
  delegated class or agent authority.
- Both routes — Architecture Review fingerprint: PASS — the recorded fingerprint `d6b156acf44d`
  matches the unchanged Architecture Review and type/tags content.
- Both routes — independent architecture validation: PASS (N/A) — the spec introduces no package,
  app, surface, layer boundary, or product-family reclassification.
- NON-COMPLIANCE check — implementation before approval: not triggered — the worktree contains only
  this paired planning document; no implementation path has changed.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Verdict reason:** the DIRECT instruction and the approved #2664 gate-correctness plan cover this
exact recommendation, including its named gate-catalogue edit; all remaining common criteria pass.

GATE VERDICT: PASS

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 252 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md",
  "specPath": ".agents/spec-docs/todo/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md",
    ".agents/tasks/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `6ebcd6a75a95` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/todo/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md` blob `aa2bc2c7a435` (untracked)
