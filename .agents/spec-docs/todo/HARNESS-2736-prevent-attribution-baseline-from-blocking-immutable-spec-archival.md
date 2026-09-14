---
status: approved
type: INFRA
tags: [harness]
lane: L1
---

# HARNESS-2736: prevent attribution baseline from blocking immutable spec archival

Paired with `.agents/tasks/HARNESS-2736-prevent-attribution-baseline-from-blocking-immutable-spec-archival.md`. Arising from [issue #2736](https://github.com/woojubb/robota/issues/2736).

## Problem

`gate-verdict-attribution` scans only `.agents/spec-docs/done`, while
`user-execution-plan-order` requires the active spec's existing Evidence Log prefix to remain
byte-identical during archival. When REFACTOR-025 is moved from `active` to `done`, its pre-existing
2026-09-14 GATE-WRITE entry becomes a new attribution failure. Adding the missing field makes the
archive-immutability check fail, while preserving the field makes the attribution scan fail.

## Prior Art Research

Waived: Repository-internal scanner migration correction with no product or external contract change.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-gate-verdict-attribution.mjs`
- `scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs`
- `scripts/harness/immutable-attribution-legacy.json`

### Alternatives Considered

1. Rewrite old gate evidence as each active spec is archived.
   - Pro: every done entry gains visible attribution.
   - Con: violates the existing byte-immutable Evidence Log contract and invents historical evidence.
2. Snapshot exact fingerprints for the currently pre-existing unattributed entries and exempt only
   byte-identical matches.
   - Pro: preserves history, fixes all currently latent archive deadlocks, and rejects new or altered
     missing-attribution entries.
   - Con: adds a bounded companion snapshot file.

### Decision

**Alternative 2.** Exact fingerprints preserve immutable evidence without widening the date cutoff;
any changed or newly created unattributed entry remains outside the snapshot and fails.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: Repository-internal scanner migration correction with no product or external contract change.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Hash each gate entry's original text with SHA-256. Extend the migration baseline with the exact
fingerprints of post-cutoff unattributed entries already present outside `done` in a companion snapshot,
and exclude only those exact matches from new violations. Keep the existing date baseline and
attribution parsing unchanged.

## Affected Files

- `scripts/harness/scan-gate-verdict-attribution.mjs`
- `scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs`
- `scripts/harness/immutable-attribution-legacy.json`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs -t "accepts only exact legacy entry fingerprints"` exits 0 after proving an exact fingerprint is accepted and a one-byte change is rejected.
- [ ] TC-02: `node scripts/harness/scan-gate-verdict-attribution.mjs` exits 0 with the byte-identical REFACTOR-025 archive staged and no historical entry rewrite.
- [ ] TC-03: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` exits 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs` | Exact legacy fingerprint acceptance and mutation refusal |
| TC-02 | Scanner   | `scan-gate-verdict-attribution.mjs`                              | Real immutable REFACTOR-025 archive fixture              |
| TC-03 | Suite     | `run-all-scans.mjs --affected --context pr`                      | Affected repository checks                               |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/HARNESS-2736-prevent-attribution-baseline-from-blocking-immutable-spec-archival.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-15

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-15, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 4c790a7c5bd3) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/HARNESS-2736-prevent-attribution-baseline-from-blocking-immutable-spec-archival.md) is at or above the floor L0)
**Review fingerprint:** def416ae946f (review 3b6f53ec, type/tags cf40db57)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (def416ae946f) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `4c790a7c5bd3` · base `origin/develop@4c790a7c5bd3` · document `.agents/spec-docs/draft/HARNESS-2736-prevent-attribution-baseline-from-blocking-immutable-spec-archival.md` blob `9846f7fc3478` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-15

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 455 chars, 3 sentences
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
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (def416ae946f) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2736-prevent-attribution-baseline-from-blocking-immutable-spec-archival.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2736-prevent-attribution-baseline-from-blocking-immutable-spec-archival.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `4c790a7c5bd3` · base `origin/develop@4c790a7c5bd3` · document `.agents/spec-docs/draft/HARNESS-2736-prevent-attribution-baseline-from-blocking-immutable-spec-archival.md` blob `45a3dba63112` (untracked)
