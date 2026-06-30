---
status: done
type: RULE
tags: [infra]
---

# RULE-009: Design / LLD document-type definition

## Problem

The artifact taxonomy (`RULE-007`, `.agents/specs/document-standards/index.md`) marks the **design /
LLD** document type as `gap`: it is undefined entirely — no location convention, no required sections,
no "when is a design doc required" policy, no template, no gate, no authoring skill. The repo has
`SPEC.md` (public package contract), architecture-map (system relationships), and ADR (a single
immutable decision), but **no home for component-internal realization** — how a component fulfils its
SPEC internally (module breakdown, key flows, local trade-offs). Such content currently has nowhere to
live: it gets crammed into a SPEC (wrong altitude — SPEC owns the contract, not the realization),
scattered in PR descriptions, or lost.

Per `learning-loop.md` "Contract Before Automation", the type cannot get a template/skill/gate until it
publishes a contract conforming to the `RULE-007` meta-form. This spec defines the type.

Reproduction: a contributor about to implement a non-trivial component (a state machine, a multi-module
orchestration, a non-obvious algorithm) asks "where do I write the internal design, and what must it
contain?" — there is no answer document, location, or template.

## Architecture Review

### Affected Scope

- **New (type definition):** this spec defines the design/LLD document type — the seven meta-form
  elements, the location convention, and the "when required" policy.
- **New (template):** `.agents/templates/design-doc-template.md`.
- **New (authoring skill):** `design-doc-authoring` (domain-free).
- **New (gate):** `scripts/harness/check-design-doc-completeness.mjs` — validates the STRUCTURE of any
  design doc that exists (required sections present); registered in `run-all-scans.mjs`.
- **Edited:** `.agents/specs/document-standards/index.md` — flip the Design/LLD row `gap → defined`;
  `package.json` + `run-all-scans.mjs`; `.agents/skills/index.md`.

### Location decision

- **Package-local design → `packages/<pkg>/docs/design/<topic>.md`** (English, beside the SPEC it
  realizes). Rationale: design is component-internal realization, so it lives with the component
  (owner-knowledge / locality), same altitude family + language as `SPEC.md`.
- **Cross-cutting design (spans packages) → `.agents/specs/<topic>.md`** (the established home for
  cross-cutting specs per AGENTS.md).
- `.design/` stays for ADR / decision logs (Korean discussion-flavored), NOT engineering LLD.

### The contract — the seven meta-form elements for the design/LLD type

1. **Identity & Altitude.** Owns a component's _internal realization_ — how it fulfils its SPEC
   contract (module/class breakdown, key flows, data structures, local trade-offs). Local, functional,
   archivable. Does NOT own the public contract (`SPEC.md`), system-wide relationships (architecture-
   map), or a single architecturally-significant decision (ADR — escalate those out).
2. **Lifecycle & Maintenance.** Created when a component's internal realization is non-trivial (a state
   machine, multi-module orchestration, a non-obvious algorithm) or to plan a substantial
   implementation. Living during active development; **archivable** once stable (may move to a
   `design/archive/` subdir). The "when required" policy is process guidance (in the skill), not a hard
   scan — see Completeness Criteria.
3. **Required Sections (MUST):**
   - **Context & Goal** — which component, which SPEC it realizes, what problem the design solves.
   - **Constraints** — from the SPEC + NFRs (perf, concurrency, compatibility).
   - **Internal Structure** — modules/classes + their responsibilities (a table or diagram).
   - **Key Flows** — the important sequence/state/data flow (steps or a diagram).
   - **Test Approach** — how the design is verified.
   - _Recommended:_ **Alternatives / Trade-offs** (local; escalate architecturally-significant ones to an ADR), **Open Questions**.
4. **Completeness Criteria (machine-checkable):** every design doc that EXISTS carries the MUST
   sections; links to the owning `SPEC.md`; no `TBD`/`TODO` in a doc marked final. The gate validates
   structure of existing docs; it does NOT assert a doc must exist (that judgment is the skill's
   "when required" guidance — not mechanically detectable).
5. **Source Integrity.** Cited symbols/paths resolve (delegated to existing path guards where they
   apply; the design gate does not re-implement path existence).
6. **Ownership & Non-Duplication.** Internal realization lives here; the public contract is the
   `SPEC.md` (linked, not restated); architecturally-significant decisions are ADRs; system
   relationships are architecture-map docs.
7. **Quartet pointers.** location `packages/*/docs/design/` · cross-cutting `.agents/specs/` · template
   `.agents/templates/design-doc-template.md` · skill `design-doc-authoring` · gate
   `check-design-doc-completeness.mjs`.

### Alternatives Considered

1. **Leave design content in SPEC.md.** Pro: no new type. Con: conflates contract with realization —
   SPEC bloats and drifts; the meta-form's altitude boundary is violated. Rejected.
2. **Define the design/LLD type with a structure gate + "when required" as skill guidance (chosen).**
   Pro: gives the realization content a home + template + gate; honest about what is mechanizable. Con:
   "when required" is not hard-enforced. Accepted — structure is gated, existence is guided.
3. **Hard-enforce "every package must have a design doc".** Pro: simple rule. Con: most components are
   simple and do not need one — would generate noise/box-ticking. Rejected.

### Decision

