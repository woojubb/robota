---
status: done
type: RULE
tags: [harness, gate]
lane: L2
---

# RULE-2582: Require one non-empty spec tags contract at planning and final validation

## Current disposition — 2026-09-23

Historical delivery is preserved at replacement child merge `c0e660dd0d0f05cccb968a47001c0461a5ad8648` in R `720eb5e841ba7a5361ac667b9658e034212bb58e`. The done status and original evidence below describe that delivery; importing this record does not restore its historical implementation. PR #2827 (`2a4a84631d24243d8dfb8ef75e04d790e8d60d37`) deliberately retired the legacy gate, checkpoint, and recommendation machinery. Its scaffold and gate consumers are superseded. The surviving `check-spec-doc-frontmatter.mjs` non-empty tags contract remains owned by current develop; only applicable missing/empty/scalar regressions are retained against that live checker.

Paired with `.agents/tasks/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md`. Arising from [issue #2582](https://github.com/woojubb/robota/issues/2582).

## Problem

GATE-WRITE currently passes any frontmatter that merely owns a `tags` key, including `tags: []` and a
bare `tags:`, and its catalogue explicitly advertises the empty array as valid. The final
`check-spec-doc-frontmatter.mjs` scan rejects the same document as `tags missing or empty`, so a spec
can pass the first planning boundary and fail later without any metadata change; `new-spec --tags ''`
can also scaffold the invalid empty value even though omitted tags correctly default to the ID prefix.

## Prior Art Research

Waived: This is a repository-local consistency correction between two existing validators; external product research cannot choose which internal contract owns spec metadata.

## Architecture Review

### Affected Scope

- `.agents/specs/gate-catalogue.md` — authoritative GATE-WRITE criterion wording.
- `scripts/harness/gate-operations.mjs` — early mechanical frontmatter evaluator.
- `scripts/harness/new-spec.mjs` — scaffold input validation and non-empty default behavior.
- `scripts/harness/__tests__/gate.test.mjs` — planning-gate contract cases.
- `scripts/harness/__tests__/new-spec.test.mjs` — scaffold default, explicit-empty refusal, and custom tags.
- `scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs` — final-validation parity and retained YAML forms.

### Alternatives Considered

1. Allow empty tags in the final scanner to match the current planning gate.
   - Pro: the smallest edit and no existing draft is rejected earlier.
   - Con: removes the only enforced non-empty taxonomy signal and preserves scaffolds that knowingly
     fail the repository's established metadata contract.
2. Require at least one non-empty normalized tag at scaffold, GATE-WRITE, and final validation
   (chosen).
   - Pro: invalid metadata fails at the earliest reachable boundary and all three surfaces agree.
   - Con: explicit empty `--tags` input and drafts that previously passed GATE-WRITE become immediate
     failures and need a meaningful tag.
3. Keep the validators unchanged and add a later repair step that fills empty tags automatically.
   - Pro: existing callers do not receive a new refusal.
   - Con: silently invents classification data and retains the contradictory early PASS.

### Decision

Choose alternative 2. `frontmatter.mjs` already owns normalization of scalars, flow arrays, block
arrays, blank values, and missing values through `asList`/`isBlank`; the early evaluator must consume
that meaning instead of re-defining validity as key presence. The final scanner remains fail-closed,
and `new-spec` refuses only an explicitly supplied tag list that normalizes to no values while keeping
its omitted-ID-prefix default.

The recommendation was validated across every consumer: scaffold output reaches GATE-WRITE and the
final scanner; the catalogue wording remains mechanically bindable by the evaluator; existing scalar,
flow-array, prettier-wrapped flow-array, and YAML block-sequence tags remain accepted. Adversarial
cases cover a missing key, bare key, `[]`, whitespace/comma-only CLI input, and arrays containing no
usable value, with no fallback that fabricates a tag after an explicit invalid request.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — GATE-WRITE, final frontmatter validation, scaffold generation, and their
      focused tests were inspected as the complete spec-tag consumer set.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Amend `.agents/specs/gate-catalogue.md` so GATE-WRITE requires at least one non-empty `tags` value.
2. Change `scripts/harness/gate-operations.mjs` to normalize tags through the shared frontmatter list
   semantics and reject missing, bare, and empty forms with the final scanner's diagnostic.
3. Change `scripts/harness/new-spec.mjs` to reject an explicit `--tags` value that normalizes to an
   empty list, while preserving the non-empty namespace default when the option is omitted.
4. Extend the three focused test files to prove early/final parity and preserve every existing valid
   scalar, flow-array, wrapped-array, block-sequence, default-scaffold, and custom-scaffold form.

## Affected Files

- `.agents/specs/gate-catalogue.md`
- `scripts/harness/gate-operations.mjs`
- `scripts/harness/new-spec.mjs`
- `scripts/harness/__tests__/gate.test.mjs`
- `scripts/harness/__tests__/new-spec.test.mjs`
- `scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs scripts/harness/__tests__/new-spec.test.mjs` → exits 0, and the new GATE-WRITE `tags: []` case fails against the pre-fix evaluator.
- [x] TC-02: GATE-WRITE rejects missing, bare, and empty-array `tags` with `tags missing or empty`,
      while accepting scalar, non-empty flow-array, prettier-wrapped flow-array, and block-sequence forms.
- [x] TC-03: `new-spec.mjs` with omitted tags emits the lowercased ID prefix, a valid explicit list is
      preserved, and comma/whitespace-only explicit `--tags` exits 1 without writing a document.
- [x] TC-04: `check-spec-doc-frontmatter.mjs` retains its existing accepted YAML forms and rejects the
      same missing/bare/empty fixtures as GATE-WRITE.
- [x] TC-05: `HARNESS_BASE_REF=origin/integration/agreement-2664 node scripts/harness/run-all-scans.mjs --affected --context pr --base origin/integration/agreement-2664` → exits 0, apart from explicitly identified pre-existing PR-context advisories.

## Test Plan

| TC-ID | Test Type         | Tool / Approach                                     | Notes                                                          |
| ----- | ----------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| TC-01 | Unit / regression | Focused Vitest command over the three named files   | Capture failing pre-fix GATE-WRITE case before implementation. |
| TC-02 | Unit              | `gate.test.mjs` mechanical GATE-WRITE matrix        | Exact shared diagnostic plus all valid YAML forms.             |
| TC-03 | Unit / process    | `new-spec.test.mjs` CLI and dry-run assertions      | No file is written for invalid explicit input.                 |
| TC-04 | Unit              | `check-spec-doc-frontmatter.test.mjs` parity matrix | Final owner behavior is preserved, not weakened.               |
| TC-05 | Integration       | Affected harness scan in PR context                 | Uses the current integration branch as `HARNESS_BASE_REF`.     |

## User Execution Test Scenarios

Not applicable.

**Reason:** This is a private repository planning-metadata contract with no Robota product command,
TUI, browser, public SDK, or installed-package behavior for an end user to execute.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — ordering: entry gate; no prior gate is required, and the document is in `draft/` with `status: draft`.
- GATE-WRITE — frontmatter: the YAML block is present with `status: draft`, allowed type `RULE`, non-empty `tags: [harness, gate]`, and lane `L2`.
- GATE-WRITE — Problem: identifies the concrete mismatch where GATE-WRITE accepts missing-value/empty tags while final frontmatter validation rejects them, and names the reproduction surfaces (`tags: []`, bare `tags:`, and `new-spec --tags ''`) without TBD/TODO or vague placeholder language.
- GATE-WRITE — Prior Art Research: carries an explicit, reasoned waiver for a repository-local validator-consistency correction; the Decision uses the inspected internal owner/consumer set to choose shared normalized semantics, so the waived-research path still feeds the recommendation.
- GATE-WRITE — Architecture Review: all four required checklist items and the sibling scan are checked with concrete consumer-set evidence; three alternatives each state a pro and con; the Decision selects alternative 2 and names the driving early/final consistency and fail-closed trade-off.
- GATE-WRITE — new-surface placement: N/A with an explicit reason; the change introduces no package, app, presentation/interface surface, layer boundary, or product-family reclassification.
- GATE-WRITE — Completion Criteria: TC-01 through TC-05 cover the distinct gate, scaffold, final-validator, and affected-scan behaviors in command or observable form, with none of the prohibited vague phrases.
- GATE-WRITE — Test Plan: five non-empty automated rows correspond one-for-one with the five Completion Criteria; every row names a test type and tool/approach, and no manual row requires a rationale.
- GATE-WRITE — Structure: the Tasks section contains the paired Task placeholder, the Evidence Log was empty before this first run, and no body-level Status or Classification section exists.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `153a3a412ade7212cae15d9d475b6da47d68c58f` · base `origin/fix/2664-gate-correctness@153a3a412ade7212cae15d9d475b6da47d68c58f` · document `.agents/spec-docs/draft/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` blob `fb4d4b262050b94666965b7674f3a36605bf342c` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** e1da21fad6ec (review f778fbbd, type/tags 4c889703)

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: [GATE-WRITE] — ✅ PASS | 2026-09-20 (the PASS that upgraded the status; a later out-of-order entry does not revoke it); status `review-ready`
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e1da21fad6ec) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `153a3a412ade` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/backlog/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` blob `c9e946e6f6b1` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-20

**Status remains:** review-ready
**Failed criteria:**

- Route DIRECT — approval is a direct, unambiguous statement directed at this spec document: the recorded instruction, "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다.", is a standing instruction and is not directed unambiguously at RULE-2582; the current request directs the guardian to judge GATE-APPROVAL but does not itself approve the document. No registered delegated class covers this L2 gate-rule change, so the instruction cannot satisfy Route CLASS instead.
  **Required action:** provide an explicit approval directed at RULE-2582 and then re-run GATE-APPROVAL.

- Route DIRECT — user has provided explicit approval in the current conversation: the fixed-form DIRECT record and verbatim instruction are present, so the mechanical form check passes; the semantic document-directed check above does not.
- Route CLASS — named class, prior registration, verbatim class instruction, measured evidence condition, and class membership: N/A because the recorded route is DIRECT; neither registered class covers an L2 change to gate-defining rules.
- Both routes — no Architecture Review or frontmatter type/tags modified after approval: PASS; the recorded review fingerprint matches the current Architecture Review and type/tags content.
- Both routes — independent architecture validation: N/A; the spec introduces no new package, app, surface, layer boundary, or product-family reclassification.
- NON-COMPLIANCE check — implementation before approval: not triggered; the worktree contains only this untracked planning document and no implementation path change.

**Judged by:** `backlog-gate-guard` semantic evaluator

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** e1da21fad6ec (review f778fbbd, type/tags 4c889703)

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: [GATE-WRITE] — ✅ PASS | 2026-09-20 (the PASS that upgraded the status; a later out-of-order entry does not revoke it); status `review-ready`
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e1da21fad6ec) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `153a3a412ade` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/backlog/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` blob `768d411ae4be` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** e1da21fad6ec (review f778fbbd, type/tags 4c889703)

