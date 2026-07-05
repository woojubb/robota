---
status: verifying
type: BEHAVIOR
tags: [async, typescript]
---

# BEHAVIOR-006: composite instant nodes survive save → reload (WORKFLOW-005 P2)

## Problem

Composite instant nodes (created via `handleDagInstantNodeCreateComposite`, which wrap an inner
DAG) are **silently dropped on reload**: after an MCP-server restart, a persisted composite node is
not re-registered, so any `.dag.json` workflow referencing that composite `nodeType` fails at run
time with an unknown-node-type error. Prompt-backed instant nodes reload fine; only composites are
lost.

Reproduction: create a composite instant node → it persists to
`<projectDir>/.dag/nodes/<nodeType>.instant-node.json` with `taskCode: null` → restart (re-run
`loadPersistedInstantNodes`) → the node is absent from `ctx.instantNodeDefinitions` /
`getAllDefinitions()` / the run registry.

Root cause is a **save-side omission plus a load-side guard** (DAG subsystem stays private — no
publish):

1. **Save drops composite data.** `saveInstantNodeToDisk`
   (`packages/dag-cli/src/mcp/handlers/instant-nodes.ts:19-37`) writes a record with
   `taskCode: null` for composites but **never persists `innerDag`, `exposedInputPort`, or
   `exposedOutputPorts`** — the only data needed to rebuild a composite. The composite save call
   (`instant-nodes.ts:223`) passes `null` and nothing else.
