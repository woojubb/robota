---
status: in-progress
type: DATA
tags: [typescript, async]
---

# DATA-002: unified manifest-centered node persistence (WORKFLOW-005 P2 #2)

## Problem

DAG persistence is fragmented across three independent on-disk formats with three independent
save/scan/load implementations and duplicated `.dag/` path + readdir-scan boilerplate (private DAG
subsystem — no publish):

1. **Workflows** — `.dag/workflows/*.dag.json` (`saveCommand` `commands/save.ts:280`; `scanCatalogDir`
   `catalog/catalog-scanner.ts:46`). Data-only `IDagDefinition`/`IDagWorkflowFile`.
2. **Instant nodes** — `.dag/nodes/*.instant-node.json` (`saveInstantNodeToDisk` /
   `loadSavedInstantNodes` `mcp/handlers/instant-nodes.ts`; record `TPersistedInstantNode`,
   `kind:'prompt'|'composite'`, per BEHAVIOR-006). Data → rebuilt class instance.
3. **Code nodes** — `*.dag.node.js` scattered anywhere in the project, discovered by a whole-tree
   scanner (`local-runner/local-node-loader.ts` `loadLocalNodeDefinitions`), loaded via dynamic
   `import()`. No manifest, no save path; behavior is authored JS.

There is **no shared abstraction**. Adding a new savable kind (e.g. Phase C data-code nodes) means a
fourth silo. Code nodes are structurally orphaned from the node registry (no metadata record; loaded
by a different mechanism than instant nodes).

## Architecture Review

### The unified model (greenfield — no legacy/back-compat)

`/workflows` is not a released feature, so there is **no legacy and no migration**. The formats are
redefined to the single correct model, and every call site is switched directly. Representation is
chosen per kind — **not dogmatically paired** — for the naturally-right shape.

**One store owns `.dag/` and all persistence.** Every node has a **`.node.json` manifest** — the
ALWAYS-present base that holds all metadata (nodeType, kind, displayName, ports, …). The behavior code
`.js` is **supplementary**, attached only to code-kind nodes; metadata always lives in the manifest,
never in the `.js`:

```
.dag/nodes/
  greet.node.json        manifest (ALWAYS) — kind 'prompt' : metadata + systemPromptTemplate + ports
  merge.node.json        manifest (ALWAYS) — kind 'composite' : metadata + innerDag + exposed ports
  upshout.node.json      manifest (ALWAYS) — kind 'code' : metadata + ports + codeFile pointer
  upshout.dag.node.js    SUPPLEMENTARY — the execute() behavior for the 'code' node (behavior only)
.dag/workflows/
  <name>.dag.json        workflow (data-only), managed by the same store
```

- **`prompt` / `composite`** → the `.node.json` manifest is the whole node (behavior is data). Non-pair.
- **`code`** → the `.node.json` manifest holds the metadata (nodeType, ports, `kind:'code'`, a
  `codeFile` pointer); the paired `.dag.node.js` holds **only** the `execute()` behavior. On load: read
  the manifest for metadata → `import()` the companion for behavior → `adaptSimpleNode`
  (`local-node-loader.ts:36`) combines them. Metadata is read from the manifest, so nodes can be
  listed/validated **without importing arbitrary code**.
- **Workflows** → `.dag/workflows/*.dag.json`, managed by the same store (data-only, load = parse).

**Manifest filename:** the record extension is generalized from BEHAVIOR-006's `.instant-node.json`
to **`.node.json`** — it is now the universal node manifest (all kinds), not instant-specific.
(No legacy → free to rename.) The data-node record shape (`TPersistedInstantNode`) is otherwise
unchanged; `kind:'code'` is added.

Code nodes live **uniformly in `.dag/nodes/`** (discovered by the store), replacing the ad-hoc
whole-project scatter-scan. `--node-file <path>` remains an explicit escape hatch. No scatter-scan,
`kind`-inference, or migration is carried (no legacy).

This delivers "save a node OR a workflow, reload it" through **one store** with **one uniform metadata
record** (`.node.json`) per node; behavior code is a supplementary attachment for code-kind nodes.

### Affected Scope

- `packages/dag-cli/src/local-runner/persistence/` (NEW) — the `PersistenceStore`: `saveNode(def)`,
  `loadNodes(liveDefs)`, `saveWorkflow(name, def)`, `loadWorkflows()`, `scanNodeArtifacts()`. Owns all
  `.dag/` path computation + readdir-skip boilerplate (removing the inline duplication in `save.ts`,
  `catalog-scanner.ts`, `instant-nodes.ts`, `local-node-loader.ts`).
