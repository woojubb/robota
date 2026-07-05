---
status: done
type: RULE
tags: [infra]
---

# RULE-010: ADR completeness gate

## Problem

The artifact taxonomy (`RULE-007`, `.agents/specs/document-standards/index.md`) marks **ADR** as
`partial`: it has a location (`.design/decisions/`), a template, and an authoring skill
(`architecture-decision-records`), but **no harness gate** validates that an ADR is complete or that
its `Status` is a legal value. An ADR can be committed missing its Alternatives, Decision, or
Consequences, or with a typo'd status, and nothing objects.

Per `learning-loop.md` "Contract Before Automation", the ADR type's contract is otherwise complete
(three of four quartet elements exist) — only the gate is missing. This spec adds it and documents the
ADR type against the `RULE-007` meta-form, flipping the row to `defined`.

Reproduction: add `.design/decisions/ADR-003-x.md` with only a `## Status` heading — no scan fails.

## Architecture Review

### Affected Scope

- **New (gate):** `scripts/harness/check-adr-completeness.mjs` — over `.design/decisions/ADR-*.md`,
  assert the MUST sections and a legal `Status`. Registered in `run-all-scans.mjs` + `package.json`.
- **Edited:** `.agents/specs/document-standards/index.md` — flip the ADR row `partial → defined` and
  document the ADR contract against the meta-form. `.agents/skills/index.md` unchanged (skill exists).
- **Reuses:** the `architecture-decision-records` skill + its template own the content; this gate only
  enforces presence (no duplication).

### The contract — the seven meta-form elements for the ADR type

1. **Identity & Altitude.** One focused, architecturally-significant decision: context → alternatives →
   choice → consequences. Not a component design (LLD), not a system map, not a package contract.
2. **Lifecycle & Maintenance.** **Immutable** once accepted; never edited — superseded by a new ADR
   (`Status: superseded by ADR-NNN`). The longest-lived doc type.
3. **Required Sections (MUST):** `## Status`, `## Context`, `## Alternatives Considered`,
   `## Decision`, `## Consequences`. Recommended: `## References`.
4. **Completeness Criteria (machine-checkable):** the five MUST sections present; `Status` is one of
   `proposed` / `accepted` / `superseded` (by ADR-NNN) / `rejected` / `deprecated`.
5. **Source Integrity.** Cited symbols/paths resolve (delegated where path guards apply).
6. **Ownership & Non-Duplication.** A decision lives in exactly one ADR; realization detail → design
   doc; contract → SPEC.md; relationships → architecture-map.
7. **Quartet pointers.** location `.design/decisions/ADR-NNN-*.md` · template (in the skill) ·
   skill `architecture-decision-records` · gate `check-adr-completeness.mjs` (new).

### Alternatives Considered

1. **Leave ADR ungated.** Pro: no work. Con: keeps the type `partial`; incomplete/mis-statused ADRs
   land silently. Rejected.
2. **Add a completeness gate reusing the skill's template definition (chosen).** Pro: flips ADR to
   `defined`; cheap (only the gate is missing). Con: one new scan. Accepted.

### Decision

Alternative 2. Add `check-adr-completeness.mjs` (MUST sections + legal `Status`) and document the ADR
contract in the meta-form, flipping the taxonomy row to `defined`. The existing two ADRs (ADR-001,
ADR-002) already carry all five sections and a legal status — confirmed during implement.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — new gate, document-standards/index.md, package.json, run-all-scans.mjs.
- [x] Sibling scan 완료 — inspected ADR-001/002 (both carry Status/Context/Alternatives/Decision/Consequences); confirmed `architecture-decision-records` skill owns the template (reused, not duplicated).
- [x] 대안 최소 2개 검토 완료 — 2개 (leave-ungated / add-gate).
- [x] 결정 근거 문서화 완료 — gate-only addition; immutable lifecycle; status enum.

## Solution

- Build `check-adr-completeness.mjs`: over `.design/decisions/ADR-*.md`, assert the five MUST sections
  and a legal `Status` (parse the line under `## Status`). Self-test fixture (missing section / bad
  status → exit 1). Register in `run-all-scans.mjs` + `package.json`.
- Flip the `document-standards/index.md` ADR row to `defined`; document the contract.
- Confirm ADR-001 / ADR-002 pass.

## Affected Files

- New: `scripts/harness/check-adr-completeness.mjs` (+ fixture).
- Edited: `.agents/specs/document-standards/index.md`, `package.json`, `scripts/harness/run-all-scans.mjs`.

## Completion Criteria

- [x] TC-01: this contract documents all **seven** meta-form elements for the ADR type — confirmed in the spec's "The contract" section.
- [x] TC-02: the MUST sections (`Status`, `Context`, `Alternatives Considered`, `Decision`, `Consequences`) and the legal `Status` enum (proposed/accepted/superseded/rejected/deprecated) are listed.
- [x] TC-03: `check-adr-completeness.mjs` exits 1 on the `adr-incomplete.md` fixture (3 missing sections + illegal "banana" status); exits 0 over `.design/decisions/` (ADR-001 / ADR-002 pass). Verified 2026-06-30.
- [x] TC-04: the `document-standards/index.md` ADR row reads `defined` (quartet filled); `check-document-standards-index.mjs` exits 0.
- [x] TC-05: `pnpm harness:scan` exits 0. **verified 2026-06-30** — WORKFLOW-001 complete; `pnpm harness:scan` exits 0 (38/38 scans green) with the document-standards scans registered.

## Test Plan

Strategy (RULE + infra): mechanical presence/absence + scan exit-code checks. No manual rows.

| TC-ID | Test Type | Tool / Approach                                                   | Notes                     |
| ----- | --------- | ----------------------------------------------------------------- | ------------------------- |
| TC-01 | RULE      | `rg` seven meta-form element headings                             | contract complete         |
| TC-02 | RULE      | `rg` MUST sections + status enum                                  | required sections defined |
| TC-03 | INFRA     | `check-adr-completeness.mjs` exit 1 (fixture) / 0 (real ADRs)     | gate works                |
| TC-04 | INFRA     | index row `defined` + `check-document-standards-index.mjs` exit 0 | taxonomy flipped          |
| TC-05 | INFRA     | `pnpm harness:scan` exit 0                                        | scan registered           |

## Tasks

- [x] `.agents/tasks/RULE-010.md` — 작성 완료.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-30

draft → review-ready. Frontmatter (RULE/[infra]); Problem (ADR ungated, reproduction); Architecture
Review (Affected Scope, 7 meta-form elements, 4/4 checklist, Sibling scan of ADR-001/002, 2 Alternatives
Pro/Con, Decision); 5 TC = 5 Test Plan rows; Tasks placeholder; empty Evidence Log; no forbidden
sections. Mechanical: `rg` confirmed 8/8 headings, 4/4 checklist, 7/7 meta-form, TC 5=5.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-30

review-ready → approved. Standing decision-delegation (`feedback_autonomous_completion`); internal
harness governance (not in the delegation's exceptions). Decision recorded: gate-only addition, ADR
immutable lifecycle, Status enum. No drift.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-30

approved → in-progress. `.agents/tasks/RULE-010.md` created; spec `## Tasks` updated; spec pointer in
tasks file; tasks cover TC-01..TC-05; Test Plan in tasks file.
