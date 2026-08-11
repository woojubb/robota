# RULE-009 — Design / LLD document-type definition

Spec: .agents/spec-docs/done/RULE-009-design-doc-type.md
Status: completed — contract + design-doc gate + template + design-doc-authoring skill landed; taxonomy row defined; harness:scan 38/38 green.

## Decision (recorded)

- Location: `packages/<pkg>/docs/design/<topic>.md` (package-local, English) + `.agents/specs/`
  (cross-cutting). `.design/` = ADR/decisions only, not LLD.
- "When required" = process guidance in the skill (structure-gated, existence-guided), NOT a hard scan.

## Phases

### Phase 1 — Contract body

- [x] Seven meta-form elements + location convention + MUST sections authored (spec; mirror to document-standards owner content).

### Phase 2 — Completeness gate

- [x] `scripts/harness/check-design-doc-completeness.mjs` — discover `packages/*/docs/design/**` (+ flagged cross-cutting design docs); assert MUST sections (Context & Goal, Constraints, Internal Structure, Key Flows, Test Approach); warn on missing SPEC link; structure only (no existence assertion).
- [x] Self-test fixture (missing-section doc → exit 1; repo → exit 0).
- [x] Register in `run-all-scans.mjs` + `package.json`.

### Phase 3 — Template + skill

- [x] `.agents/templates/design-doc-template.md` (all MUST sections).
- [x] `.agents/skills/design-doc-authoring/SKILL.md` (incl. "when required" guidance) + entry in `.agents/skills/index.md`.

### Phase 4 — Taxonomy + verify

- [x] Flip `document-standards/index.md` Design/LLD row `gap → defined`; `check-document-standards-index.mjs` exit 0.
- [x] `design-doc` + `document-standards` scans green standalone (full `harness:scan` green gated on WORKFLOW-001 WIP).

## TC Coverage Map

| TC                                              | Covered by       |
| ----------------------------------------------- | ---------------- |
| TC-01 (7 meta-form elements)                    | Phase 1          |
| TC-02 (location + MUST sections)                | Phase 1          |
| TC-03 (completeness scan 1/0)                   | Phase 2          |
| TC-04 (when-required guidance + structure-only) | Phase 2, Phase 3 |
| TC-05 (template + skill + index)                | Phase 3          |
| TC-06 (taxonomy defined + gate green)           | Phase 4          |
| TC-07 (`harness:scan` exit 0)                   | Phase 2, Phase 4 |

## Test Plan / 검증

Mechanical only. TC-01,02,04: `rg` over spec/skill. TC-03: `check-design-doc-completeness.mjs` against a
missing-section fixture (exit 1) + repo (exit 0). TC-05: template/skill existence + skill in index.
TC-06: index row `defined` + `check-document-standards-index.mjs` exit 0. TC-07: `pnpm harness:scan` exit
0 (full-scan re-verified post-WORKFLOW-001). No manual rows.