- GATE-APPROVAL — ordering: PASS — `[GATE-WRITE] — ✅ PASS | 2026-09-20` is recorded with the `draft → review-ready` transition; the document remains at `status: review-ready` in `.agents/spec-docs/backlog/`, which is this gate's required input state.
- Route DIRECT — user has provided explicit approval in the current conversation: PASS — the newest mechanical approval record quotes `승인함.` verbatim, dates it 2026-09-20, and names route `DIRECT`.
- Route DIRECT — approval is a direct, unambiguous statement directed at this spec document: PASS — the user gave `승인함.` immediately after being asked to approve `RULE-2582 spec`, then supplied this invocation with `Document: .agents/spec-docs/backlog/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md`; in that immediate context the approval identifies this document rather than a standing class or another item.
- Route CLASS — named class, prior registration, verbatim class instruction, measured evidence condition, and class membership: N/A — the mutually exclusive recorded route is `DIRECT`; no delegated class is asserted.
- Both routes — no Architecture Review or frontmatter type/tags modified after approval: PASS — the recorded review fingerprint `e1da21fad6ec` matches the current document fingerprint, as independently rechecked by `gate.mjs judge --gate GATE-APPROVAL --dry-run`.
- Both routes — independent architecture validation: N/A — the Architecture Review explicitly introduces no package, app, surface, layer boundary, or product-family reclassification.
- NON-COMPLIANCE check — implementation before approval: not triggered — the whole worktree contains only this untracked planning document; no implementation path has changed.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Verdict reason:** every Route DIRECT and common criterion passes; the prior ambiguous standing instruction has been superseded by a document-directed current-conversation approval.