2. **Load requires `taskCode: string` and only builds prompt nodes.** The startup loader
   `loadPersistedInstantNodes` (`packages/dag-cli/src/mcp/context.ts:45-90`) does
   `if (typeof record['taskCode'] !== 'string') continue;` (`context.ts:59-60`) and then only calls
   `createPromptBackedNodeDefinition` (`context.ts:83`). A near-duplicate exported loader
   `loadSavedInstantNodes` (`instant-nodes.ts:279-336`) has the same guard (`304-311`) + prompt-only
   reconstruction (`329`) and is currently **unused** (only `context.ts`'s copy runs).

So even removing the load guard would not help — the composite's `innerDag` is not on disk.
`createCompositeInstantNodeDefinition` (`packages/dag-nodes/instant-node/src/index.ts:373`) needs
`{ innerDag, exposedInputPort, exposedOutputPorts, runner }`; the `runner`
(`ICompositeSubRunner`) is behavioral and must be **reconstructed** at load, not serialized.

## Architecture Review

### Affected Scope

- `packages/dag-nodes/instant-node/src/index.ts` — expose a public readonly **persistence view** on
  `PromptBackedNodeDefinition` and `CompositeInstantNodeDefinition` (the discriminated serializable
  data each node owns). This is a public-surface addition to `@robota-sdk/dag-node-instant-node`
  (private package) → update its `docs/SPEC.md`. (Per Finding A/B.)
- `packages/dag-cli/src/mcp/handlers/instant-nodes.ts` — `saveInstantNodeToDisk` reads the persistence
  view off `nodeDef` (drop the `taskCode` param); the exported loader `loadSavedInstantNodes` (branch
  on `kind`, rebuild composites); the runner factory (~181-209) extracted into a shared helper that
  closes over the **live** `instantNodeDefinitions` array, reused at create-time and load-time.
- `packages/dag-cli/src/mcp/context.ts` — `loadPersistedInstantNodes` guard + reconstruction; ideally
  **delegate to** the exported `loadSavedInstantNodes` so composite-aware logic lives in one place.
- `packages/dag-cli` — a typed `IPersistedInstantNodeRecord` (discriminated union `kind:'prompt' |
'composite'`) for the on-disk record (currently an untyped object literal read as
  `Record<string, unknown>`).
- Tests: `packages/dag-cli/src/__tests__/mcp-handlers.test.ts` (save→reload round-trip, incl.
  composite) — mocks `node:fs/promises`, the established pattern.
- **No published-package change** — this is entirely inside the private `dag-cli` DAG surface; CLI-077
  invariant holds (agent-cli published closure unchanged).

### Alternatives Considered

1. **Persist composite fields + discriminated `kind`, unify the two loaders (chosen).** Save writes
   `kind` and, for composites, `innerDag`/exposed ports; load branches on `kind`, rebuilds the runner
   via a shared factory, and calls `createCompositeInstantNodeDefinition`. `context.ts` delegates to
   the exported loader. Pro: fixes the real save-side data loss; one deserializer; old prompt records
   still load (back-compat below). Con: touches save + load + a small refactor.
2. **Load-side only (drop the `taskCode` guard).** Pro: tiny. Con: **does not work** — `innerDag` is
   never persisted, so there is nothing to rebuild from. Rejected (would still drop composites).
3. **Serialize the whole `CompositeInstantNodeDefinition` (incl. runner).** Pro: no reconstruction.
   Con: the `runner`/`ICompositeSubRunner` is a live object (holds a `LocalDagRunner` over the node
   registry) — not serializable; would leak/So stale registries. Rejected.

### Decision

Alternative 1, **revised by the architecture review (below)**: instead of passing composite data at
the single create call site, **each instant-node definition class exposes its own serializable
persistence view**, so `saveInstantNodeToDisk(nodeDef)` extracts everything from the `nodeDef` at
_every_ call site (drop the `taskCode` parameter). Add a discriminated persisted record
(`kind: 'prompt' | 'composite'`); on load branch on `kind` and rebuild composites with a runner that
closes over the **live** `instantNodeDefinitions` array (shared factory reused by create-time and
load-time), calling `createCompositeInstantNodeDefinition`. Collapse the duplicate loaders so
`context.ts` delegates to the single exported `loadSavedInstantNodes`.

### Architecture Review — findings (validated against code, 2026-07-05)

- **Finding A — `saveInstantNodeToDisk`'s `taskCode` parameter is the wrong seam.** The composite
  `spec` (`innerDag`/exposed ports) lives in `CompositeInstantNodeDefinition`'s **private** `spec`
  (`instant-node/src/index.ts:277`); likewise `PromptBackedNodeDefinition.spec` is private (`:142`).
  There are **two** save call sites: create-composite (`instant-nodes.ts:223`) has the spec in scope,
  but the generic `handleInstantNodeSave` (`:263`) only has the looked-up `nodeDef` and no spec.
  Passing spec "at the call site" (original plan) fixes only the create path. **Revised:** expose a
  public readonly persistence view on both classes (prompt → `{kind:'prompt', systemPromptTemplate,
provider?, model?, ports}`; composite → `{kind:'composite', innerDag, exposedInputPort,
exposedOutputPorts, maxDepth?}`) and have `saveInstantNodeToDisk` read it from `nodeDef`.
- **Finding B — the same bug silently corrupts prompt nodes via `handleInstantNodeSave`.** That
  handler calls `saveInstantNodeToDisk(nodeDef, null, ctx)` (`:263`) — `taskCode: null` — so a
  **prompt** node re-saved through it is written with `taskCode:null` and then dropped on reload too.
  The class-owned persistence view (Finding A) fixes prompt + composite at all call sites in one move,
  and is why the revised design is strictly better than the call-site patch.
- **Finding C — nested/ordering concern REFUTED.** The create-time runner captures
  `ctx.instantNodeDefinitions` **by reference** (`:180`), so it sees nodes appended later; nested
  composites resolve at run time regardless of insertion order. The reconstructed runner must
  likewise close over the **live array reference** (not a snapshot) — then reload order does not
  matter. Recorded as a mandatory design constraint, not a risk.
- **Finding D — persist `maxDepth`.** `ICreateCompositeNodeInput.maxDepth?` (`:260`) drives the
  `MAX_COMPOSITE_DEPTH` nesting guard; include it in the composite persistence view when set.
- **Finding E — `innerDag` is serializable.** It arrives as JSON MCP args (`args['innerDag']`,
  `instant-nodes.ts:159`) and is plain `IDagDefinition` data — round-trips cleanly.

**Backward compatibility:** existing on-disk records have no `kind`. Treat a record with
`taskCode: string` as `kind:'prompt'`; a record with `taskCode:null` + an `innerDag` as
`kind:'composite'`; a record with `taskCode:null` and NO `innerDag` (old pre-fix composite files) is
still unrecoverable — log once and skip (documented, not silent).

**Validation (private DAG surface; blast radius = MCP node reload/registry):**

- **Reachability** — reloaded composites enter the same `instantNodeDefinitions` array consumed by
  `getAllDefinitions()`, `getManifests()`, and the `LocalDagRunner` registry in `runs.ts`; rebuilding
  them there makes referencing workflows runnable again (traced load → register → run).
- **Capability preservation** — prompt-node reload is unchanged (same `createPromptBackedNodeDefinition`
  path); the fix is additive for composites. The `runner` capability is preserved by reconstruction,
  not serialization.
- **Adversarial pass** — (a) old prompt files (no `kind`) → treated as prompt, still load; (b) old
  pre-fix composite files (no `innerDag`) → skip with a one-time log, not a crash; (c) malformed JSON /
  missing fields → skip that record, continue loading others (existing resilience preserved); (d) the
  reconstructed runner must close over the FULL node set (CLI registry + already-loaded instant nodes)
  — load order matters if composites reference other instant nodes; the shared factory takes the
  current definition set.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the prompt-backed persist/reload path is the sibling; composite mirrors it with an added `kind` + inner-DAG fields; the duplicate `loadSavedInstantNodes`/`loadPersistedInstantNodes` are unified
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. Add `IPersistedInstantNodeRecord` — discriminated union `{ kind:'prompt', systemPromptTemplate,
provider?, model?, … } | { kind:'composite', innerDag, exposedInputPort, exposedOutputPorts,
maxDepth?, … }` (shared: nodeType, displayName, category, inputs, outputs, createdAt).
2. **Expose a public readonly persistence view** on `PromptBackedNodeDefinition` and
   `CompositeInstantNodeDefinition` returning that node's `IPersistedInstantNodeRecord` data (never the
   `runner`). Update `dag-node-instant-node/docs/SPEC.md`.
