---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-005: ARCHITECTURE.md planned-package consistency

> Source: INFRA-002 audit findings **AF-02** (P0, CONTRADICTION) + **AF-08** (P1). See
> `.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

## Problem

`ARCHITECTURE.md:38` lists `auth` and `credits` inside the live "SDK Packages" box with no qualifier,
while `.agents/project-structure.md:31-39` explicitly marks `packages/auth/` and `packages/credits/` as
"Planned (Not Yet Created)". The filesystem confirms both are absent. Two authority-tier documents
directly contradict each other on whether these packages exist. Separately, `cross-cutting-contracts.md:58-59`
(AF-08) names `packages/auth/docs/SPEC.md` and `packages/credits/docs/SPEC.md` as contract owners —
dead links to phantom owners.

**Reproduction condition:** `ls packages/auth packages/credits` → both absent, yet `ARCHITECTURE.md`
and `cross-cutting-contracts.md` reference them as if live.

## Architecture Review

### Affected Scope

- `ARCHITECTURE.md`
- `.agents/specs/architecture-map/cross-cutting-contracts.md`
- (doc correction only — no code change)

### Alternatives Considered

1. **Create the auth/credits packages now.** Pro: makes the docs true. Con: out of scope, no demand;
   ADR-002 deliberately defers them. Rejected.
2. **Mark auth/credits "Planned" everywhere they appear**, making `project-structure.md` the single SSOT
   for package existence. Pro: cheap, removes the contradiction and dead links. Con: none material. Chosen.

### Decision

Alternative 2 — annotate `auth`/`credits` as Planned in `ARCHITECTURE.md` and `cross-cutting-contracts.md`
to match `project-structure.md`. The proposed package-existence guard (INFRA-003) will enforce that every
package named in an authority doc either exists or carries a "Planned" marker.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `ARCHITECTURE.md`, `cross-cutting-contracts.md`
- [x] Sibling scan 완료 — N/A: doc correction, not a command family
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records single-SSOT-for-existence rationale

## Solution

Add a "Planned (not yet created)" marker to every `auth`/`credits` reference in `ARCHITECTURE.md` and
`cross-cutting-contracts.md`, consistent with `project-structure.md`.

## Affected Files

- `ARCHITECTURE.md`
- `.agents/specs/architecture-map/cross-cutting-contracts.md`

## Completion Criteria

- [x] TC-01: Every line in `ARCHITECTURE.md` and `cross-cutting-contracts.md` that names `auth` or
      `credits` as a package/contract-owner carries a "Planned" marker on that line, so the
      `harness:conformance` package-name guard (which exempts `planned`-marked lines) treats them as
      documented-but-uncreated; no doc presents them as live packages.
- [x] TC-02: `pnpm harness:scan` exits 0.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                                                                                         | Notes                        |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| TC-01 | CI pipeline smoke test | `rg -n 'auth\|credits' ARCHITECTURE.md cross-cutting-contracts.md` → every package/owner line also matches `planned` (case-insensitive) | Command-form: grep assertion |
| TC-02 | CI pipeline smoke test | `pnpm harness:scan` exit 0                                                                                                              | doc-only change              |

## Tasks

- [x] `.agents/tasks/completed/INFRA-005.md` — archived (GATE-COMPLETE). Tasks: TC-01 (Planned markers in `ARCHITECTURE.md` + `cross-cutting-contracts.md`), TC-02 (`pnpm harness:scan` exit 0). Both complete.

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-06-13

**Status remains:** draft
**Sections checked:**

- Frontmatter: PASS — `---` block present, `status: draft`, `type: INFRA` (valid 11-prefix value), `tags: [typescript]` present.
- Problem: PASS — concrete symptom (`ARCHITECTURE.md:38` lists auth/credits as live vs. `project-structure.md` marks Planned; filesystem absent), reproduction condition (`ls packages/auth packages/credits` → both absent), no TBD/TODO.
- Architecture Review Checklist: PASS — all 4 items `[x]`; sibling scan `[x]` with explicit `N/A: doc correction, not a command family`; 2 alternatives each with Pro/Con; Decision references single-SSOT-for-existence trade-off.
- Completion Criteria: PASS — TC-01, TC-02 both TC-N prefixed; observable/command forms; no banned vague language.
- Test Plan: PASS on structure — `## Test Plan` present, TC-N count matches (2 criteria, 2 rows), Test Type and Tool/Approach non-empty.
- Structure: PASS — Tasks section with placeholder present; Evidence Log present and empty before this run; no `## Status`/`## Classification` body sections.

