---
title: 'SELFHOST-008 P5: concrete semantic/vector memory backend'
status: todo
created: 2026-07-18
priority: low
urgency: later
area: apps/agent-cli
depends_on: ['SELFHOST-008']
---

# Concrete semantic/vector memory backend (SELFHOST-008 P5)

> Parent SELFHOST-008 is verified done and archived to `completed/SELFHOST-008-durable-semantic-memory.md` (2026-07-24); this consciously-deferred slice stays open.

## Problem

SELFHOST-008's **neutral library is complete** (P1 port + fs reference adapter, P1R async remediation, P2 live
auto-capture, HARNESS-029 neutrality floor, P3 per-turn recall wiring, P4 `SemanticMemoryStore` decorator). The
duck-typed `ISemanticMemoryAdapter` port (`packages/agent-framework/src/memory/types.ts`) is now **consumed** by the
neutral `SemanticMemoryStore` decorator, which upgrades the live P2/P3 recall+index paths. What remains is a **concrete
adapter** — a real embedder + vector store implementing `ISemanticMemoryAdapter` — which is **surface-side** and
consciously deferred (mirrors SELFHOST-003 P4's deferred embedding-vector backend). No neutral-library work remains.

## Scope

Implement a concrete `ISemanticMemoryAdapter` (`index(IAppendMemoryInput)` + `query(text, budget)`) in a SURFACE
(`agent-cli` / `apps/agent-app`), backed by a real embedder + vector store, and compose it via
`createSemanticMemoryStore(createFileSystemMemoryStore(cwd), adapter)` injected through the existing `memoryStore` seam.
The heavy embedding/vector SDK stays OUT of `packages/` — it lives in the surface, injected behind the duck-typed port
(as `E2BSandboxClient` does for the E2B SDK). Decisions this slice must make: which embedder + vector store; local
(e.g. sqlite-vec / an in-process HNSW) vs remote (pgvector / a hosted vector DB); and the **adapter key-normalization
contract** (the adapter must key its index/query on the same normalized topic the durable store writes — or a stable id
— see `semantic-memory-store.ts` append() note).

## Known items to address (from the P4 review + spec)

- **Idempotent re-index / the dedup gap:** the decorator skips `adapter.index()` when the base `append` returns
  `deduplicated: true`, so an entry durably written BEFORE the adapter was injected (or during a prior index failure)
  is permanently skipped from the vector index (keyword-recallable, but omitted from a healthy semantic `query()`). The
  robust fix is an **`upsert-by-id`** verb — consider adding `delete(reference)` / upsert to `ISemanticMemoryAdapter`
  (the reserved v2 verbs) so a backfill/re-index is possible.
- **Hybrid recall (deferred):** P4 ships **tiered** recall (semantic-primary, keyword-fallback-on-error). Full hybrid
  RRF fusion (keyword + semantic merged by score) is the mature end-state (Zep/Weaviate) but needs per-hit `score?` on
  the query result — reserved.
- **Mechanical neutrality floor:** HARNESS-029 detects seeded content/prompts but does NOT scan `package.json`
  dependencies. Consider a mechanical dep-allowlist floor (mirroring the filed HARNESS-027 for agent-tools) so a vector
  SDK cannot be added to `packages/agent-framework` unnoticed.

## Extraction trigger

Per the SELFHOST-008 Family Decomposition: **iff** a second `ISemanticMemoryAdapter` family becomes third-party
installable, extract the port/types to a new `agent-interface-memory` package at that point — not before. Until then
the port stays in `agent-framework`.

## Notes

Deferred at the SELFHOST-008 library build-out completion (P1–P4 done, all gates). Follow the full spec-gate pipeline
(GATE-WRITE → APPROVAL → IMPLEMENT → VERIFY → COMPLETE) when implementation begins; the GATE-COMPLETE user-execution
scenario should demonstrate a real paraphrased-recall hit end-to-end through a surface with the concrete adapter.
