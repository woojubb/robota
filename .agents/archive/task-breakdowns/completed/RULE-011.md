# RULE-011 — Spec-doc frontmatter & ID convention + gate

Spec: .agents/spec-docs/done/RULE-011-spec-doc-frontmatter-convention.md
Status: completed — README corrected + spec-doc-frontmatter validity gate landed; taxonomy row defined; harness:scan 38/38 green.

## Decision (recorded)

- Real convention: filename prefix = initiative/domain namespace; `type` frontmatter = orthogonal SDLC
  class ∈ 11. The README rule ("prefix comes from type") is WRONG — correct it. No renames.
- Gate: frontmatter validity (status/type∈11/tags) = blocking; duplicate `<ns>-<NNN>` ID = warning.
- Retract the false "INFRA-DOC-GUARD-001 defect" framing in the RULE-007 index.

## Phases

### Phase 1 — Correct docs

- [x] `.agents/spec-docs/README.md` — replace "prefix comes from the type" with the namespace + orthogonal-type convention.
- [x] `document-standards/index.md` — correct Backlog spec-doc note + naming follow-on; flip row `partial → defined`.

### Phase 2 — Gate

- [x] `scripts/harness/check-spec-doc-frontmatter.mjs` — over `.agents/spec-docs/**/*.md` (not README): assert `status` ∈ legal, `type` ∈ 11, `tags` present (blocking); warn on duplicate `<ns>-<NNN>`.
- [x] Self-test fixture (bad type / missing tags → exit 1).
- [x] Register in `run-all-scans.mjs` + `package.json`. Confirm all ~140 specs pass blocking; HARNESS-011/OBS-001 warn.

### Phase 3 — Verify

- [x] `spec-doc-frontmatter` + `document-standards` scans green standalone.

## TC Coverage Map

| TC                                                     | Covered by       |
| ------------------------------------------------------ | ---------------- |
| TC-01 (README corrected)                               | Phase 1          |
| TC-02 (validity gate 1/0)                              | Phase 2          |
| TC-03 (duplicate-ID warning)                           | Phase 2          |
| TC-04 (taxonomy defined + note corrected + gate green) | Phase 1, Phase 2 |
| TC-05 (`harness:scan` exit 0)                          | Phase 2, Phase 3 |

## Test Plan / 검증

Mechanical. TC-01: `rg` new/old wording in README. TC-02/03: `check-spec-doc-frontmatter.mjs` against a
bad fixture (exit 1) + real tree (exit 0, with dup warnings). TC-04: index row `defined` + corrected
note + `check-document-standards-index.mjs` exit 0. TC-05: `pnpm harness:scan` exit 0 (full-scan
re-verified post-WORKFLOW-001). No manual rows.