**Failed criteria:**

- Test Plan — manual-row Notes justification: TC-01 has `Tool: manual` but its Notes is `doc inspection`, which describes the approach rather than explaining _why_ an automated test is not possible (criterion: "Rows where Tool is 'manual' have a non-empty Notes entry explaining why automated test is not possible").
  **Required action:** Update the TC-01 Notes to state why automation is infeasible (e.g., "Planned-marker semantics in prose require human reading; automated coverage of package-existence consistency is provided by TC-01's `harness:scan` / future package-existence guard"), then re-run GATE-WRITE.

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready
**Sections checked:**

- Frontmatter: PASS — `---` block present, `status: draft`, `type: INFRA` (valid 11-prefix value), `tags: [typescript]` present.
- Problem: PASS — concrete symptom (`ARCHITECTURE.md:38` lists `agent-core / auth / credits` as live vs. `project-structure.md` marks auth/credits Planned), reproduction condition (`ls packages/auth packages/credits` → both absent, verified this run), no TBD/TODO.
- Architecture Review Checklist: PASS — all 4 items `[x]`; sibling scan `[x]` with explicit `N/A: doc correction, not a command family`; 2 alternatives each with Pro/Con; Decision references single-SSOT-for-existence trade-off.
- Completion Criteria: PASS — TC-01, TC-02 both TC-N prefixed; command/observable forms; no banned vague language.
- Test Plan: PASS — `## Test Plan` present; TC-N count matches (2 criteria ↔ 2 rows); each row has non-empty Test Type ("CI pipeline smoke test") and Tool/Approach (TC-01 `rg` grep assertion, TC-02 `pnpm harness:scan` exit 0); manual-row Notes criterion N/A — neither row uses Tool "manual" (prior FAIL resolved: TC-01 is now a CI pipeline smoke test with an `rg` assertion, not manual inspection).
- Structure: PASS — Tasks section with placeholder present; Evidence Log section present (carries prior FAIL entry, expected on re-run); no `## Status`/`## Classification` body sections.

