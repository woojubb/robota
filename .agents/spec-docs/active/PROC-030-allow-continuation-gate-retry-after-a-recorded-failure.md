---
status: in-progress
type: RULE
tags: [workflow, harness]
lane: L2
---

# PROC-030: Allow continuation gate retry after a recorded failure

no-issue: internal harness defect discovered while executing AGREEMENT-006; no new GitHub issue exists
solely for internal implementation sequencing.

## Problem

`node scripts/harness/gate.mjs judge --gate GATE-IMPLEMENT --continuation` cannot retry a repaired
continuation after any earlier continuation attempt records FAIL. The gate catalogue requires that a
prior GATE-IMPLEMENT PASS exists, but `orderingResult()` inspects only the last same-gate entry and
requires that entry itself to be PASS.

The defect reproduces on AGREEMENT-006 after its first checkpoint PASS and a historical continuation
FAIL caused by a missing sequenced-artifact declaration. PR #2570 landed the declaration and the current
Task, ancestry, artifact, PLAN, and worktree checks all pass, yet a fresh continuation run exits 1 solely
because the last historical entry is FAIL. As written, a repair can never make the same gate retryable
without deleting evidence or bypassing the catalogue.

## Prior Art Research

Waived: this is a localized consistency repair between the repository's existing gate catalogue and its
mechanical judge. The authoritative desired behavior, failure evidence, and strict retry boundary are all
local and directly reproducible; external product research would not decide which existing owner wins.

## Architecture Review

### Affected Scope

- `scripts/harness/gate.mjs` — continuation-specific prior-gate ordering selection.
- `scripts/harness/__tests__/gate.test.mjs` — retry and non-regression fixtures.
- No rule, catalogue, checkpoint schema, package/app source, public API, or live GitHub Issue state.

### Alternatives Considered

1. **For continuation ordering only, select the most recent prior PASS and re-run every current
   continuation criterion.**
   - Pro: matches the catalogue's “a prior PASS exists” contract and keeps ancestry, artifact, Task/PLAN,
     and worktree checks current.
   - Con: requires an explicit continuation branch in the shared ordering function.
2. **Make every gate accept any historical PASS regardless of later entries.**
   - Pro: one generic implementation is small.
   - Con: a later FAIL on approval, verify, or complete could be hidden by stale success and incorrectly
     authorize the next lifecycle transition.
3. **Delete or rewrite FAIL evidence, or fabricate a corrective PASS before retrying.**
   - Pro: avoids changing the judge.
   - Con: destroys append-only audit evidence or records a verdict no gate actually earned.

### Decision

**Delivery mode:** `single`

Choose alternative 1. `orderingResult()` will retain its last-entry rule for ordinary gates. Only a
resolved `gate.continuation === true` route may select the newest same-gate PASS from the existing
Evidence Log; the status must still be `in-progress`, and the full current continuation criteria and
canonical checkpoint payload generation still run afterward.

The recommendation is validated against all call paths: reachability is bound to the explicit
`resolveContinuationGate()` result, ordinary gate ordering remains byte-for-byte equivalent, and the
adversarial controls cover no-PASS history, FAIL-only history, ordinary later-FAIL transition, and
invalid current status, artifact, ancestor, Task/PLAN, and worktree states. No capability or evidence
field is removed, inferred, or skipped.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — gate judge and its owning focused test only.
- [x] Sibling scan 완료 — continuation resolver, live prior-gate parser, evidence parser, checkpoint
      writer, and plan-order consumer were checked. The shared ordering selector contradicts the
      catalogue, and the local gate-test catalogue also omits the annotated continuation row, allowing
      existing continuation fixtures to skip ordering.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: N/A — no package, app, interface, or layer is introduced.

## Fallback & Degradation Declaration

None

## Solution

1. Synchronize the local test catalogue with the live annotated continuation prior-map row and assert
   that ordering is present in the result.
2. Add a RED fixture with a valid first PASS, a later continuation FAIL, and corrected current inputs.
3. Let continuation ordering find the newest prior PASS while ordinary ordering keeps using the last
   entry.
4. Parameterize invalid current status, artifacts, ancestor, Task/PLAN, and outside-worktree controls.
5. Run focused plus repository verification.

## Affected Files

- `scripts/harness/gate.mjs`
- `scripts/harness/__tests__/gate.test.mjs`

## Completion Criteria

- [ ] TC-01: the local catalogue fixture contains the exact annotated continuation prior-map row, and
      the pre-fix PASS→FAIL fixture exits 1 with
      `last [GATE-IMPLEMENT] entry is ❌ FAIL`.
- [ ] TC-02: the PASS→FAIL→corrected continuation fixture exits 0 and records ordering against the
      existing prior PASS without deleting the FAIL.
- [ ] TC-03: continuation histories with no prior PASS or only FAIL entries exit 1 with an ordering
      failure.
- [ ] TC-04: an ordinary gate whose last required-prior entry is FAIL continues to exit 1 even when an
      older PASS exists, and retry histories with invalid current status, artifacts, ancestor, Task/PLAN,
      or worktree inventory each exit 1.
- [ ] TC-05: focused gate/checkpoint/order suites and the required repository verification exit 0.

## Test Plan

