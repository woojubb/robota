# RULE-010 — ADR completeness gate

Spec: .agents/spec-docs/done/RULE-010-adr-completeness-gate.md
Status: completed — adr completeness gate landed; taxonomy row defined; harness:scan 38/38 green.

## Phases

### Phase 1 — Gate

- [x] `scripts/harness/check-adr-completeness.mjs` — over `.design/decisions/ADR-*.md`, assert MUST
      sections (Status, Context, Alternatives Considered, Decision, Consequences) + legal Status enum
      (proposed/accepted/superseded/rejected/deprecated).
- [x] Self-test fixture (missing section / bad status → exit 1).
- [x] Register in `run-all-scans.mjs` + `package.json`. Confirm ADR-001/002 pass.

### Phase 2 — Taxonomy + verify

- [x] Flip `document-standards/index.md` ADR row `partial → defined` + document contract.
- [x] `adr` + `document-standards` scans green standalone.

## TC Coverage Map

| TC                                    | Covered by             |
| ------------------------------------- | ---------------------- |
| TC-01 (7 meta-form elements)          | Phase 2 (index) / spec |
| TC-02 (MUST sections + status enum)   | Phase 1                |
| TC-03 (gate 1/0)                      | Phase 1                |
| TC-04 (taxonomy defined + gate green) | Phase 2                |
| TC-05 (`harness:scan` exit 0)         | Phase 1, Phase 2       |

## Test Plan / 검증

Mechanical. TC-01,02: `rg` over spec/index. TC-03: `check-adr-completeness.mjs` against a bad fixture
(exit 1) + `.design/decisions/` (exit 0). TC-04: index row `defined` + `check-document-standards-index.mjs`
exit 0. TC-05: `pnpm harness:scan` exit 0 (full-scan re-verified post-WORKFLOW-001). No manual rows.