**TC-N count confirmation:** Completion Criteria = 2 (TC-01, TC-02); Test Plan rows = 2 (TC-01, TC-02). Match.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: PASS — user replied `"1"` selecting `"후속 정리 백로그 진행 — INFRA-004/005/006 (P0 draft)"` (proceed with the P0 follow-up cleanup backlogs INFRA-004/005/006).
- Direct, unambiguous, directed at this spec: PASS — INFRA-005 is named explicitly in the selected option, authorizing its advance to `approved`.
- No Architecture Review or frontmatter type/tags modified after approval: PASS — frontmatter unchanged (`type: INFRA`, `tags: [typescript]`); Architecture Review Checklist all `[x]`, untouched since GATE-WRITE PASS.
- NON-COMPLIANCE check (implementation started before gate): clear — `.agents/tasks/INFRA-005.md` not yet created; no edits to `ARCHITECTURE.md` or `cross-cutting-contracts.md`. No implementation work begun.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: PASS — `.agents/tasks/INFRA-005.md` created with one task per Completion Criterion (TC-01: Planned markers in `ARCHITECTURE.md` + `cross-cutting-contracts.md`; TC-02: `pnpm harness:scan` exit 0).
- Tasks file path recorded in spec `## Tasks`: PASS — `## Tasks` updated to link `.agents/tasks/INFRA-005.md` and summarize TC-01/TC-02.
- Tasks correspond to Completion Criteria (≥1 task per TC-N): PASS — Completion Criteria = 2 (TC-01, TC-02); task file tasks = 2 (TC-01, TC-02). Match.
- Test Plan section ≥50 chars [AF-24]: PASS — `## Test Plan` present in `.agents/tasks/INFRA-005.md`, 1206 chars (well over 50), with a row per TC-N — satisfies the `test-plans` harness scan.
- NON-COMPLIANCE check (commits exist but no tasks file): clear — no implementation commits to `ARCHITECTURE.md` / `cross-cutting-contracts.md`; tasks file now exists.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- All tasks complete (`[x]`): PASS — `.agents/tasks/INFRA-005.md` both tasks checked (TC-01 Planned markers, TC-02 `harness:scan` exit 0). None pending or blocked.
- TC-01 verification: PASS — `rg -ni 'auth|credits'` over both docs returns only marked lines. `ARCHITECTURE.md:38` → `agent-core (auth, credits planned)`; `cross-cutting-contracts.md:58-59` Auth/Credits contract-owner rows each carry `**planned (package not yet created; see ADR-002)**`. No doc presents auth/credits as live packages.
- TC-02 verification: PASS — `pnpm harness:scan` exited 0; all 23 scans passed (file-size scan emits 33 pre-existing non-blocking warnings unrelated to this doc change).
- Build/test (`pnpm build`/`pnpm test`): N/A — doc-only change, no `packages/*` source modified (Affected Files: `ARCHITECTURE.md`, `cross-cutting-contracts.md`).

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

**Command:** `rg -ni 'auth|credits' ARCHITECTURE.md .agents/specs/architecture-map/cross-cutting-contracts.md`
**Output (3 matched lines, all carry a Planned marker):**

- `ARCHITECTURE.md:38` → `│  agent-core (auth, credits planned)      │`
- `cross-cutting-contracts.md:58` → Auth contracts row → `` `packages/auth/docs/SPEC.md` — **planned (package not yet created; see ADR-002)** ``
- `cross-cutting-contracts.md:59` → Credits contracts row → `` `packages/credits/docs/SPEC.md` — **planned (package not yet created; see ADR-002)** ``

Every package/contract-owner line naming `auth`/`credits` matches `planned` (case-insensitive). No doc presents either as a live package. Exit 0.
**Test reference:** TC-01 is a command-form CI smoke check (`rg` grep assertion); verified by the command above, no separate test file. Completion Criteria checkbox `[x]`.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

**Command:** `pnpm harness:scan`
**Output:** `all 23 scans passed` (including `test-plans`, `done-evidence`, `docs-structure`). Exit code 0.
**Test reference:** TC-02 is a command-form CI smoke check (`pnpm harness:scan` exit 0); verified by the command above, no separate test file. Completion Criteria checkbox `[x]`.

### [GATE-COMPLETE] — ✅ PASS (summary) | 2026-06-13

**Status upgrade:** verifying → done

- Completion Criteria: PASS — both TC-01 and TC-02 `[x]`; each has a matching `[GATE-COMPLETE: TC-N]` entry above with command + observed output.
- Test Plan coverage: PASS — TC-01 and TC-02 rows each carry a test reference (command-form CI smoke checks); no TC-N silently unaddressed.
- User-Execution done-gate: N/A — spec has no `## User Execution Test Scenarios` section (doc-only correction, AF-02 + AF-08).
- Tasks file archived: PASS — `.agents/tasks/INFRA-005.md` moved to `.agents/tasks/completed/INFRA-005.md`.
- `## Tasks` updated: PASS — section now links the archived path `.agents/tasks/completed/INFRA-005.md` and marks both tasks complete.
