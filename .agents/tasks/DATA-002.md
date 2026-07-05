# DATA-002: unified manifest-centered node persistence (WORKFLOW-005 P2 #2)

- **Status:** in-progress (Phase 1)
- **Spec:** `.agents/spec-docs/draft/DATA-002-unified-node-persistence.md`
- **Branch:** `feat/dag-unified-persistence`
- **Approved:** 2026-07-05 (owner "좋아"; model 나, metadata-in-.node.json, code=.js)

## Goal

One `PersistenceStore` over `.dag/`. Every node = a `.node.json` manifest (metadata SSOT, `kind`
prompt|composite|code); a code node additionally has a supplementary `.dag.node.js` (behavior only).
Workflows in `.dag/workflows/` via the same store. No legacy/migration (feature unreleased).

## Phases (size only — each independently green)

- [x] Phase 1: PersistenceStore + `.node.json` for data nodes (prompt/composite) + workflow routing.
- [x] Phase 2: `kind:'code'` manifest + supplementary `.dag.node.js`; code discovery in `.dag/nodes/`; remove scatter-scan.
- [ ] Phase 3: remaining command call sites (validate/node/studio + scaffold + save) cut over.

## Test Plan

TC-01..05 in the spec-doc: code manifest+companion load/run; prompt/composite `.node.json` round-trip;
workflow round-trip; missing-companion skip + nodeType precedence; real fs + LocalDagRunner e2e.
