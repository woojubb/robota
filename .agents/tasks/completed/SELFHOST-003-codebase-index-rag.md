---
title: 'SELFHOST-003: codebase indexing / RAG with budget-aware retrieval'
status: done
completed: 2026-07-18
created: 2026-07-16
priority: high
urgency: soon
area: packages/agent-tools, packages/agent-core, packages/agent-cli
depends_on: []
---

# Codebase indexing / RAG

## Outcome (DONE 2026-07-18 — v1 P1–P3)

Shipped: neutral retrieval contract + `CodebaseRetrieval` tool + budget-aware repo-map graph-ranking adapter in
`packages/agent-tools/src/retrieval/` (adapter behind DIP, persistence + incremental re-index).
Spec: `.agents/spec-docs/done/SELFHOST-003-codebase-index-rag.md` (GATE-COMPLETE 2026-07-18; landing PRs
#1200, #1202, #1203). The consciously-deferred embedding-vector backend is split out as
[SELFHOST-003-P4](../SELFHOST-003-P4-embedding-vector-backend.md) (stays open).
Verified 2026-07-24: retrieval test suite green (2 files, 18 tests).

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md). To build
Robota, Robota must understand the Robota codebase. Robota has no advertised code-index/retrieval story — a
table-stakes capability for coding agents.

## What

A neutral **retrieval interface + tool** (`agent-tools`) with a pluggable index adapter behind DIP (embedding
vector index and/or aider-style repo-map graph ranking), and **budget-aware context selection** (retrieve
within a token budget). Mechanism only in libraries; the actual corpus/domain wiring (which repo, what to
index) lives in `agent-cli`/`apps/agent-app` per library-neutrality.

## Prior Art

Cursor local embedding index over 100k+ files, incremental (https://cursor.com/docs/agent/overview); aider
repo-map graph ranking within a token budget (https://aider.chat/docs/repomap.html); Mastra standardized
chunk→embed→store→retrieve pipeline (https://mastra.ai/rag-pipeline); GitHub Copilot RAG over code search
(https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent).

## Test Plan

Unit tests for the retrieval interface + a reference adapter; a functional test that retrieval respects a token
budget and returns relevant chunks for a known query; neutrality guard (no corpus/domain in libs). Architecture
Review must decide the adapter boundary (index engine behind DIP) before implementation.
