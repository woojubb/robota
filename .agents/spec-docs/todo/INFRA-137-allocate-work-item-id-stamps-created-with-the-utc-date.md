---
status: approved
type: RULE
tags: [infra]
lane: L1
---

# INFRA-137: allocate-work-item-id stamps created with the UTC date

Paired with `.agents/tasks/INFRA-137-allocate-work-item-id-stamps-created-with-the-utc-date.md`. Arising from [issue #2415](https://github.com/woojubb/robota/issues/2415).

## Problem

`scripts/harness/allocate-work-item-id.mjs` stamps `created:` in the new Task record with the UTC
calendar date (`new Date().toISOString().slice(0, 10)`), while every other date the harness writes —
gate entries, `completed:`, the delegated-class `Registered` column, `gate.mjs`'s `localDate()` — is
the LOCAL calendar date. A record allocated after midnight local time (before 09:00 KST, for this
repository's owner) is therefore dated one day BEFORE the gate entries that follow it, and a reader
of the record sees a Task whose first gate ran before it was created. The fix stamps the local
calendar date with the same `Intl.DateTimeFormat('sv-SE')` formula `gate.mjs` uses, so the two can
never disagree again, and a test pins the stamp under two time zones that never share a date.

Reproduction: `TZ=Asia/Seoul` at 01:00 local on the 28th, `pnpm harness:task:allocate INFRA "x"`
writes `created: 2026-08-27`; the `gate.mjs approve` that follows one minute later writes
`| 2026-08-28`.

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- `scripts/harness`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** A five-line `localDate()` helper in the allocator that mirrors `gate.mjs`'s `Intl.DateTimeFormat('sv-SE')` formula: importing `gate.mjs` would pull `run-all-scans.mjs` and three scan modules into a script that only writes one file, and the shared helper is L2 work (`gate.mjs` is an L2 path).

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

- `scripts/harness/allocate-work-item-id.mjs`
- `scripts/harness/__tests__/allocate-work-item-id.test.mjs`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs -t "local date"` → exits 0, and exits 1 with the fix reverted (the `created:` stamp differs between `TZ=Etc/GMT-14` and `TZ=Etc/GMT+12`)
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [ ] TC-03: `pnpm exec vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs` → exits 0 on the whole file, not only the new case

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `scripts/harness/__tests__/allocate-work-item-id.test.mjs` (`-t "local date"`) | RED with the fix reverted, GREEN with it |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr` — skip: a scan run, not a `.test.mjs` | Regression — the affected set, not the full suite |
| TC-03 | Unit      | `scripts/harness/__tests__/allocate-work-item-id.test.mjs` | The whole test file |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/INFRA-137-allocate-work-item-id-stamps-created-with-the-utc-date.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs feat/proc-016-pipeline-lanes> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs feat/proc-016-pipeline-lanes (merge base fa354175464a) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-137-allocate-work-item-id-stamps-created-with-the-utc-date.md) is at or above the floor L0)
**Review fingerprint:** acd0eb08eafd (review 6cbd80bd, type/tags 6efb9a42)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (acd0eb08eafd) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

### [GATE-PLAN] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 989 chars, 4 sentences
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
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (acd0eb08eafd) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-137-allocate-work-item-id-stamps-created-with-the-utc-date.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-137-allocate-work-item-id-stamps-created-with-the-utc-date.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