| TC-ID | Test Type       | Tool / Approach                                                                 | Notes                     |
| ----- | --------------- | ------------------------------------------------------------------------------- | ------------------------- |
| TC-01 | RED contract    | `scripts/harness/__tests__/gate.test.mjs` annotated-row ordering fixture        | Must fail before code fix |
| TC-02 | Unit regression | `scripts/harness/__tests__/gate.test.mjs` PASS→FAIL→retry fixture               | Exact repaired path       |
| TC-03 | Negative unit   | `scripts/harness/__tests__/gate.test.mjs` no-PASS and FAIL-only fixtures        | Fail closed               |
| TC-04 | Control unit    | ordinary ordering plus five current-input-invalid retry fixtures                | No broad weakening        |
| TC-05 | CI smoke        | focused Vitest, affected contract suites, `pnpm harness:scan`, and `pnpm build` | Final tree                |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change governs an internal repository planning-gate transition and does not alter a
Robota command, public SDK result, TUI or browser flow, or any product-visible runtime state.

## Tasks

- [ ] `.agents/tasks/PROC-030-allow-continuation-gate-retry-after-a-recorded-failure.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-02

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with YAML frontmatter: PASS — the file begins with a delimited `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — the block declares `status: draft`.
- GATE-WRITE — `type:` is one permitted value: PASS — `type: RULE` is permitted.
- GATE-WRITE — `tags:` field present: PASS — `tags: [workflow, harness]` is present.
- GATE-WRITE — Contains a concrete symptom: PASS — the exact continuation command exits 1 after a repaired historical FAIL because `orderingResult()` selects only the last same-gate entry.
- GATE-WRITE — Contains a reproduction condition: PASS — AGREEMENT-006's first PASS, historical continuation FAIL, landed repair, and current 6/7 result are specific.
- GATE-WRITE — Problem contains no TBD, TODO, or vague single sentence: PASS — five concrete sentences and no placeholder.
- GATE-WRITE — Prior Art Research section present: PASS — the required section exists.
- GATE-WRITE — Prior Art Research substantiated or explicitly waived: PASS — the section carries a concrete local-consistency waiver.
- GATE-WRITE — Explicit `Waived: <reason>` line present: PASS — the reason names the catalogue/judge contradiction and reproducible local evidence.
- GATE-WRITE — Research findings feed Alternatives and Decision: PASS — local catalogue, judge, and fixture findings produce three alternatives and the continuation-only choice.
- GATE-WRITE — Architecture Review checklist complete: PASS — all five displayed items are checked.
- GATE-WRITE — Sibling scan checked with evidence: PASS — resolver, live parser, evidence parser, writer, consumer, and divergent test fixture were examined.
- GATE-WRITE — At least two alternatives with pro/con: PASS — three alternatives each carry both.
- GATE-WRITE — Decision references the driving trade-off: PASS — retryability is limited to continuation so ordinary gates cannot reuse stale PASS evidence.
- GATE-WRITE — New-surface placement conditional: PASS (N/A) — no package, app, interface, presentation surface, or layer is introduced.
- GATE-WRITE — Every Completion Criterion has a TC-N prefix: PASS — TC-01 through TC-05 are exact.
- GATE-WRITE — At least one criterion per distinct feature/sub-item: PASS — annotated-row reachability, retry, no-PASS refusal, strict controls, and final verification are separate.
- GATE-WRITE — Each criterion uses command or observable behavior form: PASS — every TC requires an exact diagnostic or exit result.
- GATE-WRITE — No banned vague criterion phrase: PASS — none is present.
- GATE-WRITE — Test Plan section present: PASS — the section exists.
- GATE-WRITE — One Test Plan row per TC-N: PASS — five rows match five criteria.
- GATE-WRITE — Every row has Test Type and Tool/Approach: PASS — all five are non-empty and contain no TBD.
- GATE-WRITE — Manual rows justify infeasibility: PASS (N/A) — there are no manual rows.
- GATE-WRITE — Tasks section present with placeholder: PASS — it names the exact todo Task path.
- GATE-WRITE — Evidence Log initially empty: PASS — this is the first entry.
- GATE-WRITE — No body Status or Classification sections: PASS — neither exists.
- GATE-WRITE — Independent semantic and proposal review: PASS — Round B resolved both findings and returned `ACTIONABLE FINDINGS: 0`, `REVIEW VERDICT: ENDORSE`, and `GATE VERDICT: PASS`.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-02

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "타당한 근거와 함께 추천안을 제시하면 타당할경우 자동 승인하겠습니다"
**Given:** 2026-09-01, this conversation
**Review fingerprint:** cde1459200be (review 39580201, type/tags 42a75dd9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-01, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (cde1459200be) equals the document's current fingerprint

### [GATE-APPROVAL] — ✅ PASS | 2026-09-02

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "타당한 근거와 함께 추천안을 제시하면 타당할경우 자동 승인하겠습니다"
**Given:** 2026-09-01, this conversation
**Review fingerprint:** 099fff7ed9f7 (review 44d59f9e, type/tags 42a75dd9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-01, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (099fff7ed9f7) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-02

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-02; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-030-allow-continuation-gate-retry-after-a-recorded-failure.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-030-allow-continuation-gate-retry-after-a-recorded-failure.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 542 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/PROC-030-allow-continuation-gate-retry-after-a-recorded-failure.md",
  "specPath": ".agents/spec-docs/todo/PROC-030-allow-continuation-gate-retry-after-a-recorded-failure.md",
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
    ".agents/spec-docs/todo/PROC-030-allow-continuation-gate-retry-after-a-recorded-failure.md",
    ".agents/tasks/PROC-030-allow-continuation-gate-retry-after-a-recorded-failure.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->
