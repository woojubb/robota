# RULE-008 — Architecture-map document-type contract

Spec: .agents/spec-docs/done/RULE-008-architecture-map-doc-contract.md
Status: completed — contract + arch-map-completeness gate + template + architecture-map-authoring skill landed; taxonomy row defined; harness:scan 38/38 green.

## Decision (recorded)

- Spine = blocking; owner-SPEC pointers = warning (non-blocking). Exempt log docs:
  `architecture-lessons.md`, `layering-audit.md`. C4 honored: verify/remediate non-exempt docs to the
  MUST spine during this work.

## Phases

### Phase 1 — Contract body

- [x] The seven meta-form elements for the architecture-map type are authored (in the spec; mirror the
      durable form into `document-standards/` as the type's owner content).

### Phase 2 — Completeness gate

- [x] `scripts/harness/check-architecture-map-completeness.mjs` — reuse `walkMarkdown`; SKIP exempt
      logs; assert MUST spine (H1, scope paragraph, router back-link, ≥1 table-or-mermaid block);
      warn on missing owner-SPEC pointers; do NOT re-check path existence (delegated).
- [x] Self-test fixture (missing-spine doc → exit 1; real dir → exit 0).
- [x] Register in `run-all-scans.mjs` + `package.json`.
- [x] Verify/remediate every non-exempt existing map doc passes the spine.

### Phase 3 — Template + skill

- [x] `.agents/templates/architecture-map-template.md` (full MUST spine).
- [x] `.agents/skills/architecture-map-authoring/SKILL.md` + entry in `.agents/skills/index.md`.

### Phase 4 — Taxonomy + verify

- [x] Flip `document-standards/index.md` Architecture-map row `partial → defined`; `check-document-standards-index.mjs` exit 0.
- [x] `document-standards` + `arch-map-completeness` scans green standalone (full `harness:scan` green gated on WORKFLOW-001 WIP).

## TC Coverage Map

| TC                                    | Covered by       |
| ------------------------------------- | ---------------- |
| TC-01 (7 meta-form elements)          | Phase 1          |
| TC-02 (MUST spine + warn/subtype)     | Phase 1          |
| TC-03 (completeness scan 1/0)         | Phase 2          |
| TC-04 (delegation, no path re-check)  | Phase 2          |
| TC-05 (template + skill + index)      | Phase 3          |
| TC-06 (taxonomy defined + gate green) | Phase 4          |
| TC-07 (`harness:scan` exit 0)         | Phase 2, Phase 4 |

## Test Plan / 검증

Mechanical only. TC-01,02,04: `rg` over the spec/contract. TC-03: `check-architecture-map-completeness.mjs`
against a missing-spine fixture (exit 1) + the real dir (exit 0). TC-05: template/skill file existence +
skill listed in index. TC-06: index row `defined` + `check-document-standards-index.mjs` exit 0. TC-07:
`pnpm harness:scan` exit 0 (full-scan green re-verified post-WORKFLOW-001). No manual rows.
