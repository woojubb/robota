---
status: in-progress
type: INFRA
tags: [provider, dag-nodes, dag-framework, dip]
parent: ARCH-PROVIDER-001
---

# ARCH-PROVIDER-004: Stage C — Node-registry injection + `dag-nodes-default` composition leaf

Parent design: [ARCH-PROVIDER-001](../todo/ARCH-PROVIDER-001-provider-dip-architecture.md) (ENDORSED).
Predecessors: Stage A ([ARCH-PROVIDER-002](../done/ARCH-PROVIDER-002-stage-a-provider-split.md), done) split
the provider monolith; Stage B ([ARCH-PROVIDER-003](../done/ARCH-PROVIDER-003-stage-b-llm-node-dip.md), done)
collapsed the LLM nodes and added `createDagFramework({ providers })` with a lazily-loaded default provider set.

## Problem

`dag-framework` is meant to be an infrastructure/composition layer, but it **statically depends on 15 concrete node
packages** (`@robota-sdk/dag-node-{input,multi-input,transform,text-template,text-output,image-loader,
image-source,ok-emitter,tool,utility-text,llm-text,...}` in `packages/dag-framework/package.json`
`dependencies` + `optionalDependencies`), because `packages/dag-framework/src/default-node-registry.ts`
statically imports and composes them into `createDefaultNodeRegistrySync()` / `createDefaultNodeRegistry()`.

Consequences:

1. **The framework carries a HARD dependency on the entire default node catalog** (and, transitively, node
   SDKs) — the opposite of the injectable, composition-root-owned design the parent targets. Every consumer of
   `dag-framework` drags in all node packages **as a direct production edge** even when it injects its own
   `options.nodes`. (Stage C removes the _hard/direct_ edge; the default catalog becomes optional + transitive +
   injectable — not "never installed", since pnpm installs optionalDependencies by default — which is the
   correct and sufficient decoupling.)
2. **`options.nodes` is already an injection seam** (`create-dag-framework.ts` `options.nodes ?? (await
createDefaultNodeRegistry(options.providers))`), but the DEFAULT branch hard-wires the catalog into the
   framework, so the seam does not actually decouple the framework from node packages.
3. The node catalog composition (which nodes are "default", the lazy optional-SDK loaders, the Stage-B lazy
   provider-defaults wiring) is **infrastructure-level policy living in the wrong layer** — it belongs to a
   composition leaf, not the framework core.

