---
title: 'SELFHOST-003: codebase indexing / RAG with budget-aware retrieval'
status: todo
created: 2026-07-16
priority: high
urgency: soon
area: packages/agent-tools, packages/agent-core, packages/agent-cli
depends_on: []
---

# Codebase indexing / RAG

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