Alternative 2. Define the design/LLD type per the meta-form, location = `packages/*/docs/design/`
(package-local) or `.agents/specs/` (cross-cutting), with a structure-completeness gate over docs that
exist, a template, and a `design-doc-authoring` skill whose "when required" guidance is process-level.
First consumer: the DAG subsystem's component design docs (WORKFLOW follow-ups).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — this spec, new template/skill/gate, document-standards/index.md, package.json, run-all-scans.mjs, skills/index.md.
- [x] Sibling scan 완료 — compared against SPEC.md (contract), architecture-map (relationships), ADR (single decision) to fix the altitude boundary; confirmed no existing design-doc location; reused RULE-008's gate pattern + RULE-007 meta-form.
- [x] 대안 최소 2개 검토 완료 — 3개 (in-SPEC / define-with-structure-gate / hard-require-everywhere).
- [x] 결정 근거 문서화 완료 — location split, structure-gated + existence-guided, escalation boundaries to SPEC/ADR/architecture-map.

## Solution

- Author the contract (above) into the document-standards system as the design/LLD type's owner content.
- Build `check-design-doc-completeness.mjs`: discover design docs under `packages/*/docs/design/**` and
  cross-cutting design docs flagged as such; assert the MUST sections; warn on missing SPEC link.
  Register in `run-all-scans.mjs` + `package.json`. Self-test fixture (missing-section doc → exit 1).
- Add `.agents/templates/design-doc-template.md` + `design-doc-authoring` skill (+ `skills/index.md`).
- Flip the `document-standards/index.md` Design/LLD row `gap → defined`; keep the `document-standards`
  scan green.

## Affected Files

- New: `scripts/harness/check-design-doc-completeness.mjs` (+ fixture),
  `.agents/templates/design-doc-template.md`, `.agents/skills/design-doc-authoring/SKILL.md`.
- Edited: `.agents/specs/document-standards/index.md` (row → defined), `package.json`,
  `scripts/harness/run-all-scans.mjs`, `.agents/skills/index.md`.

## Completion Criteria

- [x] TC-01: this contract documents all **seven** meta-form elements for the design/LLD type — `rg` confirmed 7 element headings.
- [x] TC-02: location convention stated (`packages/*/docs/design/` package-local; `.agents/specs/` cross-cutting; English; `.design/` excluded) and MUST sections listed (Context & Goal, Constraints, Internal Structure, Key Flows, Test Approach).
- [x] TC-03: `check-design-doc-completeness.mjs` exits 1 on the `design-doc-incomplete.md` fixture (missing 4 sections); exits 0 over the repo (no design docs yet → vacuously clean). Verified 2026-06-30.
- [x] TC-04: "when required" policy documented as process guidance in `design-doc-authoring` ("When is a design doc required?"); the gate validates only structure of existing docs (header comment + no existence assertion).
- [x] TC-05: `.agents/templates/design-doc-template.md` (5 MUST sections) + `.agents/skills/design-doc-authoring/SKILL.md` exist; skill listed in `.agents/skills/index.md`.
- [x] TC-06: the `document-standards/index.md` Design/LLD row reads `defined` (quartet filled); `check-document-standards-index.mjs` exits 0.
- [x] TC-07: `pnpm harness:scan` exits 0. **verified 2026-06-30** — WORKFLOW-001 complete; `pnpm harness:scan` exits 0 (38/38 scans green) with the document-standards scans registered.

## Test Plan

Strategy (RULE + infra): mechanical presence/absence + scan exit-code checks. No manual rows.

| TC-ID | Test Type | Tool / Approach                                                   | Notes                         |
| ----- | --------- | ----------------------------------------------------------------- | ----------------------------- |
| TC-01 | RULE      | `rg` seven meta-form element headings                             | contract complete             |
| TC-02 | RULE      | `rg` location convention + MUST section list                      | type fully specified          |
| TC-03 | INFRA     | `check-design-doc-completeness.mjs` exit 1 (fixture) / 0 (repo)   | structure gate works          |
| TC-04 | RULE      | `rg` "when required" in skill + structure-only gate               | honest mechanization boundary |
| TC-05 | INFRA     | template + skill exist; skill in index                            | quartet template+skill filled |
| TC-06 | INFRA     | index row `defined` + `check-document-standards-index.mjs` exit 0 | taxonomy flipped, gate green  |
| TC-07 | INFRA     | `pnpm harness:scan` exit 0                                        | scan registered               |

## Tasks

- [x] `.agents/tasks/RULE-009.md` — 작성 완료. 구현 추적은 해당 파일에서.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-30

draft → review-ready. Frontmatter (RULE/[infra]); Problem (symptom: design/LLD type undefined, content
has no home; reproduction); Architecture Review (Affected Scope, location decision, 7 meta-form
elements, 4/4 checklist, Sibling scan vs SPEC/architecture-map/ADR, 3 Alternatives Pro/Con, Decision);
7 TC Completion Criteria = 7 Test Plan rows; Tasks placeholder; empty Evidence Log; no forbidden
sections. Mechanical: `rg` confirmed 8/8 headings, 4/4 checklist, 7/7 meta-form elements, TC 7=7.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-30

review-ready → approved. Prior gate PASS. Approval authority: the session's standing decision-delegation
(`feedback_autonomous_completion`) pre-delegates GATE-APPROVAL for the document-standards follow-on work;
not within the delegation's exceptions (internal harness governance, no irreversible/IP/product-direction
concern). Rule-based decisions recorded: location `packages/*/docs/design/` (package-local) +
`.agents/specs/` (cross-cutting), English, `.design/` excluded; "when required" = process guidance
(structure-gated, existence-guided) — `feedback_no_unilateral_decisions` satisfied by these being the
already-presented D2 recommendation. No post-approval drift.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-30

approved → in-progress. Tasks file `.agents/tasks/RULE-009.md` created; spec `## Tasks` updated; spec
pointer in tasks file; phased tasks cover TC-01..TC-07 (TC Coverage Map); Test Plan section in tasks file.
