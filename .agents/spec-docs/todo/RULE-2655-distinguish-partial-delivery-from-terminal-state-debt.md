---
status: approved
type: RULE
tags: [cli]
lane: L1
---

# RULE-2655: distinguish partial delivery from terminal-state debt

Paired with `.agents/tasks/RULE-2655-distinguish-partial-delivery-from-terminal-state-debt.md`. Arising from [issue #2655](https://github.com/woojubb/robota/issues/2655).

## Problem

At origin/develop fee73c215, `node scripts/harness/scan-item-terminal-state.mjs` exits 1 for
STRUCT-012 after seven days and one named partial delivery. Its Task records S2 complete and S3-S5
unfinished. The sibling merged-citation scan already recognizes completed named units; the aged scan
does not. This prevents Issue #2655 verification without any defect in its changes.

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

`scripts/harness/scan-item-terminal-state.mjs` and its focused regression test. No product package,
gate evaluator, Task lifecycle, baseline, or workflow changes.

### Alternatives Considered

1. Reuse existing named-unit and Plan parsers in the aged scan. Pro: preserves one definition of a
   cited unit and complete checkbox. Con: old unstructured records still need owner reconciliation.
2. Suppress every aged record with an unchecked box. Pro: smaller implementation. Con: hides
   whole-item or unrecognized deliveries and mistakes unrelated checklists for remaining work.

### Decision

**Alternative 1.** Exclude only positively reconciled named-unit deliveries while the actual Plan
contains remaining work. An unqualified or unknown-unit delivery still reports a finding; finishing
the whole Plan restores the terminal-state finding. This corrects classification, not terminal policy.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Import `citedUnitOf` and `completedPlanUnits` from the existing citation owner and `planSection` /
`planItems` from the existing Plan owner. For each aged candidate with delivering citations, read its
Task once. A delivery is reconciled only when it names a checked unit and an unchecked item remains
inside `## Plan`. Keep all other deliveries in the finding count. Preserve age, legacy exclusions,
no-write behavior and fail-loud I/O. No Task is automatically completed, modified or archived.

## Affected Files

- `scripts/harness/scan-item-terminal-state.mjs`
- `scripts/harness/__tests__/scan-item-terminal-state.test.mjs`
- Paired RULE-2655 Task and spec records.

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-item-terminal-state.test.mjs` → exits 0; the completed named-unit / remaining Plan case fails on the original implementation.
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [ ] TC-03: `pnpm exec vitest run scripts/harness/__tests__/scan-item-terminal-state.test.mjs scripts/harness/__tests__/scan-task-merged-citation.test.mjs` → exits 0, covering unqualified/unknown/unchecked units, mixed citations, full Plan completion, section boundaries, young/terminal records and record-only commits.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                                                                  | Notes                                              |
| ----- | --------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| TC-01 | Unit      | `scripts/harness/__tests__/scan-item-terminal-state.test.mjs`                                                                    | Named partial delivery RED before fix, GREEN after |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`                                                                                      | Regression — the affected set, not the full suite  |
| TC-03 | Unit      | `scripts/harness/__tests__/scan-item-terminal-state.test.mjs` and `scripts/harness/__tests__/scan-task-merged-citation.test.mjs` | Whole suites and adversarial fixtures              |

## User Execution Test Scenarios

Not applicable.

**Reason:** People still run the same conversations, commands and interfaces; only repository maintainers
see a corrected interpretation of a partially completed work record.

## Tasks

- [ ] `.agents/tasks/RULE-2655-distinguish-partial-delivery-from-terminal-state-debt.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-12

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "이 깃헙 이슈를 이번에 닫는걸 목표로 하고 #2655 안에 모든 이슈를 처리해야 합니다."
**Given:** 2026-09-12, this conversation
**Review fingerprint:** 864a7d80bd84 (review 8aa0bede, type/tags 2f92467b)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-12, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (864a7d80bd84) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fee73c2152ae` · base `origin/develop@fee73c2152ae` · document `.agents/spec-docs/draft/RULE-2655-distinguish-partial-delivery-from-terminal-state-debt.md` blob `4a36aa803aa5` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-12

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 376 chars, 4 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 3 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 3 Test Plan rows = 3 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 3 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-12, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (864a7d80bd84) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-2655-distinguish-partial-delivery-from-terminal-state-debt.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-2655-distinguish-partial-delivery-from-terminal-state-debt.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fee73c2152ae` · base `origin/develop@fee73c2152ae` · document `.agents/spec-docs/draft/RULE-2655-distinguish-partial-delivery-from-terminal-state-debt.md` blob `99472fdff85a` (untracked)
