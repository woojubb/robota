# FLOW-007: natural-language workflow authoring & run via `/workflows`

- **Status:** in-progress (Phase 1)
- **Spec:** `.agents/spec-docs/draft/FLOW-007-workflows-nl-authoring.md`
- **Branch:** `feat/workflows-storage-layout` (Phase 1)
- **Approved:** 2026-07-06 (owner "승인함")

## Goal

Natural-language → authored + immediately-run workflow via `/workflows`, composing existing nodes and
creating prompt-backed nodes on the fly; model-invocable; active provider. Storage de-jargoned to
`.workflows/` (flat `.json` workflows + `nodes/`).

## Phases (each independently green)

- [ ] Phase 1: storage layout `.dag/` → `.workflows/` (flat `.json` workflows, `nodes/`). No migration.
- [ ] Phase 2: `/workflows create "<desc>"` — active-provider LLM → validated spec → assemble → save → run.
- [ ] Phase 3: on-the-fly prompt-node creation (saved to `.workflows/nodes/`, reusable).
- [ ] Phase 4: model-invocable (agent authors + runs from chat).

## Test Plan

TC-01..06 in the spec. Phase 1 (workspace layout parameterization) is verified by: `persistence-store`
unit tests (default `.workflows/` + a custom injected layout override); the full dag-cli suite (1007)
and agent-command-workflows suite green after propagating the layout to catalog-scanner, the `run`
walk-up, and the `/workflows catalog` command; and a **live end-to-end run** — `dag save` → `catalog
list` → `catalog run`, plus `node scaffold` → `dag run` (incl. from a subdirectory via walk-up) — all
operating consistently on `.workflows/` (flat `.json` workflows, `.workflows/nodes/`). Each later phase
adds command/agent-simulation tests plus a live UE, per the spec's TC table.
