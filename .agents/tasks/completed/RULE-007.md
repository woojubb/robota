# RULE-007 — Document-Type Contracts (meta-form + taxonomy index)

Spec: .agents/spec-docs/done/RULE-007-document-type-contracts.md
Status: completed — Phase 1–4 complete; TC-05 unblocked (WORKFLOW-001 committed; pnpm harness:scan 38/38 green).

## Phases

### Phase 1 — Author the owner doc (index) ✅

- [x] Create `.agents/specs/document-standards/index.md` with the **meta-form** (7 required elements:
      Identity & Altitude, Lifecycle & Maintenance, Required Sections, Completeness Criteria, Source
      Integrity, Ownership & Non-Duplication, Quartet pointers) and the **taxonomy table** (every doc
      type → altitude, location, status defined/partial/gap, {template/skill/gate}).
- [x] Record each `gap`/`partial` row's follow-on with dependency on RULE-007.
- [x] Link (not restate) `spec-writing-standard` / `backlog-writer` for their schemas.
- [x] Anchor to `learning-loop.md` › "Contract Before Automation" (parent principle).

### Phase 2 — Mechanical gate ✅

- [x] `scripts/harness/check-document-standards-index.mjs` — link integrity (no ghost pointers) +
      taxonomy integrity (status enum + follow-on presence). Self-contained pointer resolution
      (same axis as `check-architecture-map-paths.mjs`).
- [x] Self-test fixture `scripts/harness/__tests__/fixtures/document-standards-index.ghost.md`: ghost
      pointer → scan exit 1; real index → exit 0. Verified.
- [x] Register the scan: `run-all-scans.mjs` (`document-standards`) + `package.json`
      (`harness:scan:document-standards`).

### Phase 3 — Wire + thin ✅

- [x] Repoint `documentation-sync.md` "Architecture Map Content Policy" structural part at the index as SSOT (kept its content policy).
- [x] Add the document-standards index row to the AGENTS.md Document tree.

### Phase 4 — Verify (partial)

- [x] `document-standards` scan green standalone + via alias; adjacent scans (arch-map-paths, document-authority) unaffected.
- [x] `pnpm harness:scan` exit 0 — **BLOCKED**: full scan red due to WORKFLOW-001's 36 uncommitted DAG packages. Re-verify at WORKFLOW-001 Phase E.

## TC Coverage Map

| TC                                  | Covered by       |
| ----------------------------------- | ---------------- |
| TC-01 (meta-form 7 elements)        | Phase 1          |
| TC-02 (taxonomy rows + status enum) | Phase 1          |
| TC-03 (follow-on IDs per gap)       | Phase 1          |
| TC-04 (ghost-pointer scan exit 1/0) | Phase 2          |
| TC-05 (`harness:scan` exit 0)       | Phase 2, Phase 4 |
| TC-06 (no restated schema bodies)   | Phase 1          |

## Test Plan / 검증

Mechanical only. TC-01..03,06: `rg` heading/row/ID/no-duplication assertions over
`.agents/specs/document-standards/index.md`. TC-04: `node scripts/harness/check-document-standards-index.mjs`
against a ghost-pointer fixture (exit 1) and the real index (exit 0). TC-05: `pnpm harness:scan` exit 0
with the new scan registered. No manual rows — every criterion is a `rg` match or a process exit code.