GATE VERDICT: PASS

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 272 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md",
  "specPath": ".agents/spec-docs/todo/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md",
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
    ".agents/spec-docs/todo/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md",
    ".agents/tasks/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `153a3a412ade` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/todo/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` blob `937d8ecd9690` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs scripts/harness/__tests__/new-spec.test.mjs`
**Exit:** 0
**Output:** (last 7 of 7 line(s))

```
RUN v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-4
PASS scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs (20 tests)
PASS scripts/harness/__tests__/new-spec.test.mjs (47 tests)
PASS scripts/harness/__tests__/gate.test.mjs (110 tests)
Test Files 3 passed (3)
Tests 177 passed (177)
Exit 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `98da05f4f76a` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/active/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` blob `8a76e8a29ca8` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs scripts/harness/__tests__/new-spec.test.mjs`
**Exit:** 0
**Output:** (last 7 of 7 line(s))

```
RUN v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-4
PASS scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs (20 tests)
PASS scripts/harness/__tests__/new-spec.test.mjs (47 tests)
PASS scripts/harness/__tests__/gate.test.mjs (110 tests)
Test Files 3 passed (3)
Tests 177 passed (177)
Exit 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `98da05f4f76a` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/active/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` blob `220d1812d607` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs scripts/harness/__tests__/new-spec.test.mjs`
**Exit:** 0
**Output:** (last 7 of 7 line(s))

