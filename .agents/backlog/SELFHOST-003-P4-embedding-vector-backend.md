---
title: 'SELFHOST-003 P4: embedding-vector retrieval backend'
status: todo
created: 2026-07-18
priority: low
urgency: later
area: packages/agent-tools
depends_on: ['SELFHOST-003']
---

# Embedding-vector retrieval backend (SELFHOST-003 P4)

## Problem

SELFHOST-003 v1 (P1–P3) shipped the **repo-map graph-ranking** retrieval backend (no embedding infra):
contract + tool + neutral `RepoMapRetrievalAdapter` + build/persistence + incremental re-index. The spec
**consciously deferred** the second backend — an embedding vector store answering `query(nl_text) → top-k
chunks` — because it is NOT interchangeable behind the repo-map signature (repo-map takes active files /
mentioned identifiers, no NL query). This backlog tracks that deferred backend.

## Scope

Add an embedding-vector retrieval adapter (a second `IRetrievalAdapter` family) that answers a
natural-language query. **This may revise the port** (`IRetrievalRequest` currently has no NL-query field);
part of the work is deciding whether the vector backend extends `IRetrievalRequest` (add an optional
`query?`) or gets a distinct request type, keeping the repo-map path intact.

## Extraction trigger (from the spec, P4)

Per the SELFHOST-003 Decision + Family Decomposition: **iff** the vector backend makes retrieval adapters a
**third-party-installable family** (like `agent-provider-*`), extract the port/types to a new
`agent-interface-retrieval` package at that point — not before. Until then the port stays in `agent-tools`.

## Notes

Deferred at SELFHOST-003 GATE-COMPLETE (v1 = P1–P3 done; TC-01..05 satisfied). Heavy embedding SDKs must stay
OUT of `agent-tools` (inject via a duck-typed port + corpus from the surface, as the repo-map adapter does);
the mechanical neutrality floor for that is HARNESS-027. Follow the spec-gate pipeline when implementation
begins.
