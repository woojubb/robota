---
status: approved
type: INFRA
tags: [infra]
lane: L1
---

# INFRA-169: Declare GATE-DONE's recorded-pass re-run rule in gate-catalogue.md

Paired with `.agents/tasks/INFRA-169-declare-gate-done-s-recorded-pass-re-run-rule-in-gate-catalogue-md.md`. Arising from [issue #2588](https://github.com/woojubb/robota/issues/2588).

## Problem

`gate.mjs`'s ordering check (`orderingResult` in `scripts/harness/gate.mjs`) reads only the LAST
recorded Evidence Log entry for a prior gate. Reproduction: an L1 document has a complete
`[GATE-PLAN] — ✅ PASS` (`draft → approved`), then a later, out-of-order re-run of
`judge --gate PLAN` records a `❌ FAIL` (its first-write preconditions already consumed by the
earlier PASS). Running `node scripts/harness/gate.mjs judge --gate DONE --doc <spec> --lane L1`
then FAILs with `GATE-DONE — ordering: prior gate GATE-PLAN PASS ...: last [GATE-PLAN] entry is
❌ FAIL, PASS required`, even though the document's `status: approved` and the earlier PASS both
corroborate that the prior gate was in fact satisfied — with no recoverable route short of
falsifying the record (INFRA-162, issue #2219). A prior inline fix for this (same repository,
`.claude/worktrees/r2-infra-162-recovery`) was withdrawn by a guardian verdict because it applied
the relaxed rule to EVERY prior-gate pairing, silently breaking the "last-entry rule for an
ordinary gate" invariant a named regression test (`gate.test.mjs`) protects. Full findings: [issue #2588](https://github.com/woojubb/robota/issues/2588).

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- `.agents/specs/gate-catalogue.md`
- `scripts/harness/gate.mjs`
- `scripts/harness/__tests__/gate.test.mjs`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** Declaring the exception per-row in `gate-catalogue.md` (rather than a global code
change) is the only shape a prior guardian verdict on this exact code path did not already reject —
it keeps every other pairing's last-entry rule provably unchanged.

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

Apply the fix at the site the Problem names, following the repository's existing precedent for
this shape, and add the test TC-01 names so the symptom is refused mechanically from then on.

## Affected Files

- `.agents/specs/gate-catalogue.md`
- `scripts/harness/gate.mjs`
- `scripts/harness/__tests__/gate.test.mjs`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs -t "DONE still judges PASS on GATE-PLAN when an out-of-order re-run recorded a later FAIL"` → exits 0, and exits 1 with the fix reverted
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [ ] TC-03: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` → exits 0 on the whole file, not only the new case

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on the named test    | RED with the fix reverted, GREEN with it          |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr` | Regression — the affected set, not the full suite |
| TC-03 | Unit      | `pnpm exec vitest run <path>.test.mjs`      | The whole test file                               |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/INFRA-169-declare-gate-done-s-recorded-pass-re-run-rule-in-gate-catalogue-md.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "사용자가 /tmp/robota-issues/round2/GATE-TOOL-DEFECTS.md 처리 및 develop 병합을 지시했고, --no-verify가 세션 도구에서 완전히 차단되자 '최소 Task/SPEC 체크포인트를 지금 작성'을 명시적으로 선택함 (AskUserQuestion 응답)"
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 53ccf133cbfd (review 7c00435e, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (53ccf133cbfd) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `d9b521a06c71` · base `origin/develop@d9b521a06c71` · document `.agents/spec-docs/draft/INFRA-169-declare-gate-done-s-recorded-pass-re-run-rule-in-gate-catalogue-md.md` blob `2b94174d3d17` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 1179 chars, 5 sentences
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
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (53ccf133cbfd) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-169-declare-gate-done-s-recorded-pass-re-run-rule-in-gate-catalogue-md.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-169-declare-gate-done-s-recorded-pass-re-run-rule-in-gate-catalogue-md.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `d9b521a06c71` · base `origin/develop@d9b521a06c71` · document `.agents/spec-docs/draft/INFRA-169-declare-gate-done-s-recorded-pass-re-run-rule-in-gate-catalogue-md.md` blob `15727700b811` (untracked)
