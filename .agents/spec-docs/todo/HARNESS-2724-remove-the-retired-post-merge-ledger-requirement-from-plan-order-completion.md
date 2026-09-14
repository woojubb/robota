---
status: approved
type: INFRA
tags: [harness]
lane: L1
---

# HARNESS-2724: remove the retired post-merge ledger requirement from plan-order completion

Paired with `.agents/tasks/HARNESS-2724-remove-the-retired-post-merge-ledger-requirement-from-plan-order-completion.md`. Arising from [issue #2724](https://github.com/woojubb/robota/issues/2724).

## Problem

PROC-2724 changed the post-merge contract so GitHub owns terminal completion receipts and new runs do
not append `.agents/loop-runs/post-merge-cycle.jsonl`. However,
`scan-user-execution-plan-order.mjs` still requires that retired row when an implementation PR has
already landed and its `verifying` Task/spec pair is archived on a fresh branch. Staging the verified
REFACTOR-025 archive on `origin/develop@4da37774c` therefore fails with “post-merge completion must append
exactly one closed, successful ledger record,” making the approved remote-receipt route unusable.

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `.agents/loop-runs/spec-code-conformance.jsonl`

### Alternatives Considered

1. Keep requiring a new tracked post-merge ledger row for archive-only follow-ups.
   - Pro: no scanner change is needed and historical fixtures remain unchanged.
   - Con: directly contradicts PROC-2724 TC-05 and recreates the bookkeeping tail it removed.
2. Use the archived Task Result's GitHub completion-comment URL and PR merge commit as the new witness,
   while retaining the old ledger parser only for historical closeouts.
   - Pro: matches the approved SSOT, validates a real merge ancestor offline, and needs no new remote API.
   - Con: the Task Result must carry a strict PR/merge/receipt shape for the scanner to accept it.

### Decision

**Alternative 2.** It is the smallest code correction that makes the existing PROC-2724 decision
executable without weakening merge ancestry, terminal gate, archive-pair, or parent-projection checks.

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

Teach the post-merge completion classifier to accept either the existing historical ledger witness or
the current remote-receipt witness. The new route requires a `verifying` source spec, a done Task/spec
pair, a GitHub PR URL, a GitHub issue-comment receipt URL, and a named merge commit whose subject binds
the PR number and whose commit is an ancestor of the topic base. Keep parent updates monotonic and
subject-bound, including the parent Task's Plan projection used by AGREEMENT-2670.

## Affected Files

- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t "accepts a bounded post-merge Task/spec completion"` exits 1 before the fix and 0 after it for a `verifying` source spec with a remote receipt and no ledger row.
- [ ] TC-02: The focused post-merge matrix continues accepting historical ledger-backed completion and rejects a
      closeout with neither valid evidence form, a non-ancestor merge, incomplete terminal evidence, or
      mixed unrelated implementation.
- [ ] TC-03: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0 with the scanner and regression test in the affected set.

## Test Plan

| TC-ID | Test Type  | Tool / Approach                                                                | Notes                                                                                                                                                                                           |
| ----- | ---------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Regression | focused Vitest case                                                            | Test written: `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs > accepts a bounded post-merge Task/spec completion on a fresh branch without checkpoint ancestry` — RED→GREEN |
| TC-02 | Regression | focused post-merge acceptance/refusal cases                                    | Test written: the same file's selected post-merge matrix retains historical compatibility and fail-closed behavior                                                                              |
| TC-03 | Suite      | `run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Test written: `scripts/harness/run-all-scans.mjs` affected PR-context scan                                                                                                                      |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/HARNESS-2724-remove-the-retired-post-merge-ledger-requirement-from-plan-order-completion.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-15

**Status remains:** draft
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요."
**Given:** 2026-09-15, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 4da37774cc50) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/HARNESS-2724-remove-the-retired-post-merge-ledger-requirement-from-plan-order-completion.md) is at or above the floor L0)
**Review fingerprint:** ba7b746050cc (review 77ff722d, type/tags cf40db57)
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
**Judged at:** HEAD `4da37774cc50` · base `origin/develop@4da37774cc50` · document `.agents/spec-docs/draft/HARNESS-2724-remove-the-retired-post-merge-ledger-requirement-from-plan-order-completion.md` blob `cf296f752f30` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-15

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-15, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 4da37774cc50) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/HARNESS-2724-remove-the-retired-post-merge-ledger-requirement-from-plan-order-completion.md) is at or above the floor L0)
**Review fingerprint:** ba7b746050cc (review 77ff722d, type/tags cf40db57)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (ba7b746050cc) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `4da37774cc50` · base `origin/develop@4da37774cc50` · document `.agents/spec-docs/draft/HARNESS-2724-remove-the-retired-post-merge-ledger-requirement-from-plan-order-completion.md` blob `5538a4d531e1` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-15

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 571 chars, 3 sentences
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (ba7b746050cc) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2724-remove-the-retired-post-merge-ledger-requirement-from-plan-order-completion.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2724-remove-the-retired-post-merge-ledger-requirement-from-plan-order-completion.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `4da37774cc50` · base `origin/develop@4da37774cc50` · document `.agents/spec-docs/draft/HARNESS-2724-remove-the-retired-post-merge-ledger-requirement-from-plan-order-completion.md` blob `8839eefdaa5f` (untracked)