```
RUN v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-4
PASS scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs (20 tests)
PASS scripts/harness/__tests__/new-spec.test.mjs (47 tests)
PASS scripts/harness/__tests__/gate.test.mjs (110 tests)
Test Files 3 passed (3)
Tests 177 passed (177)
Exit 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `98da05f4f76a` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/active/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` blob `a386b023a978` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs scripts/harness/__tests__/new-spec.test.mjs`
**Exit:** 0
**Output:** (last 7 of 7 line(s))

```
RUN v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-4
PASS scripts/harness/__tests__/check-spec-doc-frontmatter.test.mjs (20 tests)
PASS scripts/harness/__tests__/new-spec.test.mjs (47 tests)
PASS scripts/harness/__tests__/gate.test.mjs (110 tests)
Test Files 3 passed (3)
Tests 177 passed (177)
Exit 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `98da05f4f76a` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/active/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` blob `699fd8804578` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-20

**Command:** `HARNESS_BASE_REF=fix/2664-gate-correctness node scripts/harness/run-all-scans.mjs --affected --context pr`
**Exit:** 0
**Output:** (last 8 of 8 line(s))

```
affected: 10 changed path(s) against fix/2664-gate-correctness
context: pr
PASS spec-user-execution-section
PASS task-archival
ADVISORY progress-report-quantification: pre-existing transcript findings tolerated in pr context
ADVISORY task-merged-citation: pre-existing SCREEN-2002 finding tolerated in pr context
62 scans passed, 1 skipped, 2 advisory failures tolerated (65 declared what they examined)
Exit 0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `98da05f4f76a` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/active/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` blob `df7ca46abb16` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-20

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: PASS — `[GATE-IMPLEMENT] — ✅ PASS | 2026-09-20` is recorded and the document is at `status: in-progress` in `.agents/spec-docs/active/`.
- Every item in the exact Task's `## Plan` section is marked complete: PASS — TC-01 through TC-05 are the section's five items and each is `[x]`.
- No Plan item is blocked or pending: PASS — the exact Task's `## Plan` contains no unchecked item and no blocked or pending disposition.
- Build passes for all affected packages (`pnpm build`): PASS — the mechanical evaluator ran `pnpm build` and observed exit 0; its emitted dynamic-import and legacy-dist messages were non-failing diagnostics.
- Tests pass for all affected packages (`pnpm test`): PASS — the mechanical evaluator ran `pnpm test` and observed exit 0; the terminal package test completed successfully.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Verdict reason:** all four GATE-VERIFY criteria pass; the two criteria left pending by the mechanical evaluator are proven directly by the exact Task's completed `## Plan` section.

GATE VERDICT: PASS

### [GATE-COMPLETE] — ✅ PASS | 2026-09-20

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-20; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (5)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 5/5 tasks `[x]` in .agents/tasks/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `98da05f4f76a` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/active/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md` blob `556132e5d853` (modified)

## Integration Port Verification

The RULE-2582 implementation was replayed from the superseded legacy branch onto
`origin/integration/agreement-2664@2aac6f855d4220e0b7e8ca33f6e543c4a2396f79`. The port preserves
the approved behavior while isolating evaluator code from evaluated gate evidence in separate commits.

- Focused verification: 3 files and 177 tests passed.
- Affected repository verification: 62 scans passed, 1 skipped, and only the two unrelated historical
  PR-context advisories were tolerated.
- User-execution plan-order: 3 topic commits examined, exit 0.
- Gate-evaluator isolation: 13 changed paths examined, exit 0.

This port evidence supplements the preserved original GATE-COMPLETE entries; it does not rewrite the
historical commands or verdicts recorded on the legacy base.
