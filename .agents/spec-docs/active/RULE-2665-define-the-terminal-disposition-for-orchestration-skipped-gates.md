---
status: in-progress
type: RULE
tags: [harness, gate, orchestration]
lane: L2
---

# RULE-2665: Define the terminal disposition for orchestration-skipped gates

Paired with `.agents/tasks/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md`. Arising from [issue #2665](https://github.com/woojubb/robota/issues/2665).

## Problem

The gate catalogue defines only a `tool-defect` closure disposition. It has no truthful terminal form
for a different failure: `gate.mjs` correctly returns `PENDING-GUARDIAN` or another non-PASS, writes no
PASS entry, and the orchestrator nevertheless advances the document. If the skip is discovered only
after later transitions or delivery consumed the original gate input state, re-running the gate cannot
recreate that state without rewriting history.

HARNESS-2660 is the concrete reproduction. Its original GATE-WRITE run reported 20 PASS, 0 FAIL, and
7 PENDING-GUARDIAN, but orchestration ran approval instead of dispatching the guardian. The completed
spec now contains a retrospective GATE-WRITE NON-COMPLIANCE and substantive guardian judgement, but
the catalogue and `scan-gate-closure-disposition.mjs` can express only a false `tool-defect` claim or
no recognized closure at all. A normal criterion FAIL must not gain the same escape route.

## Prior Art Research

Waived: this is repository-private recovery policy. The governing precedents are the existing
`tool-defect` disposition, `backlog-execution.md` terminal-state contract,
`backlog-pipeline` NON-COMPLIANCE route, the sealed HARNESS-2660 evidence, and GitHub issue #2665.

## Architecture Review

### Affected Scope

- `.agents/specs/gate-catalogue.md` — disposition vocabulary and exact evidence form.
- `.agents/rules/backlog-execution.md` — terminal-state and owner-authority boundary.
- `.agents/skills/backlog-pipeline/SKILL.md` — NON-COMPLIANCE routing before and after irreversibility.
- `scripts/harness/scan-gate-closure-disposition.mjs` — structural fail-closed validation.
- `scripts/harness/__tests__/scan-gate-closure-disposition.test.mjs` — accepted and adversarial forms.
- `.agents/spec-docs/done/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md`
  — the one historical record reconciled by appending the new disposition.

### Alternatives Considered

1. Reject every orchestration-skipped item and require a new Task/spec from `draft`.
   - Pro: preserves the strongest possible gate-order invariant and adds no exception vocabulary.
   - Con: cannot truthfully reconcile an already-merged historical delivery without deleting sealed
     evidence or pretending the original input state still exists.
2. Reuse or broaden the existing `tool-defect` disposition.
   - Pro: reuses the current evidence line and scanner.
   - Con: records a false cause when the gate tool behaved correctly, weakening both defect ownership
     and future auditability.
3. Add a narrowly bounded `orchestration-skip` NON-COMPLIANCE disposition (chosen).
   - Pro: preserves the failed transition as NON-COMPLIANCE, names the human/orchestration cause, and
     makes the exceptional closure structurally auditable without manufacturing a PASS.
   - Con: adds a second exception form whose admissibility requires owner judgement and therefore must
     remain narrower than ordinary FAIL or recoverable pre-delivery mistakes.

### Decision

Choose alternative 3, but make reject-and-restart the default. Before delivery becomes irreversible,
an orchestration skip stops the pipeline and the affected item is rejected; replacement work begins
from a newly approved Task/spec. `orchestration-skip` is admissible only when the skip is discovered
after the original gate input state has been consumed and delivery is already terminal, the gate tool
itself behaved correctly, the same gate has a recorded NON-COMPLIANCE and no PASS, every skipped
semantic criterion was retrospectively judged, downstream gates were independently revalidated, and
the owner explicitly authorizes disclosed closure.

The machine-readable line records a violation ID, exact gate, NON-COMPLIANCE date, repository-relative
retrospective-judgement path, and GitHub authority URL. The scanner requires the same document to
contain exactly one matching NON-COMPLIANCE entry and no PASS for that gate, requires the judgement
path to resolve under `.agents/spec-docs/`, and validates the authority URL. It accepts `tool-defect`
unchanged but never lets a FAIL, wrong gate/date, missing path, duplicate disposition, or tool-defect
line satisfy `orchestration-skip`.

**Delivery mode:** `single`

Reachability is through the already-registered `gate-closure-disposition` scan. Capability is
preserved because recoverable violations still stop and reject, while the existing tool-defect route
remains byte-compatible. Adversarial fixtures cover ordinary FAIL, wrong gate/date, existing PASS,
missing judgement path, malformed authority, duplicates, and the unchanged tool-defect control.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: repository-private recovery policy whose governing evidence is the existing gate catalogue, HARNESS-2660 record, and issue #2665
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None. An unrecognized, malformed, or structurally unsupported disposition remains a scan failure; the
scanner does not downgrade it to an advisory or infer intent from prose.

## Solution

1. Extend `.agents/specs/gate-catalogue.md`, `.agents/rules/backlog-execution.md`, and
   `.agents/skills/backlog-pipeline/SKILL.md` with the reject-first admissibility boundary and exact
   `orchestration-skip` evidence form.
2. Extend `scripts/harness/scan-gate-closure-disposition.mjs` to parse both disposition kinds and
   validate orchestration-skip evidence against the same spec's gate entries, durable judgement path,
   and authority URL.
3. Add accepted, malformed, wrong-gate/date, ordinary-FAIL, existing-PASS, missing-path, duplicate,
   and tool-defect-control fixtures in
   `scripts/harness/__tests__/scan-gate-closure-disposition.test.mjs`.
4. Append one machine-readable closure line to the completed HARNESS-2660 Evidence Log without
   modifying its sealed gate entries or retrospective judgement prose.

## Affected Files

- `.agents/specs/gate-catalogue.md`
- `.agents/rules/backlog-execution.md`
- `.agents/skills/backlog-pipeline/SKILL.md`
- `scripts/harness/scan-gate-closure-disposition.mjs`
- `scripts/harness/__tests__/scan-gate-closure-disposition.test.mjs`
- `.agents/spec-docs/done/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md`
- `.agents/tasks/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md`
- `.agents/spec-docs/active/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`
- `.agents/tasks/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`

## Completion Criteria

- [ ] TC-01: Observable: the catalogue, terminal-state rule, and pipeline skill all state
      reject-and-restart as the recoverable default and allow `orchestration-skip` only for an
      irreversible, terminal delivery with retrospective guardian judgement and owner authority.
- [ ] TC-02: Command: `pnpm exec vitest run scripts/harness/__tests__/scan-gate-closure-disposition.test.mjs`
      exits 0; the new accepted fixture fails before the scanner implementation is changed.
- [ ] TC-03: Observable: fixtures reject a wrong gate/date, ordinary FAIL, existing same-gate PASS,
      missing judgement path, malformed authority, duplicate disposition, and malformed line, while
      the existing exact `tool-defect` form remains accepted.
- [ ] TC-04: Command: `node scripts/harness/scan-gate-closure-disposition.mjs` exits 0 after exactly one
      `orchestration-skip` line is appended to the completed HARNESS-2660 spec; its existing Evidence
      Log entries and retrospective judgement prose remain unchanged.
- [ ] TC-05: Command:
      `HARNESS_BASE_REF=origin/integration/agreement-2664 node scripts/harness/run-all-scans.mjs --affected --context pr --base origin/integration/agreement-2664`
      exits 0 apart from explicitly identified pre-existing PR-context advisories.

## Test Plan

| TC-ID | Test Type            | Tool / Approach                                                                                                                | Notes                                                                 |
| ----- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| TC-01 | Contract / review    | exact sections in `gate-catalogue.md`, `backlog-execution.md`, and `backlog-pipeline/SKILL.md`                                 | One admissibility boundary must be stated consistently by all owners. |
| TC-02 | Unit / red-green     | `scripts/harness/__tests__/scan-gate-closure-disposition.test.mjs` > accepted orchestration-skip fixture                       | Proves the new form is scanner-owned, not prose-only.                 |
| TC-03 | Unit / adversarial   | `scripts/harness/__tests__/scan-gate-closure-disposition.test.mjs` > orchestration-skip refusal matrix and tool-defect control | Prevents ordinary failures or the existing route from masquerading.   |
| TC-04 | Integration / record | `scripts/harness/scan-gate-closure-disposition.mjs` against the repository                                                     | Reconciles HARNESS-2660 by append-only evidence.                      |
| TC-05 | Regression / suite   | `scripts/harness/run-all-scans.mjs --affected --context pr`                                                                    | Preserves the broader repository contract.                            |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — ordering: PASS — this is the entry gate; the document is in `draft/` with
  `status: draft`, and no prior gate is required.
- GATE-WRITE — mechanical criteria: PASS — `gate.mjs judge --gate GATE-WRITE --dry-run` judged 27
  criteria as 20 PASS, 0 FAIL, and 7 PENDING-GUARDIAN; every mechanical criterion passed.
- GATE-WRITE — concrete symptom: PASS — the Problem names the observed 20 PASS / 0 FAIL / 7
  PENDING-GUARDIAN result, missing PASS entry, and later orchestration advance in HARNESS-2660.
- GATE-WRITE — reproduction condition: PASS — the Problem identifies an L2 semantic residue whose
  guardian is skipped before a later transition permanently consumes the original input state.
- GATE-WRITE — research feeds the recommendation: PASS — the repository-private waiver names the
  catalogue, terminal-state rule, pipeline route, sealed HARNESS-2660 record, and issue #2665; those
  precedents directly produce the reject-only, false tool-defect, and bounded-disposition alternatives.
- GATE-WRITE — Decision trade-off: PASS — the Decision preserves reject-and-restart for recoverable
  skips while permitting disclosed NON-COMPLIANCE only when terminal history cannot be recreated
  honestly and every substantive judgement is independently recovered.
- GATE-WRITE — new-surface placement: PASS (N/A) — no package, app, presentation/interface surface,
  layer boundary, or product-family classification changes; the existing catalogue and registered
  scanner retain ownership.
- GATE-WRITE — Completion Criteria coverage: PASS — TC-01 covers the three policy owners, TC-02 the
  accepted scanner form and RED proof, TC-03 adversarial refusal and compatibility, TC-04 append-only
  historical reconciliation, and TC-05 affected repository verification.
- GATE-WRITE — Completion Criteria form: PASS — TC-01 and TC-03 name bounded observable outcomes;
  TC-02, TC-04, and TC-05 name exact commands and required exit behavior.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `37669127ae8d` · base
`origin/integration/agreement-2664@37669127ae8d` · document
`.agents/spec-docs/draft/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md`
blob `a3a677e59e3f` (untracked)

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 3ad7e2e98902 (review 4f17a32c, type/tags 2c72e58d)

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: [GATE-WRITE] — ✅ PASS | 2026-09-20 (the PASS that upgraded the status; a later out-of-order entry does not revoke it); status `review-ready`
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (3ad7e2e98902) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `37669127ae8d` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/backlog/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md` blob `0ef0795961d5` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 216 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md",
  "specPath": ".agents/spec-docs/todo/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md",
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
    ".agents/spec-docs/todo/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md",
    ".agents/tasks/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `37669127ae8d` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/todo/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md` blob `5bcdf30ecc6f` (untracked)