- `packages/dag-cli/src/local-runner/local-node-loader.ts` + `node-registry.ts` — code-node discovery
  moves to `.dag/nodes/` via the store; the whole-project scatter-scan is removed (no legacy).
  `loadNodeFileExplicit` (`--node-file`) retained.
- `packages/dag-cli/src/mcp/handlers/instant-nodes.ts` + `mcp/context.ts` — route through the store.
- `packages/dag-cli/src/commands/{save,catalog,run,validate,node}.ts`, `studio/http-server.ts` — switch
  to the store for save/scan/load (direct cut-over, no shims).
- `packages/dag-nodes/instant-node/docs/SPEC.md` — reference the unified store location if the record
  shape is affected (data-node records are unchanged from BEHAVIOR-006).
- **No published-package change**; CLI-077 holds. No published on-disk contract exists to break.

### Alternatives Considered

1. **Manifest-always (`.node.json`) as the metadata SSOT; behavior `.js` supplementary for code nodes;
   one store over `.dag/` (chosen — owner model).** Pro: one uniform metadata record per node
   (list/validate without importing code); code behavior stays authored code; workflows join the same
   store; direct cut-over (no legacy). Con: largest blast radius (all persistence call sites) —
   mitigated by size-phasing (below), not compat-phasing.
2. **Self-describing single file per code node (no manifest; `.dag.node.js` carries its own metadata).**
   Pro: no manifest for code. Con: metadata only available by importing arbitrary code (can't list/
   validate without executing an import); non-uniform record model. Rejected by the owner ("메타정보는
   .json이 가진다").
3. **Shared helpers only — centralize `.dag/` paths + scan boilerplate, leave three formats.** Pro:
   minimal. Con: does not deliver one abstraction; code nodes stay orphaned. Rejected.

### Decision

Alternative 1 (owner model). One `PersistenceStore` over `.dag/`. Every node has a `.node.json`
manifest (metadata SSOT, discriminated by `kind`); a `code` node additionally has a supplementary
`.dag.node.js` holding only `execute()`. Data nodes (`prompt`/`composite`) are the manifest alone.
Workflows in `.dag/workflows/`. All call sites cut over directly. **No back-compat, migration, or
deprecation shim** (feature unreleased — no legacy); the `.instant-node.json` extension is renamed to
the universal `.node.json`.

**Size-phasing (implementation order only — each phase is the clean end-state for its slice, no
shims):** (1) store + `.node.json` manifest for data nodes (prompt/composite) + workflows routed
through it; (2) `kind:'code'` manifest + supplementary `.dag.node.js`, code-node discovery moved into
`.dag/nodes/`, scatter-scan removed; (3) remaining command call sites (validate/node/studio) cut over.
Every phase lands independently green.

**Validation (wide blast radius — persistence + registry + run path):**

- **Reachability** — every kind resolves into the same `IDagNodeDefinition[]` consumed by
  `getAllDefinitions()` / `LocalDagRunner` (traced: `context.ts` merge, `runs.ts` registry); workflows
  resolve to `IDagDefinition`. A `code` manifest's metadata + its `.js` behavior combine via
  `adaptSimpleNode`. Verified against load→register→run.
- **Capability preservation** — prompt/composite reload (BEHAVIOR-006) unchanged; code-node `execute`
  adaptation preserved via the same `adaptSimpleNode`; `--node-file` explicit load preserved. The only
  dropped capability is scatter-scanning code files from arbitrary project locations — a deliberate
  removal (no legacy), replaced by the uniform `.dag/nodes/` location + `--node-file`.
- **Adversarial pass** — (a) a `code` manifest whose supplementary `.dag.node.js` is missing/fails to
  import → node skipped with a log, not a crash; (b) manifest `nodeType` ≠ the `.js` export's nodeType
  → manifest wins (metadata SSOT), logged; (c) a `.dag.node.ts` companion (needs tsx) → skipped with a
  clear message as today; (d) empty/missing `.dag/nodes/` → no-op.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — BEHAVIOR-006 instant-node persist/reload is the sibling; `.node.json` generalizes its record; workflows + code manifests join the same store
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료 (no legacy/migration; manifest-always metadata SSOT; size-phased only)

## Solution

1. `PersistenceStore` in `local-runner/persistence/` — `saveNode(def)` (writes `<nodeType>.node.json`;
   for a code node also writes/points to `<nodeType>.dag.node.js`), `loadNodes(liveDefs)` (scan
   `.dag/nodes/*.node.json`; per manifest `kind`: prompt/composite → `reconstructInstantNode`; code →
   `import()` the `codeFile` + `adaptSimpleNode` using the manifest's metadata), `saveWorkflow` /
   `loadWorkflows`; all `.dag/` path + readdir-skip boilerplate centralized.
2. Generalize the record to `.node.json` and add `IPersistedCodeNode { kind:'code', nodeType,
displayName, category?, inputs, outputs, defaultInputPort?, defaultOutputPort?, codeFile }`.
3. `mcp/context.ts` + instant-node handlers + `save`/`catalog` commands call the store; code-node
   discovery = `.dag/nodes/` manifests via the store; remove the whole-project scatter scan; keep
   `--node-file`.

## Affected Files

- `packages/dag-cli/src/local-runner/persistence/*` (new), `local-node-loader.ts`, `node-registry.ts`
- `packages/dag-cli/src/mcp/handlers/instant-nodes.ts`, `mcp/context.ts`
- `packages/dag-nodes/instant-node/src/index.ts` (+ `docs/SPEC.md`) — `.node.json` rename note + `IPersistedCodeNode`
- `packages/dag-cli/src/commands/{save,catalog,run,validate,node}.ts`, `studio/http-server.ts`
- Tests: `packages/dag-cli/src/__tests__/*` (store round-trip: data node, code node manifest+companion, workflow)

## Completion Criteria

- [ ] TC-01: `PersistenceStore.loadNodes` over `.dag/nodes/` containing a `kind:'code'` `.node.json`
      manifest + its supplementary `.dag.node.js` reconstructs a runnable `IDagNodeDefinition` (manifest
      metadata + imported `execute` via `adaptSimpleNode`).
- [ ] TC-02: prompt + composite `.node.json` round-trip through the store unchanged (BEHAVIOR-006 record
      logic, `.node.json` extension).
- [ ] TC-03: a workflow round-trips through the store (`saveWorkflow` → `loadWorkflows` → identical `IDagDefinition`).
- [ ] TC-04: a `code` manifest whose `.dag.node.js` is missing/unimportable is skipped with a log (no
      crash); a manifest-vs-export `nodeType` mismatch resolves to the manifest (logged).
- [ ] TC-05: end-to-end — a code node (manifest + `.dag.node.js`) in `.dag/nodes/`, loaded via the store
      into a fresh registry, runs through `LocalDagRunner` (real fs, no mocks).

## Test Plan

DATA + async → save→reload round-trip integration tests (fs-mocked units + a real round-trip), plus
unit tests for the store path/scan helpers and the record discrimination.

| TC-ID | Test Type          | Tool / Approach                                                              | Notes |
| ----- | ------------------ | ---------------------------------------------------------------------------- | ----- |
| TC-01 | Unit/Integration   | vitest — store code-node save+load, fs-mocked + adapt assertion              |       |
| TC-02 | Unit (regression)  | vitest — prompt/composite via store (BEHAVIOR-006 parity)                    |       |
| TC-03 | Unit               | vitest — workflow save/load identity through the store                       |       |
| TC-04 | Unit               | vitest — missing companion skipped; standalone scanner still loads (Phase 1) |       |
| TC-05 | Integration (real) | vitest — real fs + `LocalDagRunner`, code node reload→run                    |       |

## Tasks

- [ ] `.agents/tasks/DATA-002.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- **GATE-WRITE — PASS (2026-07-05).** All sections present; TC-01…TC-05 command/observable; checklist all [x]; test-plan row per TC.
- **GATE-APPROVAL — PASS (2026-07-05).** Design iterated with owner: no legacy/migration (feature unreleased); manifest-always `.node.json` as metadata SSOT; code behavior is a supplementary `.dag.node.js` (runtime-`import()`able, `.ts` needs a transform → excluded, types via `.d.ts`/JSDoc). Owner sign-offs, verbatim: model — "나 선택"; metadata-in-json — "메타정보는 .json 이 가지고 있는거지"; code format — ".js" ("좋아"); final — **"좋아"**. Implementation authorized (size-phased).
