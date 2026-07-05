# FLOW-007: natural-language workflow authoring & run via `/workflows`

- **Status:** in-progress (Phases 2–4 implemented; PR pending)
- **Spec:** `.agents/spec-docs/draft/FLOW-007-workflows-nl-authoring.md`
- **Branch:** `feat/workflows-storage-layout` (Phase 1, merged) → `feat/workflows-nl-authoring` (Phases 2–4)
- **Approved:** 2026-07-06 (owner "승인함")

## Goal

Natural-language → authored + immediately-run workflow via `/workflows`, composing existing nodes and
creating prompt-backed nodes on the fly; model-invocable; active provider. Storage de-jargoned to
`.workflows/` (flat `.json` workflows + `nodes/`).

## Phases (each independently green)

- [x] Phase 1: storage layout `.dag/` → `.workflows/` (flat `.json` workflows, `nodes/`). No migration. - 1a: layout parameterization (`IWorkspaceLayout`, default `.workflows/`). SHIPPED. - 1b: injection wiring — C1 `--workspace`/`workspace` option through dag-cli + `/workflows`
      composition roots, C2 receivers (`LocalDagRuntimeProvider`), C3 unify 3 readers via
      `scanWorkspaceCatalog`. DONE (live UE: custom `.myws` workspace round-trip).
- [x] Phase 2: `/workflows create "<desc>"` — active-provider LLM → validated spec → assemble → save → run.
      Authoring pipeline in `agent-command-workflows` (node-catalog → author via active provider →
      validate spec → `buildDagFromPipeline` → save legible `IDagDefinition` → run). Run input baked
      into the artifact (self-contained re-run). Live UE: `input | text-upper | text-output` → HELLO.
- [x] Phase 3: on-the-fly prompt-node creation (`createPromptBackedNodeDefinition`, saved to
      `.workflows/nodes/<type>.node.json`, reloaded by `loadInstantNodes`, reused on later `create`).
      Live UE (compiled): node manifest saved + reused; missing-key run surfaces a clear error.
- [x] Phase 4: model-invocable — `workflows` command + `create` subcommand `modelInvocable: true`
      (kind `builtin-command`), so the agent authors + runs from chat; `providerDefinitions` threaded
      from agent-cli `command-setup.ts`.

## Test Plan

TC-01..06 in the spec. Phase 1 (workspace layout parameterization) is verified by: `persistence-store`
unit tests (default `.workflows/` + a custom injected layout override); the full dag-cli suite (1007)
and agent-command-workflows suite green after propagating the layout to catalog-scanner, the `run`
walk-up, and the `/workflows catalog` command; and a **live end-to-end run** — `dag save` → `catalog
list` → `catalog run`, plus `node scaffold` → `dag run` (incl. from a subdirectory via walk-up) — all
operating consistently on `.workflows/` (flat `.json` workflows, `.workflows/nodes/`). Each later phase
adds command/agent-simulation tests plus a live UE, per the spec's TC table.
