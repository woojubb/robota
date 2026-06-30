---
status: done
type: RULE
tags: [infra]
---

# RULE-007: Document-Type Contracts — meta-form + artifact taxonomy index

## Problem

The repo already proves a working pattern for one document type: `packages/*/docs/SPEC.md` has a
precise **required-contents schema** (`spec-writing-standard` skill — 9 mandatory sections), a
**completeness gate** (`harness:scan:specs`), and an **authoring skill** — the `{schema → gate →
skill}` triad. Backlog spec-docs have the same triad (`backlog-writer` + GATE-WRITE..COMPLETE +
`spec-template.md`).

The other design/architecture document types do **not** have this triad, so no generation pipeline,
gate, or skill can be built on top of them:

1. **Architecture-map subdocuments** (`.agents/specs/architecture-map/*-system.md`,
   `dependency-direction.md`, `capability-placement.md`, `cross-cutting-contracts.md`,
   `repository-overview.md`, `apps-and-deployment.md`) have only a **prose content-policy**
   (`documentation-sync.md` "Architecture Map Content Policy" — "each file owns relationships + brief
   contract, nothing more"). There is **no per-type required-sections schema** and **no completeness
   gate**. "Is this `*-system.md` complete?" is not mechanically answerable.
2. **Design/LLD documents** are an **undefined type entirely** — no location, no required sections,
   no "when is a design doc required" policy, no template, no gate, no skill.
3. **ADR** has a skill + template (`architecture-decision-records`, `.design/decisions/`) but **no
   harness gate** validating completeness.
4. **Backlog spec-doc** has a triad, but its **ID naming convention is inconsistent and ungated**:
   the documented rule says the filename prefix equals the `type` frontmatter (one of 11), yet
   `INFRA-DOC-GUARD-001` leads with `INFRA-DOC-GUARD` while its frontmatter is `type: BEHAVIOR`. No
   scan enforces filename-prefix ↔ type agreement, so the convention silently drifts.

Reproduction: ask "what must `agent-system.md` contain to be complete, and which scan proves it?" —
there is no answer document and no scan. Without a published contract per type, every new
architecture/design doc (including the DAG subsystem's `dag-system.md` and any future subsystem) is
authored ad hoc, drifts, and cannot be gate-verified or pipeline-generated.

This item does **not** define the individual contracts. It establishes the **meta-form** (the shape
every document-type contract must take) and the **master taxonomy index** that enumerates every
document type and routes each to its `{template, standard/skill, gate, location}` — so the per-type
contracts (architecture-map, design/LLD, ADR-gate) can be authored as conforming follow-on specs.

## Architecture Review

### Affected Scope

- **New (owner doc):** `.agents/specs/document-standards/index.md` — the master artifact taxonomy +
  the meta-form definition. Mirrors how `.agents/spec-docs/README.md` owns the lifecycle and
  `.agents/specs/architecture-map/README.md` owns that family's index.
- **New (harness):** `scripts/harness/check-document-standards-index.mjs` — asserts the taxonomy index
  is internally valid: every `{template, skill, gate, location}` pointer it lists resolves to a real
  file/script/skill (no ghost pointers), and every document type present on disk appears in the index.
- **Edited:** `package.json` (register the scan under `harness:scan`), `.agents/rules/documentation-sync.md`
  (rule anchor → point its "Architecture Map Content Policy" at the new index as the SSOT for the
  _structural_ contract, keeping its _content_ policy), `AGENTS.md` Document Discovery "Document tree"
  table (add the document-standards index row).
- **Reuses, does not duplicate:** `INFRA-DOC-GUARD-001` (ghost-package + spec-export coverage) covers
  _referential integrity_ of doc content; this item covers _structural completeness_ of doc types.
  The index scan reuses the ghost-reference pattern from `check-ghost-package-refs.mjs` rather than
  re-implementing it.
- **Follow-on specs unblocked (not authored here):** architecture-map document-type contract;
  design/LLD document-type definition; ADR completeness gate — each conforms to the meta-form below.

### Alternatives Considered

1. **Define each doc-type contract directly, no meta-form/index (skip the keystone).**
   - Pro: fewer documents.
   - Con: each contract invents its own shape → no uniform completeness definition, the gates diverge,
     and there is no single place that answers "which document types exist and what is each one's
     status." Reproduces the current ad-hoc state at a finer grain. Rejected.
2. **Keystone meta-form + taxonomy index first, per-type contracts as conforming follow-ons (chosen).**
   - Pro: one published shape that every contract instantiates → uniform gates, one router, dependency
     order is explicit (contracts depend on the meta-form). Matches the proven SPEC.md/backlog triad.
   - Con: one extra layer before the per-type contracts land. Accepted — it is the SSOT the others need.
3. **Fold document standards into `documentation-sync.md` rule prose.**
   - Pro: no new folder.
   - Con: a rule is constraints, not a routed index with per-type quartets + status; it would become a
     prose blob (the exact anti-pattern `documentation-sync.md` warns against) and stays
     non-mechanizable. Rejected — keep the rule thin, point it at the index.

### Decision

This spec is the **document-domain implementation** of the `learning-loop.md` > "Contract Before
Automation" principle (no generator/gate/skill on an artifact type without a published contract);
the document-standards index is where that principle's document-type contracts live.

Alternative 2. Author `.agents/specs/document-standards/index.md` as the owner of (a) the **meta-form**
— the mandatory shape every document-type contract publishes — and (b) the **taxonomy index** — every
document type with its altitude, location, contract status (`defined` / `partial` / `gap`), and
`{template, skill, gate}` pointers. Add one mechanical scan that keeps the index honest (no ghost
pointers, no on-disk type missing from the index). The per-type contracts become follow-on specs that
must conform to the meta-form; their gaps and proposed IDs are recorded in the index, not implemented
here.

**The meta-form — every document-type contract MUST specify these:**

1. **Identity & Altitude** — what the type captures and what it explicitly does NOT (boundary against
   adjacent types); how durable vs. how local/changeable (architecture = durable system structure;
   design = component-internal realization).
2. **Lifecycle & Maintenance** — when a document is created/required (trigger), living (incrementally
   updated, drift-recovery path) vs. immutable (frozen, superseded), and how it is kept current.
   Present in all three proven models (spec-writing-standard modes, ADR supersession, architecture-map
   Update Policy); without it a generator has no trigger and drift is undefined.
3. **Required Sections** — the ordered mandatory sections. A document missing any is incomplete
   (gate-fail). Optional sections listed separately.
4. **Completeness Criteria** — a machine-checkable definition of "done": each required section
   non-empty above a stated threshold; no `TBD`/`TODO`/vague placeholders; type-specific assertions.
5. **Source Integrity** — referenced packages/symbols/boundaries must resolve to real artifacts
   (delegates to the `INFRA-DOC-GUARD-001` ghost-reference guard; does not restate it).
6. **Ownership & Non-Duplication** — which facts live in this type vs. which belong to a neighbor
   type (each fact has exactly one owner); cross-type references are links, never copies.
7. **Quartet pointers** — `location/naming`, `template`, `authoring skill`, `gate (harness scan)`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `.agents/specs/document-standards/` (new), `scripts/harness/`, `package.json`, `documentation-sync.md`, `AGENTS.md` doc tree.
- [x] Sibling scan 완료 — `spec-writing-standard` (SPEC.md triad), `backlog-writer`/`spec-template.md` (backlog triad), `architecture-decision-records` (ADR), `architecture-map/README.md` + `documentation-sync.md` content policy, `INFRA-DOC-GUARD-001` (referential-integrity guard — adjacent axis, reused not duplicated).
- [x] 대안 최소 2개 검토 완료 — 3개 (direct-no-keystone / keystone-first / fold-into-rule).
- [x] 결정 근거 문서화 완료 — keystone meta-form + taxonomy index as SSOT; per-type contracts deferred as conforming follow-ons; reuse ghost-guard for source integrity.

## Solution

- **Author the index.** Create `.agents/specs/document-standards/index.md` containing: the meta-form
  (six required elements above) and the taxonomy table. Initial taxonomy rows + status:

  | Document type           | Altitude           | Location                                                   | Status                                                                                                                                           | Template / Skill / Gate                                                                |
  | ----------------------- | ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
  | Package `SPEC.md`       | package contract   | `packages/*/docs/SPEC.md`                                  | **defined**                                                                                                                                      | — / `spec-writing-standard` / `harness:scan:specs`                                     |
  | Backlog spec-doc        | work item          | `.agents/spec-docs/**`                                     | **partial** (ID↔type convention inconsistent + ungated: `INFRA-DOC-GUARD-001` filename leads `INFRA-DOC-GUARD` but frontmatter `type: BEHAVIOR`) | `spec-template.md` / `backlog-writer` / GATE-WRITE..COMPLETE → ID-convention follow-on |
  | ADR                     | decision record    | `.design/decisions/`                                       | **partial** (no gate)                                                                                                                            | template in skill / `architecture-decision-records` / — → follow-on                    |
  | Architecture-map subdoc | system structure   | `.agents/specs/architecture-map/*`                         | **partial** (content-policy only, no section schema/gate)                                                                                        | — / — / — → follow-on                                                                  |
  | Design / LLD            | component-internal | `packages/*/docs/design/` · cross-cutting `.agents/specs/` | **gap** (type undefined)                                                                                                                         | — / — / — → follow-on                                                                  |

- **Record the gaps as named follow-ons** in the index (proposed IDs, dependency = RULE-007):
  architecture-map document-type contract; design/LLD type definition; ADR completeness gate;
  spec-doc ID↔type naming-convention reconciliation + gate (fix `INFRA-DOC-GUARD-001` to conform).
  Each must publish all six meta-form elements.
- **Add the index scan** and register it in `harness:scan`.
- **Thin the rule.** Repoint `documentation-sync.md` "Architecture Map Content Policy" structural
  portion at the index as SSOT; keep its content (no-verbose-prose) policy.

## Affected Files

- New: `.agents/specs/document-standards/index.md`.
- New: `scripts/harness/check-document-standards-index.mjs` + self-test fixture.
- Edited: `package.json` (`harness:scan` aggregation), `.agents/rules/documentation-sync.md` (rule
  anchor → index), `AGENTS.md` (Document tree row).
- Not here (follow-on specs): per-type contracts for architecture-map, design/LLD, ADR-gate.

## Completion Criteria

- [x] TC-01: `.agents/specs/document-standards/index.md` exists and documents the meta-form with all **seven** required elements (Identity & Altitude, Lifecycle & Maintenance, Required Sections, Completeness Criteria, Source Integrity, Ownership & Non-Duplication, Quartet pointers) — `rg` confirmed 7 element headings present.
- [x] TC-02: the index taxonomy table lists every current document type (Package SPEC.md, Backlog spec-doc, ADR, Architecture-map subdoc, Design/LLD) with a `Status` of exactly one of `defined`/`partial`/`gap` and a Location column. Verified by the scan's taxonomy-integrity check (status-enum) passing.
- [x] TC-03: every `gap`/`partial` row names a follow-on (`missing-follow-on` check passes — all partial/gap rows carry a follow-on; IDs recorded in the index "Follow-on contracts" table, dependency = RULE-007).
- [x] TC-04: `node scripts/harness/check-document-standards-index.mjs` exits 1 on the ghost fixture (`scripts/harness/__tests__/fixtures/document-standards-index.ghost.md` → ghost-pointer + missing-follow-on); exits 0 on the real index. Verified 2026-06-30.
- [x] TC-05: `pnpm harness:scan` exits 0 with the new scan registered. **verified 2026-06-30** — WORKFLOW-001 complete; `pnpm harness:scan` exits 0 (38/38 scans green) with the document-standards scans registered.
- [x] TC-06: no duplication — the index links to `spec-writing-standard`/`backlog-writer` for their schemas rather than restating them (one-line pointers only; no schema bodies copied).

## Test Plan

Strategy (RULE + infra): mechanical presence/absence + scan exit-code checks only. No manual rows —
every criterion is a `rg` heading assertion or a harness exit code.

| TC-ID | Test Type | Tool / Approach                                                       | Notes                                  |
| ----- | --------- | --------------------------------------------------------------------- | -------------------------------------- |
| TC-01 | RULE      | `rg` six meta-form headings present in index                          | meta-form fully specified              |
| TC-02 | RULE      | `rg` taxonomy rows + Status enum                                      | every type catalogued with status      |
| TC-03 | RULE      | `rg` follow-on IDs in index                                           | gaps mapped to conforming specs        |
| TC-04 | INFRA     | `node check-document-standards-index.mjs` exit 1 (fixture) / 0 (real) | ghost-pointer guard via reused pattern |
| TC-05 | INFRA     | `pnpm harness:scan` exit 0                                            | scan registered, repo green            |
| TC-06 | RULE      | `rg -c` no restated schema bodies                                     | non-duplication (harness-governance)   |

## Tasks

- [x] `.agents/tasks/RULE-007.md` — 작성 완료 (Phase→TC 매핑 + Test Plan 포함). 구현 추적은 해당 파일에서.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-30

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` present; `type: RULE` (valid 11-prefix value); `tags: [infra]` present.
- Problem: concrete symptom (architecture-map docs have only a prose content-policy with no per-type section schema/gate; design/LLD type undefined; ADR has no gate) + reproduction ("ask what must `agent-system.md` contain to be complete, and which scan proves it — no answer document, no scan"); no TBD/TODO placeholders in criteria.
- Architecture Review: Affected Scope present (owner doc / harness / edited / reused-not-duplicated / follow-ons); all 4 checklist items `[x]`; Sibling scan `[x]` with evidence (spec-writing-standard, backlog-writer, ADR skill, architecture-map README + documentation-sync, INFRA-DOC-GUARD-001 adjacency); 3 Alternatives each Pro/Con (≥2); Decision references trade-off (one extra keystone layer vs. uniform gates/router).
- Completion Criteria: 6 items, all TC-N prefixed (TC-01..TC-06), each `rg`/exit-code observable; no banned vague language in criteria.
- Test Plan: present; 6 TC-N rows (TC-01..TC-06); each has Test Type + Tool/Approach; no manual rows.
- TC-N count matches: Completion Criteria 6 = Test Plan 6.
- Structure: Tasks section present with placeholder; Evidence Log present and empty before this run; no `## Status`/`## Classification` sections in body.
- Mechanical verification: `rg` confirmed 8/8 required headings, 0 forbidden body sections, 4/4 checklist `[x]`, TC counts 6=6.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-30

**Status upgrade:** review-ready → approved

- Prior gate: GATE-WRITE shows ✅ PASS in Evidence Log; input `status: review-ready` + `backlog/` folder match the expected input stage.
- Explicit approval: user gave verbatim approval in the current session — "승인합니다" — directly after being presented RULE-007's meta-form (6 elements) + taxonomy index structure and asked "승인하시겠습니까". "승인" matches the explicit-approval list.
- Directed at this spec: approval followed review of the keystone scope (meta-form + artifact taxonomy index; per-type contracts deferred as conforming follow-ons). Item-specific, unambiguous.
- Post-approval refinement: per the user's "legacy disposable / absorb discovered defects" directive (now `code-quality.md` + `feedback_legacy_disposable_no_shortcuts`), the Backlog spec-doc row was reclassified `defined → partial` and the spec-doc ID↔type naming-convention reconciliation was added as a follow-on. This is in-scope correction of the same artifact, not a scope reversal — Architecture Review Decision and frontmatter `type: RULE` unchanged.
- NON-COMPLIANCE trigger clear: no implementation files created before this gate (no index, no scan).

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-30

**Status upgrade:** approved → in-progress

- Prior gate: GATE-APPROVAL shows ✅ PASS above; input `status: approved` + `todo/` stage match.
- Tasks file created: `.agents/tasks/RULE-007.md` (was ABSENT before this run).
- Spec `## Tasks` updated: placeholder replaced with a reference to `.agents/tasks/RULE-007.md`.
- Spec pointer present in tasks file: `Spec: .agents/spec-docs/active/RULE-007-document-type-contracts.md`.
- TC coverage: phased tasks map to every Completion Criterion — TC-01..TC-06 each covered by ≥1 task; explicit TC Coverage Map in the tasks file.
- Test Plan section present in the tasks file (command-form verification for all 6 TCs).
