---
status: done
type: RULE
tags: [infra]
---

# RULE-008: Architecture-map document-type contract

## Problem

The artifact taxonomy (`RULE-007`, `.agents/specs/document-standards/index.md`) marks the
**architecture-map subdoc** type as `partial`: only a prose **content policy** governs it
(`documentation-sync.md` "Architecture Map Content Policy" — what belongs vs. not), and a
**source-integrity** scan exists (`check-architecture-map-paths.mjs` — cited `packages/<name>` paths
must resolve). But the type has **no required-sections schema** and **no completeness gate**: "Is this
`*-system.md` complete / well-formed?" is not mechanically answerable, and a new architecture-map doc
(e.g. the DAG subsystem's `dag-system.md`, the first consumer) has no contract to author against.

Per `learning-loop.md` "Contract Before Automation", the type cannot get a generator/skill/gate until
it publishes a contract conforming to the `RULE-007` meta-form (all seven elements). This spec is that
contract.

Reproduction: open `.agents/specs/architecture-map/` — each doc follows a similar de-facto shape
(`# Title` → one-line scope → router back-link → relationship table/diagram), but nothing enforces it,
so a new or edited map doc can omit the scope, the router link, or any structure block and no scan
objects.

## Architecture Review

### Affected Scope

- **New (owner doc / contract):** this spec defines the architecture-map document-type contract — the
  seven meta-form elements, with the Required Sections grounded in the existing docs' de-facto spine.
- **New (gate):** `scripts/harness/check-architecture-map-completeness.mjs` — asserts each
  non-exempt architecture-map doc carries the required spine. Registered in `run-all-scans.mjs`.
  Distinct axis from `check-architecture-map-paths.mjs` (which stays the source-integrity check).
- **New (template):** `.agents/templates/architecture-map-template.md` — the required spine, ready to copy.
- **New (authoring skill):** `architecture-map-authoring` (domain-free) — how to write/maintain a map doc.
- **Edited:** `.agents/specs/document-standards/index.md` — flip the Architecture-map row
  `partial → defined` (quartet filled); the `document-standards` scan stays green. `package.json` +
  `run-all-scans.mjs` (register the completeness scan).
- **Reuses, does not duplicate:** `documentation-sync.md` owns the _content_ policy (linked, not
  restated); `check-architecture-map-paths.mjs` owns _source integrity_ (referenced as meta-form
  element 5, not re-implemented).
- **Exempt subtypes:** non-structural map docs — `architecture-lessons.md` (audit/lessons log),
  `layering-audit.md` — are exempted from the structure spine (same exemption set as
  `check-architecture-map-paths.mjs` SKIP_FILES), since they are logs, not relationship maps.

### The contract — the seven meta-form elements for the architecture-map document type

1. **Identity & Altitude.** Owns the _relationships_ between layers/elements of one architecture slice
   and the brief contract at each boundary. Durable, kept current. Does NOT own capability
   inventories, rationale, or API detail (those → owning `SPEC.md`).
2. **Lifecycle & Maintenance.** Living. Created when a new subsystem/product stack or cross-cutting
   concern appears; updated on any package-composition change (common-mistakes #45). Drift caught by
   `check-architecture-map-paths` (paths) + this spec's completeness scan (structure).
3. **Required Sections (the spine — MUST):**
   - **H1 title** naming the slice.
   - **Scope line** — a one-sentence statement of what this map owns (the first paragraph).
   - **Router back-link** to `../ARCHITECTURE-MAP.md`.
   - **≥1 structure block** — a relationship/layer table or a mermaid diagram (elements + edges +
     brief boundary contract).
   - _Recommended (warning, not fail):_ **owner pointers** — links to the `SPEC.md` / spec doc that
     owns each element's detail (formalized as a "Contract Owner Index" in `cross-cutting-contracts.md`).
     Subtype-specific sections (placement rules, deployment topology, target architecture) are allowed.
4. **Completeness Criteria (machine-checkable):** spine present (H1, scope paragraph, router link, ≥1
   table-or-mermaid block); no `TBD`/`TODO`; cited paths resolve (delegated). Missing owner pointers →
   warning.
5. **Source Integrity.** Cited `packages/<name>/...` paths resolve — delegated to
   `check-architecture-map-paths.mjs`; this contract does not re-implement it.
6. **Ownership & Non-Duplication.** Relationships + brief boundary contracts live here; rationale,
   inventories, and API detail live in the owning `SPEC.md`. The _content_ rules are owned by
   `documentation-sync.md` (linked, not copied).
7. **Quartet pointers.** location `.agents/specs/architecture-map/*` · template
   `.agents/templates/architecture-map-template.md` (new) · skill `architecture-map-authoring` (new) ·
   gate `check-architecture-map-paths` (integrity) + `check-architecture-map-completeness` (structure).

### Alternatives Considered

1. **Leave it at the prose content-policy (status quo).** Pro: no work. Con: keeps the type `partial` —
   no completeness gate, `dag-system.md` and future map docs have nothing to author against; drift
   stays invisible until a human audit. Rejected.
2. **Define the contract + a structure-completeness gate, reusing the existing path/content guards (chosen).**
   Pro: flips the type to `defined`; `dag-system.md` gets a template + gate; reuses content-policy and
   path-integrity instead of duplicating them. Con: one new scan + skill + template. Accepted.
3. **One rigid section list for all map subdocs.** Pro: simplest gate. Con: the family is heterogeneous
   (dependency-direction vs. apps-and-deployment vs. cross-cutting-contracts have different natural
   sections) — a rigid list would force unnatural structure. Rejected in favor of a minimal spine +
   allowed subtype sections.

### Decision

Alternative 2. Publish the architecture-map document-type contract (seven meta-form elements, spine
grounded in the existing docs) + a structure-completeness scan (exempting log-type docs) + a template +
an authoring skill, and flip the taxonomy row to `defined`. Source integrity and content policy are
referenced, not duplicated. First consumer: `dag-system.md` (WORKFLOW-001 / the DAG absorption).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — this spec, new scan/template/skill, `document-standards/index.md`, `package.json`, `run-all-scans.mjs`; reuses documentation-sync + check-architecture-map-paths.
- [x] Sibling scan 완료 — extracted the de-facto spine from `agent-system.md` / `dependency-direction.md` / `cross-cutting-contracts.md`; confirmed `check-architecture-map-paths.mjs` (source integrity) and `documentation-sync.md` (content policy) as the reused, non-duplicated owners; `architecture-lessons.md`/`layering-audit.md` identified as exempt log subtypes.
- [x] 대안 최소 2개 검토 완료 — 3개 (status-quo / contract+gate / one-rigid-list).
- [x] 결정 근거 문서화 완료 — minimal spine + allowed subtype sections; reuse integrity/content guards; flip taxonomy to defined; dag-system.md as first consumer.

## Solution

- Author the contract body (above) into the document-standards system as the architecture-map type's
  owner content (in `index.md` follow-on section or a dedicated `architecture-map.md` contract doc
  under `document-standards/`, decided at implement).
- Build `check-architecture-map-completeness.mjs` reusing `walkMarkdown` from
  `check-architecture-map-paths.mjs`; SKIP the exempt log docs; assert the spine; warn on missing owner
  pointers. Register in `run-all-scans.mjs` + `package.json`.
- Add `.agents/templates/architecture-map-template.md` (the spine) and the `architecture-map-authoring`
  skill (+ `.agents/skills/index.md` entry).
- Flip the `document-standards/index.md` Architecture-map row to `defined`; keep the `document-standards`
  scan green.
- Confirm every non-exempt existing map doc satisfies the spine; remediate any that do not in this work
  (absorb the defect, do not exempt to dodge — `feedback_legacy_disposable_no_shortcuts`).

## Affected Files

- New: `scripts/harness/check-architecture-map-completeness.mjs` (+ fixture),
  `.agents/templates/architecture-map-template.md`, `.agents/skills/architecture-map-authoring/SKILL.md`.
- Edited: `.agents/specs/document-standards/index.md` (row → defined), `package.json`,
  `scripts/harness/run-all-scans.mjs`, `.agents/skills/index.md`.
- Referenced (not edited): `.agents/rules/documentation-sync.md`, `scripts/harness/check-architecture-map-paths.mjs`.

## Completion Criteria

- [x] TC-01: this contract documents all **seven** meta-form elements for the architecture-map type — `rg` confirmed 7 element headings.
- [x] TC-02: the Required Sections defines the MUST spine (H1, scope line, up-link, ≥1 structure block — router link-list counts) and marks owner pointers as recommended/warning; subtype-specific sections explicitly allowed.
- [x] TC-03: `check-architecture-map-completeness.mjs` exits 1 on the `architecture-map-incomplete.md` fixture (missing up-link + structure); exits 0 over the real dir (exempting README / architecture-lessons / layering-audit). Verified 2026-06-30. Implementation absorbed a discovered defect (5 nested `agent-cli/*` docs lacked an up-link → remediated with a parent-router back-link).
- [x] TC-04: source integrity delegated — the scan header documents that path existence is NOT re-checked (owned by `check-architecture-map-paths.mjs`); contract element 5 references it.
- [x] TC-05: `.agents/templates/architecture-map-template.md` (MUST spine) + `.agents/skills/architecture-map-authoring/SKILL.md` exist; skill listed in `.agents/skills/index.md`.
- [x] TC-06: the `document-standards/index.md` Architecture-map row reads `defined` (quartet filled); `check-document-standards-index.mjs` exits 0.
- [x] TC-07: `pnpm harness:scan` exits 0. **verified 2026-06-30** — WORKFLOW-001 complete; `pnpm harness:scan` exits 0 (38/38 scans green) with the document-standards scans registered.

## Test Plan

Strategy (RULE + infra): mechanical presence/absence + scan exit-code checks. No manual rows.

| TC-ID | Test Type | Tool / Approach                                                                    | Notes                         |
| ----- | --------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| TC-01 | RULE      | `rg` seven meta-form element headings                                              | contract complete             |
| TC-02 | RULE      | `rg` spine MUST list + recommended/subtype note                                    | required sections defined     |
| TC-03 | INFRA     | `check-architecture-map-completeness.mjs` exit 1 (fixture) / 0 (real, exempt logs) | structure gate works          |
| TC-04 | RULE      | `rg` delegation to check-architecture-map-paths; no path re-check in new scan      | non-duplication               |
| TC-05 | INFRA     | template + skill files exist; skill in index                                       | quartet template+skill filled |
| TC-06 | INFRA     | index row `defined` + `check-document-standards-index.mjs` exit 0                  | taxonomy flipped, gate green  |
| TC-07 | INFRA     | `pnpm harness:scan` exit 0                                                         | scan registered               |

## Tasks

- [x] `.agents/tasks/RULE-008.md` — 작성 완료. 구현 추적은 해당 파일에서.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-30

**Status upgrade:** draft → review-ready

- Frontmatter (`status: draft`, `type: RULE`, `tags: [infra]`); Problem with symptom + reproduction; Architecture Review with Affected Scope, seven meta-form elements, 4/4 checklist `[x]`, Sibling scan evidence, 3 Alternatives Pro/Con, Decision with trade-off; 7 TC-N Completion Criteria; 7-row Test Plan (count match 7=7); Tasks placeholder; empty Evidence Log; no forbidden body sections.
- Mechanical verification: `rg` confirmed frontmatter, 8/8 headings, 4/4 checklist, 7/7 meta-form elements, TC 7=7, 0 forbidden sections, 0 banned vague.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-30

**Status upgrade:** review-ready → approved

- Prior gate: GATE-WRITE ✅ PASS above; input `status: review-ready` + `backlog/` stage match.
- Approval authority: the user issued a standing delegation this session — "내가 선택하는게 큰 의미없는 선택지는 너가 타당한 근거와 함께 선택하고 중요한 문제도 우리 규칙을 토대로 타당한 근거와 함께 너가 선택하면서 모든 작업을 끝까지 완료" (recorded in `feedback_autonomous_completion`). Per the precedence chain (user instruction > harness rule), this pre-delegates GATE-APPROVAL for the document-standards follow-on work; the agent approves with rule-based justification. Not within the delegation's exceptions (no irreversible external action / IP-security boundary / fundamental product-direction change — this is internal harness governance).
- Rule-based decision recorded — owner-SPEC pointers = **warning (non-blocking)**, spine = **blocking**. Basis: `INFRA-DOC-GUARD-001` block/warn precedent + minimal-spine principle; C4 (`feedback_legacy_disposable_no_shortcuts`) honored by verifying/​remediating non-exempt docs against the MUST spine during implement rather than exempting to dodge.
- No post-approval drift: Architecture Review Decision + frontmatter unchanged.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-30

**Status upgrade:** approved → in-progress

- Prior gate: GATE-APPROVAL ✅ PASS above.
- Tasks file `.agents/tasks/RULE-008.md` created; spec `## Tasks` updated to reference it; spec pointer present in the tasks file; phased tasks cover TC-01..TC-07 (TC Coverage Map in the tasks file); Test Plan section present in the tasks file.

### [GATE-WRITE] — ✅ PASS | 2026-06-30

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block; `status: draft`; `type: RULE` (valid 11-prefix); `tags: [infra]`.
- Problem: concrete symptom (architecture-map type is `partial` — content-policy + path-integrity exist but no required-sections schema / completeness gate; `dag-system.md` has nothing to author against) + reproduction (a new/edited map doc can omit scope/router/structure and no scan objects); no TBD/TODO in criteria.
- Architecture Review: Affected Scope present (contract / new gate / template / skill / edited / reused-not-duplicated / exempt subtypes); seven meta-form elements specified with spine grounded in existing docs; all 4 checklist `[x]`; Sibling scan `[x]` with evidence (extracted de-facto spine from agent-system/dependency-direction/cross-cutting-contracts; identified check-architecture-map-paths + documentation-sync as reused owners; exempt log subtypes); 3 Alternatives each Pro/Con; Decision references trade-off (minimal spine vs. rigid list; reuse vs. duplicate).
- Completion Criteria: 7 items, all TC-N prefixed (TC-01..TC-07), each `rg`/exit-code observable; no banned vague language.
- Test Plan: present; 7 TC-N rows; each has Test Type + Tool/Approach; no manual rows.
- TC-N count matches: Completion Criteria 7 = Test Plan 7.
- Structure: Tasks placeholder present; Evidence Log empty before this run; no `## Status`/`## Classification` body sections.
- Mechanical verification: `rg` confirmed frontmatter, 8/8 headings, 4/4 checklist `[x]`, 7/7 meta-form elements, TC 7=7, 0 forbidden sections, 0 banned vague.