3. `saveInstantNodeToDisk(nodeDef)`: read `nodeDef`'s persistence view and write it (drop the
   `taskCode` param). This corrects **both** save call sites (create + `handleInstantNodeSave`) for
   prompt AND composite nodes (Findings A/B).
4. Extract the runner factory (instant-nodes.ts ~181-209) into a shared helper
   `buildCompositeRunner(liveDefs)` that closes over the **live** `instantNodeDefinitions` array
   reference (Finding C); reuse at create-time and load-time.
5. Rewrite the loader to branch on `kind` (with back-compat inference for `kind`-less records): prompt
   → `createPromptBackedNodeDefinition`; composite → `createCompositeInstantNodeDefinition` with a
   rebuilt runner. Make `context.ts`'s `loadPersistedInstantNodes` delegate to the single exported
   `loadSavedInstantNodes`.

## Affected Files

- `packages/dag-nodes/instant-node/src/index.ts` (+ `docs/SPEC.md`) — persistence view on both classes
- `packages/dag-cli/src/mcp/handlers/instant-nodes.ts` — save reads the view; loader `kind`-branch; runner factory
- `packages/dag-cli/src/mcp/context.ts` — delegate reload to the exported loader
- `packages/dag-cli/src/__tests__/mcp-handlers.test.ts` + `packages/dag-nodes/instant-node/src/__tests__/index.test.ts` (round-trip + persistence-view tests)
- (new type) `IPersistedInstantNodeRecord` — colocated in `instant-node` (owns the shape) or a small shared types module

## Completion Criteria

