---
status: approved
type: INFRA
tags: [typescript]
lane: L1
---

# META-2655: Permit bounded completion records without executable planning authority

Paired with `.agents/tasks/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md`. Arising from [issue #2655](https://github.com/woojubb/robota/issues/2655).

## Problem

Permit required completion bookkeeping without granting executable planning authority. The current
checker refuses a reviewed documentation-only Task's own archive, a ledger-only record of failed
post-merge verification, and a delivered Task/spec archive accompanied by required parent projections
and execution-run closures. These are observed record-boundary mismatches, not missing product tests.

Observed command: `node scripts/harness/scan-user-execution-plan-order.mjs --staged` refuses
MERGE-2655 archival with no planning ancestor despite its approved documentation batch. It also
requires exactly five paths for a post-merge pair, excluding the parent projections that Tasks
README requires in the same commit. Failed loop attempts cannot be saved through the success-only
post-merge ledger route. Do not manufacture a retrospective `todo` state or erase failed history.

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- Existing record predicates and their staged/history callers under `scripts/harness/`.
- Related owner guidance in `.agents/rules/execution-cadence.md` and `.agents/tasks/README.md`.

### Alternatives Considered

1. Add bounded metadata forms to the existing record predicates and reuse them in staged/history checks.
   - Pro: satisfies existing archival, projection and loop-history obligations without source authority.
   - Con: needs explicit negative tests for each record form and actual caller verification.
2. Exempt all Markdown/JSON changes or manufacture a planning prelude after implementation.
   - Pro: makes the current refusal disappear with less classification work.
   - Con: admits unrelated state changes or false planning evidence; rejected.

### Decision

**Alternative 1.** Preserve the executable planning gate. An approved documentation Task may
archive only its own same-basename record, with validated terminal date, complete existing Plan,
unchanged approval/scenario/content and no paired spec. That closure supplies no later source ground.

A ledger-only append may preserve well-formed closed attempts, including failed/abandoned runs,
without claiming merge authority or supplying planning ground. A delivery batch still needs one
unambiguous successful merge witness with actual ancestry verification. Preserve historical lines;
append a canonical witness if an earlier human-readable ref is unsuitable for mechanical binding.

A new delivered Task/spec archive retains its exact pair, terminal gate and merge requirements.
Permit the required existing parent projections and this Task's existing OPEN execution/checklist/
review-run closures in that same metadata batch. Validate owner binding, legal monotonic state,
existing Plan/criteria text, immutable history, and absence of executable paths. Reuse existing
post-merge metadata predicates where possible; do not create a parallel framework or skip flags.

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

Extend the existing metadata classifier, prove each previously refused valid shape and its
negative boundary, and wire the same predicate into staged and history validation. Existing
document completion authority is the premise; tests and merge evidence are not waived.

## Affected Files

- `scripts/harness/plan-order-records.mjs`
- `scripts/harness/documentation-batch-reader.mjs` (the existing staged/history binding)
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/completion-record-boundaries.test.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` (remote Git-fixture wiring cases only)
- `.agents/rules/execution-cadence.md`, `.agents/tasks/README.md` (clarify the existing record routes)
- Completed delivery records for MERGE-2655 and ARTIFACT-2655 and their existing parent/loop records.

## Completion Criteria

- [ ] TC-01: Approved documentation-only Task archive passes the focused classifier; missing approval, incomplete Plan, changed content, paired spec, partial archive and executable additions are rejected. No later source planning authority is inferred.
- [ ] TC-02: Ledger-only append preserves closed failed/successful attempts without creating a planning ground; existing lines, malformed/open records and executable additions remain refused. Delivery still requires a valid exact merge witness.
- [ ] TC-03: Delivered pair archival accepts its required bound parent projections and existing execution-run closures while rejecting unrelated records, changed plans, missing terminal evidence, invalid lifecycle and source changes.
- [ ] TC-04: The new focused test file passes in full, actual current staged/history validation accepts the preserved closeout, and affected scans pass. Existing remote Git-fixture integration tests cover both callers; no local worktree/clone/Git fixture is created.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                      | Notes                                                                       |
| ----- | ----------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| TC-01 | Unit        | `scripts/harness/__tests__/completion-record-boundaries.test.mjs`                    | RED then GREEN; in-memory/ordinary-file fixtures                            |
| TC-02 | Unit        | Same focused file, ledger evidence cases                                             | Failed history is retained, not converted into a PASS                       |
| TC-03 | Unit        | Same focused file, parent/run binding cases                                          | Valid terminal gate and exact merge requirements remain                     |
| TC-04 | Integration | Real repository staged/history checks; affected scans; existing CI Git-fixture suite | No local Git fixture or product rebuild; remote results reported separately |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-13

**Status remains:** draft
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요."
**Given:** 2026-09-13, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <5 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 5 changed path(s) — committed and working-tree changes vs origin/develop (merge base 4f3c0755dd70) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md) is at or above the floor L0)
**Review fingerprint:** 288cb7cbfc66 (review 40fdc0d5, type/tags 74b52707)
**Failed criteria:**

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `80b05d9d5563` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/draft/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md` blob `b147974fd58e` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-13

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-13, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <5 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 5 changed path(s) — committed and working-tree changes vs origin/develop (merge base 4f3c0755dd70) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md) is at or above the floor L0)
**Review fingerprint:** 288cb7cbfc66 (review 40fdc0d5, type/tags 74b52707)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <5)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (288cb7cbfc66) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `80b05d9d5563` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/draft/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md` blob `5fcd48531af8` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-13

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 880 chars, 7 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <5)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (288cb7cbfc66) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `80b05d9d5563` · base `origin/develop@4f3c0755dd70` · document `.agents/spec-docs/draft/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md` blob `2df0ab24a38a` (untracked)