The parent's Stage C closes this: extract the default-node composition into a **`dag-nodes-default`
entry-point-only leaf**; make `dag-framework` depend on **no** node package (the default catalog is loaded
lazily, exactly like Stage B's default provider set); enforce `dag-nodes-default` as entry-point-only; retire
the ARL-11 router allowlist (already emptied in Stage B). Closes ARL-12.

## Architecture Review

### Affected Scope

- **NEW** `packages/dag-nodes-default/` (`@robota-sdk/dag-nodes-default`) — owns `createDefaultNodeRegistry`
  (async; provider-injected + lazy media/skill loaders) and `createDefaultNodeRegistrySync` (the SDK-free base
  set). The 15 concrete node-package `dependencies` + the `agent-provider-defaults` optional dep move here from
  `dag-framework`. This is the composition leaf; it is imported only at composition roots (entry-point-only).
- **`packages/dag-framework`**:
  - `package.json` — remove the 14 hard `dag-node-*` deps + the 1 optional `dag-node-gemini-image-edit` (15 concrete nodes) +
    `agent-provider-defaults` optional deps (keep `@robota-sdk/dag-node` — the node _contract/assembly_ base,
    not a concrete node — and `agent-core`). **Add `@robota-sdk/dag-nodes-default` as an `optionalDependency`**
    so the lazy `import('@robota-sdk/dag-nodes-default')` resolves for published consumers (mirrors how Stage B
    kept `agent-provider-defaults` optional). Also add it as a **`devDependency`** for the framework's own tests
    (see the test repoint below). The framework carries **no direct/hard concrete-node dependency**; the default
    catalog becomes **optional + transitive + injectable** — note (correcting Problem goal #1) this removes the
    _hard_ node dependency and makes the catalog opt-out-able, not "never installed" (pnpm installs
    optionalDependencies by default).
  - `create-dag-framework.ts` — the default branch lazily `import('@robota-sdk/dag-nodes-default')` when
    `options.nodes` is absent (mirrors Stage B's `loadDefaultProviderDefinitions`; a load failure surfaces a
    typed diagnostic naming the package, never a silent empty registry).
  - `local-dag-runtime-provider.ts` — `buildNodeRegistry()` is `private` and called only from async methods
    (`listNodes`, `execute`); make it async and lazily load the default sync registry from `dag-nodes-default`
    when no `nodeRegistry` is injected (preserving the zero-static-node-dep property).
    `ILocalDagRuntimeProviderOptions.nodeRegistry` stays optional.
  - `index.ts` — STOP re-exporting `createDefaultNodeRegistry` / `createDefaultNodeRegistrySync`. Keeping a
    re-export _after_ the move would be `export { … } from '@robota-sdk/dag-nodes-default'` — which forces a
    hard `framework → dag-nodes-default` production edge, re-creating the exact coupling being removed (the
    decisive correctness reason, beyond the no-pass-through-re-export rule's spirit). Consumers import them from
    `@robota-sdk/dag-nodes-default`.
  - `default-node-registry.ts` — deleted (moved to the new package).
- **Consumers repoint** `createDefaultNodeRegistry(Sync)` imports from `@robota-sdk/dag-framework` →
  `@robota-sdk/dag-nodes-default`:
  - Production `src`: `packages/agent-command-workflows/src/create-command.ts`,
    `packages/dag-cli/src/local-runner/node-registry.ts` (both add `dag-nodes-default` as a prod dep — they are
    composition roots).
  - **`dag-framework`'s own internal tests** (previously missed): `src/__tests__/{tool-node-run,
create-dag-framework,prompt-backend,orchestration-adapter}.test.ts` import `createDefaultNodeRegistrySync`
    from `../default-node-registry.js`, and `src/__tests__/index.test.ts` imports it from the index **and
    asserts the re-export exists** — repoint these to `@robota-sdk/dag-nodes-default` (framework `devDependency`)
    and **invert the `index.test.ts` assertion** to assert the symbols are NO LONGER re-exported.
  - `packages/dag-cli/src/__tests__/node-registry.test.ts` (exercises `createCliNodeRegistryWithLocalNodes`, which
    transitively uses the moved symbol) and `packages/dag-mcp-server/src/__tests__/embedded-mode.test.ts`.
  - `createCliNodeRegistryWithLocalNodes`/`createCliNodeRegistry` is dag-cli-owned (NOT a moved symbol) — no external importer of it is affected.
    `createDagFramework` callers that rely only on the default catalog (`apps/dag-runtime-server`,
    `packages/dag-mcp-server/src/runner.ts`) keep working via the lazy default — no change unless they imported
    the registry directly.
- **Harness**: a guard enforcing `dag-nodes-default` is **entry-point-only** — it scans **static `import … from`
  / `export … from` edges** to `@robota-sdk/dag-nodes-default` and permits them ONLY from sanctioned composition
  roots (apps, `dag-cli`, `agent-command-workflows`, `dag-mcp-server` entry). It must NOT list `dag-framework`
  as a sanctioned static importer, and must NOT flag `dag-framework`'s **dynamic** `await import()` (not a static
  edge) even though the framework carries the optionalDependency. Reuse/extend an existing dependency guard
  (e.g. the `check-capability-placement` production-scope pattern) rather than a bespoke scanner.
- **Naming (rename-sensitive)**: `dag-nodes-default`'s exemption from `checkDagNodesLeaf` rides on the plural
  `@robota-sdk/dag-nodes-` prefix diverging from the singular `@robota-sdk/dag-node-` leaf prefix the scanner
  keys on — so the aggregator's 16 sibling node deps are never seen by the leaf invariant and
  `DAG_NODES_LEAF_ALLOWLIST` legitimately stays empty. This is intentional; a future rename must preserve the
  divergence or add an explicit exemption.

### Alternatives Considered

1. **Leave the catalog in `dag-framework`; only document `options.nodes`.** Rejected: the framework still
   hard-depends on 15 concrete node packages + SDKs; the decoupling the parent mandates (ARL-12) never happens.
2. **Extract `dag-nodes-default` + lazy default in the framework (chosen).** The framework carries no
   direct/hard concrete-node dependency; the default catalog is an aggregator loaded lazily (dynamic import,
   typed diagnostic on failure) or injected via `options.nodes`. Adding/removing a default node = editing one
   aggregator, not the framework.
3. **Make `options.nodes` mandatory (no default at all).** On pure dependency hygiene this is marginally
   _cleaner_ — the framework would have no edge at all (not even optional) to the catalog. Rejected NOT for
   blast-radius but for **design coherence**: Stage B (DONE) already committed the provider layer to the
   identical lazy-default pattern (dynamic import of `agent-provider-defaults`, typed diagnostic, optional dep).
   Making nodes mandatory-injection while providers stay lazy leaves two divergent patterns for the same class
   of problem — a durable design cost — and removes the legitimate zero-arg `createDagFramework()` public
   affordance (`apps/dag-runtime-server/src/server.ts`). The lazy default is not a prohibited "fallback": a
   missing catalog throws a typed error naming the package, never a silent empty registry.

### Decision

**Alternative 2.** Extract `@robota-sdk/dag-nodes-default` as the entry-point-only composition aggregator
owning the default node catalog; `dag-framework` carries no direct/hard concrete-node dependency (the aggregator
is an `optionalDependency` for the lazy `import()` + a `devDependency` for its tests), loads the default catalog
lazily (typed diagnostic on failure) or via `options.nodes` injection, and stops re-exporting the moved symbols;
repoint consumers (incl. the framework's own tests); add the static-import entry-point-only guard; confirm the
ARL-11 router allowlist stays retired. Justification anchored on Stage-B lazy-default coherence, not diff size.
Sub-sequence green per commit.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — dag-nodes-default (new), dag-framework, agent-command-workflows, dag-cli, dag-mcp-server, dag-runtime-server, harness guard
- [x] Sibling scan 완료 — `createDefaultNodeRegistry(Sync)` consumers enumerated (agent-command-workflows, dag-cli, dag-mcp-server, framework internals); `createDagFramework` callers enumerated (dag-runtime-server, dag-mcp-server)
- [x] 대안 최소 2개 검토 완료 — 3개 (doc-only / extract+lazy / mandatory-injection)
- [x] 결정 근거 문서화 완료 — framework depends on no node package; default catalog is a lazily-loaded composition leaf; matches Stage B's lazy-default precedent

## Solution (sub-sequenced, each commit green)

1. **Create `@robota-sdk/dag-nodes-default`** — move `default-node-registry.ts` (both functions + the optional
   loaders + the Stage-B lazy provider-defaults wiring) into the new package; it takes the 15 concrete node deps +
   `agent-provider-defaults` + `dag-core`/`dag-node`/`agent-core`. Port its tests.
2. **Repoint `dag-framework`** — `create-dag-framework.ts` lazily loads `dag-nodes-default` for the default
   branch (typed diagnostic on failure); `local-dag-runtime-provider.ts` `buildNodeRegistry()` → async + lazy
   default; drop the 15 concrete node deps + `agent-provider-defaults` from `package.json`; stop re-exporting the two
   functions from `index.ts`; delete `default-node-registry.ts`.
3. **Repoint consumers** — `agent-command-workflows`, `dag-cli` local-runner, `dag-mcp-server` tests import the
   registry from `@robota-sdk/dag-nodes-default`; add that dep where used.
4. **Entry-point-only guard** — add/extend a dependency guard so only composition roots may import
   `dag-nodes-default`; confirm `check-dependency-direction`'s `DAG_NODES_LEAF_ALLOWLIST` remains empty
   (ARL-11 retired) and add the new package to any node-family invariants correctly (it is a composition
   aggregator, explicitly sanctioned — analogous to the former router but ABOVE the leaf layer).

## Affected Files

- `packages/dag-nodes-default/**` (new: package.json, tsconfig(s), tsdown, `src/index.ts` moved from framework's `default-node-registry.ts`, tests, docs/SPEC.md)
- `packages/dag-framework/src/{create-dag-framework.ts,local-dag-runtime-provider.ts,index.ts,types.ts}`; delete `default-node-registry.ts`; `packages/dag-framework/package.json` (drop 15 concrete node deps + agent-provider-defaults; add dag-nodes-default as optional + dev)
- `packages/dag-framework/src/__tests__/{tool-node-run,create-dag-framework,prompt-backend,orchestration-adapter,index}.test.ts` (repoint registry import to dag-nodes-default; invert the `index.test.ts` re-export assertion); move `default-node-registry.test.ts` into the new package
- `packages/agent-command-workflows/src/create-command.ts` (+ package.json prod dep)
- `packages/dag-cli/src/local-runner/node-registry.ts` + `packages/dag-cli/src/__tests__/node-registry.test.ts` (+ package.json prod dep)
- `packages/dag-mcp-server/src/__tests__/embedded-mode.test.ts` (+ package.json dev dep if needed)
- Harness guard (static-import entry-point-only) + `scripts/harness/__tests__/`
- changeset

## Completion Criteria

- [ ] TC-01: `@robota-sdk/dag-nodes-default` exports `createDefaultNodeRegistry` + `createDefaultNodeRegistrySync`
      with identical behavior to the former framework functions (ported tests green, incl. the llm-text +
      optional-loader + partial-install TC-10 diagnostic).
- [ ] TC-02: `dag-framework/package.json` has **no** `@robota-sdk/dag-node-*` concrete-node dependency (only
      `@robota-sdk/dag-node` the contract base) and **no** `agent-provider-defaults`; asserted by inspection +
      `check-dependency-direction` green.
- [ ] TC-03: `createDagFramework()` with no `options.nodes` still yields the full default catalog (lazy load);
      with `options.nodes` injected, `dag-nodes-default` is never loaded; a load failure surfaces a typed
      diagnostic naming `@robota-sdk/dag-nodes-default` (no silent empty registry).
- [ ] TC-04: `LocalDagRuntimeProvider` with no injected `nodeRegistry` still lists/executes the default
      catalog (async lazy default); an injected `nodeRegistry` is used verbatim.
- [ ] TC-05: consumers (`agent-command-workflows`, `dag-cli`, `dag-mcp-server`) import the registry from
      `dag-nodes-default`; `dag-framework` no longer re-exports it (no pass-through re-export).
- [ ] TC-06: entry-point-only guard fails when a non-composition-root library `src` imports
      `dag-nodes-default`; passes for the sanctioned composition roots; `DAG_NODES_LEAF_ALLOWLIST` stays empty.
- [ ] TC-07: full `pnpm harness:scan` 48/48 (+ any new guard) + `pnpm harness:test` + full-repo `pnpm
typecheck` 0; changeset present. Affected package suites green (dag-cli, dag-framework, agent-command-workflows,
      dag-mcp-server, dag-runtime-server).

## Test Plan

Move the existing `default-node-registry.test.ts` into `dag-nodes-default` (TC-01, incl. the TC-10 partial-SDK
diagnostic). Framework-level tests: default-catalog lazy load + injected-nodes-skip-default + typed-diagnostic
(TC-03); `LocalDagRuntimeProvider` default vs injected (TC-04). Guard unit test for entry-point-only (TC-06).
Full `harness:scan` + `harness:test` + typecheck + changeset (TC-07). No `src` behavior change beyond the
package move + lazy-default plumbing; RED→GREEN per sub-sequence step.

## Resolved Questions (GATE-APPROVAL round 1)

1. **Entry-point-only enforcement mechanism** — RESOLVED: a **static-import** guard (extend the
   `check-capability-placement` production-scope pattern) that permits `@robota-sdk/dag-nodes-default` static
   `import/export … from` edges only from sanctioned composition roots (apps, `dag-cli`,
   `agent-command-workflows`, `dag-mcp-server` entry), does NOT sanction `dag-framework` as a static importer,
   and does NOT flag `dag-framework`'s dynamic `await import()`.
2. **`dag-node` base dep** — RESOLVED TRUE: `dag-framework` legitimately keeps `@robota-sdk/dag-node`
   (`buildNodeDefinitionAssembly`/`StaticNode*` in `create-dag-framework.ts` + `local-dag-runtime-provider.ts`);
   it is the contract/assembly base, not a concrete node.
3. **`local-dag-runtime-provider` async `buildNodeRegistry`** — RESOLVED SAFE: `buildNodeRegistry()` is
   `private`; its only callers are async `listNodes()`/`execute()`. No sync consumer of the now-async path.
4. **`dag-nodes-default` leaf-scan classification** — RESOLVED: the aggregator is NOT matched by
   `checkDagNodesLeaf` (keys on the singular `@robota-sdk/dag-node-` prefix; the plural `dag-nodes-` diverges),
   so its 16 sibling deps need no allowlist entry and `DAG_NODES_LEAF_ALLOWLIST` stays empty. Rename-sensitive
   (noted in Affected Scope).

## Tasks

- [ ] Step 1 — create `@robota-sdk/dag-nodes-default`; move `default-node-registry.ts` (both fns + optional loaders + lazy provider-defaults) + its test into it; take the 15 node deps + agent-provider-defaults.
- [ ] Step 2 — repoint `dag-framework`: lazy `import()` default in create-dag-framework.ts; async lazy `buildNodeRegistry` in local-dag-runtime-provider.ts; drop node deps, add dag-nodes-default (optional+dev); stop index re-export; delete default-node-registry.ts; repoint + invert the 5 framework tests.
- [ ] Step 3 — repoint prod consumers (agent-command-workflows, dag-cli local-runner) + dag-cli/dag-mcp-server tests to dag-nodes-default.
- [ ] Step 4 — add the static-import entry-point-only guard (+ test); verify DAG_NODES_LEAF_ALLOWLIST stays empty.
- [ ] Step 5 — full harness:scan + harness:test + typecheck + changeset; GATE-VERIFY/COMPLETE.

## Evidence Log

- 2026-07-10 GATE-DRAFT — authored from ARCH-PROVIDER-001 Stage C. Premises verified against code:
  `dag-framework/package.json` lists 15 concrete `dag-node-*` deps; `default-node-registry.ts` statically composes them;
  `create-dag-framework.ts` default branch calls the local `createDefaultNodeRegistry`;
  `local-dag-runtime-provider.ts:169` uses `createDefaultNodeRegistrySync()` as a sync default (called only
  from async `listNodes`/`execute`); consumers of the registry = agent-command-workflows, dag-cli local-runner,
  dag-mcp-server tests; `DAG_NODES_LEAF_ALLOWLIST` already emptied in Stage B. Pending proposal-reviewer ENDORSE.
- 2026-07-10 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction/Alt-2 endorsed; 4 corrections
  folded in, all premises P1–P8 verified TRUE against code). (1) Declare `dag-nodes-default` as a
  `dag-framework` **optionalDependency** (lazy `import()` must resolve) + a **devDependency** for framework
  tests; restated Problem goal #1 (removes the _hard_ node edge; catalog is optional+transitive+injectable, not
  "never installed"). (2) Guard scans **static** import/export edges only, sanctions composition roots, exempts
  the framework's dynamic `await import()` and does NOT sanction `dag-framework` as a static importer. (3)
  Completed the consumer enumeration — the framework's OWN tests (`tool-node-run`/`create-dag-framework`/
  `prompt-backend`/`orchestration-adapter`/`index`) import the moved symbol / assert the re-export, plus
  `dag-cli/__tests__/node-registry.test.ts`; repoint to dag-nodes-default (framework devDep) and invert the
  `index.test.ts` re-export assertion. (4) Documented the plural `dag-nodes-`/singular `dag-node-` prefix
  divergence that keeps the aggregator out of the leaf scan (rename-sensitive). Re-anchored the Alt-3 rejection
  on Stage-B lazy-default coherence (not blast-radius). No cycle (`framework → dag-nodes-default` one-way).
  Revised → re-review.
- 2026-07-10 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. All four round-1 revisions verified correct
  - complete against code (optional+dev dep declared; static-only guard sanctioning composition roots and
    exempting the framework's dynamic import; framework-own-test + dag-cli-test enumeration incl. inverting the
    `index.test.ts` re-export assertion; plural/singular prefix divergence). `check-capability-placement` is
    production-scoped (a devDependency edge won't trip it); no cycle. Non-blocking copy-edits folded in (14 hard +
    1 optional = 15 concrete nodes; `createCliNodeRegistryWithLocalNodes`). Design APPROVED → implement. Spec → active.