- [x] TC-01: Saving a composite instant node writes a JSON record whose `kind === 'composite'` and
      that contains `innerDag`, `exposedInputPort`, and `exposedOutputPorts` (assert the written file
      contents; `node:fs/promises` mocked).
- [x] TC-02: `loadSavedInstantNodes` over a persisted composite record returns a definition with the
      saved `nodeType` (a reconstructed `CompositeInstantNodeDefinition`), i.e. the composite is NOT
      dropped.
- [x] TC-03: End-to-end round-trip — create composite → reload via the loader → the composite
      `nodeType` is present in `getAllDefinitions()`/manifests and a 1-node workflow referencing it
      runs through `LocalDagRunner` without an unknown-node-type error.
- [x] TC-04: Back-compat — an existing prompt record (`taskCode` string, no `kind`) still loads as a
      prompt-backed node (regression); a `taskCode:null` record with no `innerDag` is skipped with a
      log, not a crash.
- [x] TC-05: `context.ts` reload path delegates to the single exported loader (no duplicate
      deserializer): a composite persisted on disk is present in `ctx.instantNodeDefinitions` after
      `createMcpServerContext`.

## Test Plan

BEHAVIOR + async → save→reload round-trip integration test (fs-mocked) + unit tests for the record
(de)serialization and the loader branch.

| TC-ID | Test Type                | Tool / Approach                                                                             | Notes |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------- | ----- |
| TC-01 | Unit (serialize)         | vitest — mock `node:fs/promises`, assert written composite record shape                     |       |
| TC-02 | Unit (loader)            | vitest — feed a composite record to `loadSavedInstantNodes`, assert a def is returned       |       |
| TC-03 | Integration (round-trip) | vitest — create→save→load→run a 1-node composite workflow via `LocalDagRunner`              |       |
| TC-04 | Unit (back-compat)       | vitest — prompt record (no `kind`) loads as prompt; `taskCode:null`+no-`innerDag` skipped   |       |
| TC-05 | Integration (context)    | vitest — `createMcpServerContext` reload surfaces the composite in `instantNodeDefinitions` |       |

## Tasks

- [ ] `.agents/tasks/BEHAVIOR-006.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- **GATE-WRITE — PASS (2026-07-05).** All sections present; TC-01…TC-05 command/observable; checklist all [x]; test-plan row per TC; no manual rows.
- **GATE-APPROVAL — PASS (2026-07-05).** Architecture review performed against code and recorded (Findings A–E; original call-site plan revised to class-owned persistence views; nested/ordering concern refuted; scope expanded to `dag-node-instant-node`). User sign-off, verbatim: **"승인함"**. Implementation authorized.

- **GATE-VERIFY — PASS (2026-07-05).**
  - Unit — instant-node `toPersisted()` for prompt + composite (composite record excludes `runner`):
    instant-node **15 tests** green.
  - Unit/integration (fs-mocked) — TC-01 composite record shape on save; TC-02 loader reconstructs the
    composite (not dropped); TC-03 create→save→reload round-trip; TC-04 back-compat (legacy prompt
    reloads, `taskCode:null`+no-`innerDag` skipped): in `mcp-handlers.test.ts`.
  - TC-05 (context delegation) — `context.ts` now calls the single `loadSavedInstantNodes`; covered by
    the existing `mcp-context`/`mcp-command` suites staying green plus the real round-trip below.
  - **Live UE (fully real — no mocks, no credentials)** — `composite-reload-real.test.ts`: a composite
    is created + persisted to a real temp `.dag/nodes/*.instant-node.json`, reloaded into a fresh
    registry, and **runs its inner DAG** through the real `LocalDagRunner`, yielding
    `result === 'from-inner-dag'`. Before the fix the composite was dropped on reload (unknown-node-type).
  - dag-cli **997 tests** green; typecheck clean; 0 lint errors; test-module-mocks + capability-placement
    scans pass; CLI-077 holds (agent-cli published closure unchanged).
