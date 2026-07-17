---
status: draft
type: DATA
tags: [rag, codebase-index, retrieval, agent-tools, selfhost]
---

# SELFHOST-003: codebase indexing / RAG with budget-aware retrieval

## Problem

Promotes backlog [SELFHOST-003](../../backlog/SELFHOST-003-codebase-index-rag.md) toward
[VISION.md](../../../VISION.md). To develop Robota, Robota must understand the Robota codebase; Robota has **no
advertised code-index/retrieval** story. Table-stakes for coding agents.

## Prior Art Research

Cursor local embedding index over 100k+ files, incremental (https://cursor.com/docs/agent/overview); aider
repo-map graph ranking within a token budget (https://aider.chat/docs/repomap.html); Mastra standardized
chunk → embed → store → retrieve pipeline (https://mastra.ai/rag-pipeline); GitHub Copilot RAG over code search
(https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent). Common shape: a semantic
index + **budget-aware** context selection. Robota constraint (library-neutrality): the retrieval _mechanism_
(interface + tool) is neutral and lives in `agent-tools`; the corpus/domain (which repo, what to index) is product
policy in `agent-cli`/`apps/agent-app`. Two viable index backends surfaced (embedding-vector vs aider-style
repo-map graph) — the adapter boundary must hide both.

## Architecture Review

### Affected Scope

- **`agent-tools`**: a neutral **retrieval interface + tool** (query → ranked chunks within a token budget).
- **`agent-core` / `agent-interface-*`**: the retrieval contract (pure types) if cross-cutting.
- **index adapter behind DIP**: embedding-vector and/or repo-map graph, pluggable; default in a surface/adapter.
- Corpus wiring in `agent-cli`/`apps/agent-app`.

### Alternatives Considered

1. **Neutral retrieval interface+tool in agent-tools; index adapter behind DIP; corpus in surfaces (CHOSEN).**
   - ✅ Correct layer + neutrality; swappable index backend (vector or repo-map); budget-aware.
   - ❌ Requires a clean adapter contract that fits both an embedding store and a graph-rank repo map.
2. **Bake an embedding vector store into a library.**
   - ✅ Simplest single implementation.
   - ❌ Couples a heavy dependency + a domain choice into `packages/`; violates neutrality + forces one backend.
     REJECTED.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-tools (interface+tool), agent-interface-\* (contract), adapter behind DIP, corpus in surfaces.
- [x] Sibling scan 완료 — new tool follows the existing agent-tools tool-factory pattern; no skin-on-a-sibling; index engine isolated behind DIP.
- [x] 대안 최소 2개 — 2 considered (neutral-interface+adapter CHOSEN; baked-vector-store REJECTED neutrality), each Pro+Con.
- [x] 결정 근거 — mechanism-in-libs / corpus-in-surfaces (neutrality) + swappable backend; independent GATE-APPROVAL to run.

## Solution

A retrieval interface (`query(text, {tokenBudget})` → ranked chunks) + a tool that calls it, in agent-tools;
a pluggable index adapter (reference: repo-map graph ranking, token-budget aware) behind DIP; the corpus + which
adapter to use configured in the surface.

## Affected Files

| File                                        | Change                                      |
| ------------------------------------------- | ------------------------------------------- |
| `packages/agent-tools/src/retrieval/` (new) | retrieval interface + tool                  |
| `packages/agent-interface-*`                | retrieval contract types (if cross-cutting) |
| a reference index adapter (new)             | repo-map/vector adapter behind DIP          |
| `packages/agent-cli/`, `apps/agent-app/`    | corpus wiring + default adapter             |

## Completion Criteria

- [ ] TC-01: the retrieval interface returns ranked chunks and never exceeds the given token budget (unit test).
- [ ] TC-02: a reference adapter indexes a fixture repo and returns relevant chunks for a known query (functional test).
- [ ] TC-03: no corpus/domain content in `packages/` (neutrality + interface-runtime guards pass).
- [ ] TC-04: the index engine is behind a DIP adapter (swapping the adapter needs no agent-tools change) — verified.

## Test Plan

| TC    | Verification              | Type/Tool              |
| ----- | ------------------------- | ---------------------- |
| TC-01 | budget respected + ranked | vitest unit            |
| TC-02 | fixture repo retrieval    | functional test        |
| TC-03 | neutrality                | interface-runtime scan |
| TC-04 | adapter swap              | design/unit            |

## Tasks

`.agents/tasks/SELFHOST-003.md` — 미생성 (GATE-APPROVAL 통과 후 생성).

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Required before ENDORSE:
  (a) **resolve the DIP boundary for real** — a vector store (`query(text)→top-k`) and aider's repo-map (ranks
  symbols from active files, no NL query) do NOT fit one `query(text)` port; scope v1 to ONE backend + design the
  port to it, record the other as consciously deferred (per "Validated Recommendation Before Approval" capability
  preservation). (b) **pin the cross-cutting contract** to `agent-interface-retrieval` (or agent-core), remove the
  "if cross-cutting" hedge. (c) commit the adapter placement per the Family Decomposition Rule (thin reference
  adapter at agent-cli root vs a per-member package for a heavy backend); state the `createRetrievalTool({adapter})`
  injection path. (d) **split into an epic** (contract + tool + thin adapter now; index build/persistence +
  incremental re-index + production backend as follow-ups). (e) TC-03 tool is wrong (`interface-runtime` scan does
  not check agent-tools neutrality) — build/name a real check or mark manual. (f) **verify or replace the Prior Art
  URLs** (some suspected fabricated); tighten Problem to a concrete self-hosting retrieval scenario. **Revision pending.**
