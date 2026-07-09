---
status: in-progress
type: INFRA
tags: [provider, dag-nodes, dip, dag-framework]
parent: ARCH-PROVIDER-001
---

# ARCH-PROVIDER-003: Stage B — LLM-node DIP collapse + provider-registry injection

Parent design: [ARCH-PROVIDER-001](../todo/ARCH-PROVIDER-001-provider-dip-architecture.md) (ENDORSED).
Predecessor: [ARCH-PROVIDER-002](../done/ARCH-PROVIDER-002-stage-a-provider-split.md) (Stage A, DONE) —
the provider monolith is already split into per-vendor leaf packages + `agent-provider-defaults`
(`createDefaultProviderDefinitions()`).

## Problem

The `/workflows` LLM-text path is the last place the provider DIP is NOT realized. Today, at
`packages/dag-nodes/`:

1. **Five near-identical vendor node packages** — `dag-node-llm-text-{anthropic,openai,gemini,deepseek,qwen}`
   — each hardcodes its provider, its `apiKeyEnvName`, and reads `process.env[...]` directly at execution
   time (`llm-text-openai/src/index.ts:123`), and each carries its own `defaultModel`/`allowedModels`/cost
   glue (`:16-19`, `:104`, `:116-119`). This is the exact duplication ARL-10 (node-half) and ARL-11-llm flagged.
2. **A router package** (`dag-node-llm-text-router`) that statically imports all five, hardcodes a
   `TRouterProviderType` union + a `PROVIDER_ENV_KEY_MAP`, and reads `process.env` to detect key presence
   (`llm-text-router/src/index.ts:20-58`). Adding a provider means editing the union, the map, the schema
   enum, and the import list — the inversion-of-control the parent design removes.
3. **No provider injection seam in the framework.** `createDagFramework` threads `options.nodes`
   (`create-dag-framework.ts:86`) but has **no** `options.providers` (`types.ts:62-75`); the node registry
   statically composes the five vendor nodes via lazy `modulePath` entries (`default-node-registry.ts:79-101`).
   Provider identity is baked into the node graph, not injected.
4. **The identifier `llm-text` is currently tombstoned.** `dag-core/services/definition-validator.ts:59-72`
   hard-rejects `nodeType 'llm-text'` (`DAG_VALIDATION_NODE_TYPE_REMOVED`, "Use llm-text-openai instead") —
   history shows `llm-text` was a previously-collapsed node that was **split** into per-vendor nodes. The
   re-collapse is now justified precisely because DIP removes the provider-in-node coupling that motivated
   the split; the tombstone must be inverted as part of this stage.

The parent's Stage B closes this: **one** `dag-node-llm-text` node consuming `IAIProvider` through the
`IProviderDefinition[]` registry, made functional in the same stage by landing the
`createDagFramework({ providers })` injection seam — so the collapsed node works the moment the vendor
packages are deleted (no mid-migration `/workflows` regression).

## Architecture Review

### Affected Scope

**New / changed:**

- **NEW** `packages/dag-nodes/llm-text/` (`@robota-sdk/dag-node-llm-text`) — one node, provider-registry-driven;
  depends on **`agent-core` only** (see credential-resolution seam below), not on any provider leaf.
- **`packages/agent-core`** (SSOT):
  - Additive `IProviderDefinition.allowedModels?: readonly string[]` (a distinct model-permission allowlist;
    the model catalog is frequently `status:'unavailable'` with no entries, e.g. OpenAI
    `agent-provider-openai/src/openai/provider-definition.ts:34-38`, so the catalog cannot serve as the
    allowlist). Its relationship to
    `modelCatalog.entries[].id` is documented: the catalog is the _descriptive_ model inventory; `allowedModels`
    is the _enforced_ execution allowlist (a subset/override), not a second drifting inventory.
  - Cost: **do NOT** add a top-level `defaultModel` (the existing `IProviderProfileDefaults.model` at
    `provider-definition.ts:25-31` is already the default-model SSOT — used by `normalizeProviderConfig` as
    `settings.model ?? defaults.model`; a second field would violate one-fact-one-owner). Add a **per-model**
    cost descriptor on `IProviderModelCatalogEntry` (`costPerInputToken?`/`costPerOutputToken?`) as the
    correct long-term home; a provider-level scalar is permitted ONLY as a labeled fidelity-preserving interim
    if per-model data is unavailable at migration time.
  - **Relocate `normalizeProviderConfig` + `createProviderFromConfig`** from `agent-executor/src/providers/
provider-factory.ts` into `agent-core` (they already import **only** `agent-core` symbols —
    `findProviderDefinition`, `resolveEnvReference`, `getProviderCredentialRequirement`), so the collapsed
    node can reuse the one credential-resolution SSOT while depending on `agent-core` only. `agent-executor`
    re-exports from the new location (no consumer break).
- **`packages/agent-provider-defaults`** — populate the new fields on each default definition (the
  `defaultModel`/`allowedModels`/cost values currently hardcoded in the vendor nodes migrate here). Preserve
  the current default semantics deliberately: `new LlmTextOpenAiNodeDefinition()` yields
  `allowedModels=[defaultModel]` (`llm-text-openai/src/index.ts:116-119`) — decide explicitly whether to keep
  "only the default model permitted unless overridden" or widen it; do not migrate it by accident.
- **`packages/dag-framework`** — `createDagFramework({ providers })` seam + `createDefaultNodeRegistry(providers?)`
  binds the `llm-text` node to the given (or default) registry; replace the five vendor `modulePath` entries +
  the router entry with the one `llm-text` entry. **Dependency-hygiene constraint (see below).**
- **`packages/dag-core`** — invert/remove the `llm-text` tombstone (`definition-validator.ts:59-72`).

**Consumer migration (was understated — now first-class): derive provider/model/cost from `config.provider`,
not from per-vendor `nodeType`:**

- `packages/dag-cli/src/commands/cost.ts:316,333,349` — per-vendor cost branches.
- `packages/dag-cli/src/commands/{run,benchmark,init,tutorial,node}.ts` — per-vendor `nodeType` branching,
  scaffolding defaults, pipeline examples.
- `packages/dag-cli/src/templates/dag-templates.ts` — template defaults.
- `packages/dag-cli/src/commands/lock.ts:12-19` — the lock allowlist (`LLM_NODE_TYPES` set, incl. `llm-text-router`).
- `packages/dag-cli/src/local-runner/node-registry.ts:3-13,22-30` — static imports of all five vendors + router.
- Workflow fixtures/examples + instant-node persisted formats + docs referencing `llm-text-<vendor>` /
  `llm-text-router` → `llm-text`.

**Delete:** `packages/dag-nodes/llm-text-{anthropic,openai,gemini,deepseek,qwen}` +
`packages/dag-nodes/llm-text-router`.

### Alternatives Considered

1. **Keep per-vendor nodes; inject only the provider instance.** Removes `process.env` reads but leaves five
   packages + the router's hardcoded union. Rejected: half the fix; contradicts the parent's node-collapse
   decision. (The larger consumer-migration cost of Alt 2 is the _correct_ scope for the collapse, not a reason
   to prefer this half-fix.)
2. **Collapse to one node + provider-registry injection via `createDagFramework({ providers })` (chosen).**
   One node resolves an `IAIProvider` from the injected `IProviderDefinition[]`; strategy + credential-presence
   move to the definition/composition layer; cost/model migrate into the SSOT. Adding a provider = adding one
   `IProviderDefinition`.
3. **Inject the registry through per-execution `INodeExecutionContext` instead of node construction.** More
   plumbing, and the node carries no static identity for the manifest/registry. Rejected: construction-time
   injection (`createDefaultNodeRegistry(providers?)`) mirrors the existing `options.nodes` seam, is trivially
   stubbable, and late-bound `$ENV:` credentials still resolve at execute-time inside `createProvider`.

### Decision

**Alternative 2 with construction-time injection.** Author one `@robota-sdk/dag-node-llm-text` bound at
construction to an `IProviderDefinition[]`; land `createDagFramework({ providers })` (default =
`createDefaultProviderDefinitions()`); reuse the relocated `agent-core` credential resolver (no `process.env`
in the node); migrate per-vendor model/cost/allowlist into the SSOT (`defaults.model` +
`IProviderModelCatalogEntry` cost + `allowedModels`); invert the `llm-text` tombstone; migrate the whole
dag-cli/dag-core consumer surface + workflow `kind`s; delete the five vendor packages + the router.

**Explicit caveats:**

- When a caller passes custom `options.nodes`, `options.providers` is **ignored** (their nodes carry their own
  registry) — documented in the framework types, not silently swallowed.
- **Dependency hygiene.** `dag-framework` today depends on **no** provider package (the point of the
  dynamic-import + silent-skip pattern). Binding `providers ?? createDefaultProviderDefinitions()` must NOT make
  `dag-framework` statically import all five provider SDKs (the coupling the parent fights, deferred to Stage
  C's `dag-nodes-default` leaf). Therefore the **default** provider path stays **lazy** (dynamic-import
  `createDefaultProviderDefinitions()` only when no `providers` are injected), preserving today's
  no-static-SDK-dep property; `check-dependency-direction` allowlist updated to match. (No permanent
  `dag-framework → agent-provider-defaults` static edge is introduced.)
- **Default-registry granularity change (stated, not papered over).** Today `createDefaultNodeRegistry`
  dynamic-imports each vendor node _independently_ and **silently skips** any whose SDK is absent
  (`default-node-registry.ts:68-72`), so a partial-SDK install yields the subset of vendor nodes whose SDKs
  loaded. The collapse changes the granularity: there is now **one** `llm-text` node, and the default provider
  set comes from `createDefaultProviderDefinitions()`, which statically imports **four npm SDK packages**
  (`agent-provider-{anthropic,gemini,openai,openai-compatible}`, yielding six provider definitions) and is
  **all-or-nothing** (`agent-provider-defaults/src/default-provider-definitions.ts`). Per-vendor SDK
  degradation no longer maps onto the architecture — this is a **deliberate, correct consequence** of the
  collapse, not a silent regression, and the spec owns it: (1) the **supported partial-install path is
  explicit injection** — `createDagFramework({ providers: [openaiDef, …] })` — which the collapse fully
  supports and which is the DIP-aligned, no-magic path; (2) when the lazy default set **cannot** load (a
  provider SDK is missing in a partial install), the framework MUST surface a **typed diagnostic naming the
  missing provider package** rather than silently dropping the `llm-text` node (aligns with no-fallback +
  the parent's Stage-C "explicit registration/typed error", P2-2). No silent whole-node vanish. Covered by
  TC-10.
- **Provider-skip is a strategy, not a fallback violation.** The router skips a provider with no resolvable
  credential and moves to the next (`llm-text-router/src/index.ts:206-248`) — a legitimate
  `// allow-fallback`-annotated selection strategy, preserved with the annotation discipline. (This is the
  _credential-absent-at-runtime_ skip; distinct from the _SDK-absent-at-install_ case above, which must be a
  loud typed diagnostic, not a skip.)

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — dag-nodes/llm-text (new), agent-core (fields+resolver relocate), agent-provider-defaults, dag-framework, dag-core (tombstone), dag-cli (6 commands+templates+lock+local-runner), 5 vendor + router (delete)
- [x] Sibling scan 완료 — verified the consumer surface spans dag-cli + dag-core, not only fixtures/docs (proposal-reviewer P5)
- [x] 대안 최소 2개 검토 완료 — 3개 (inject-instance-only / collapse+registry-injection / context-injection)
- [x] 결정 근거 문서화 완료 — matches parent target; add-a-provider = add-one-definition; SSOT via defaults.model + catalog cost; lazy default preserves SDK isolation

## Solution (sub-sequenced, each commit green)

1. **SSOT + resolver (agent-core).** Add `IProviderDefinition.allowedModels?`; add per-model
   `costPerInputToken?`/`costPerOutputToken?` on `IProviderModelCatalogEntry`; **relocate**
   `normalizeProviderConfig`/`createProviderFromConfig` into `agent-core` with `agent-executor` re-exporting.
   No behavior change yet.
2. **Populate defaults (agent-provider-defaults).** Migrate each vendor node's `defaults.model`/`allowedModels`/
   cost into the corresponding `createDefaultProviderDefinitions()` entry (preserving the deliberate
   allowlist semantics).
3. **Invert tombstone (dag-core).** Remove the `nodeType 'llm-text'` rejection in `definition-validator.ts`.
4. **Author `dag-node-llm-text`.** Constructed with an `IProviderDefinition[]`; resolves the target
   `IAIProvider` via the relocated `createProviderFromConfig`; ports `priority-fallback`/`round-robin` +
   `maxCostUsd` cap + **skip-if-no-credential** semantics (computed from `getProviderCredentialRequirement` +
   resolved config, never `process.env`); `options` passthrough; cost/model from the definition/catalog.
5. **Framework seam.** `createDagFramework({ providers })`; `createDefaultNodeRegistry(providers?)` binds the
   node to injected providers, else **lazily** loads `createDefaultProviderDefinitions()`; default composition
   wires it; `check-dependency-direction` allowlist updated.
6. **Migrate consumers + kinds.** dag-cli commands/templates/lock/local-runner derive from `config.provider`;
   default registry entry + on-disk workflow fixtures/examples/instant-node formats + docs `llm-text-<vendor>` /
   `llm-text-router` → `llm-text`.
7. **Delete + repoint (atomic with step 6).** Remove the five vendor packages + the router; doc sweep; harness green.

## Affected Files

- `packages/dag-nodes/llm-text/**` (new package + SPEC)
- `packages/agent-core/src/interfaces/provider-definition.ts` (allowedModels + per-model cost);
  `packages/agent-core/src/providers/**` (relocated resolver); `packages/agent-executor/src/providers/provider-factory.ts` (re-export)
- `packages/agent-provider-defaults/src/default-provider-definitions.ts` (populate fields)
- `packages/dag-framework/src/{create-dag-framework.ts,default-node-registry.ts,types.ts}` (providers seam, lazy default)
- `packages/dag-core/src/services/definition-validator.ts` (invert tombstone)
- `packages/dag-cli/src/commands/{cost,run,benchmark,init,tutorial,node,lock}.ts`, `templates/dag-templates.ts`, `local-runner/node-registry.ts`
- `packages/dag-nodes/llm-text-{anthropic,openai,gemini,deepseek,qwen}/**`, `llm-text-router/**` (delete)
- `scripts/harness/check-dependency-direction.mjs` (dag-nodes-leaf allowlist), workflow fixtures/examples, docs, changeset

## Completion Criteria

- [ ] TC-01: one `dag-node-llm-text` resolves an `IAIProvider` from the **injected** `IProviderDefinition[]`
      registry (unit; a stub registry proves no hardcoded vendor list).
- [ ] TC-02: the router's selection is preserved — `priority-fallback`, `round-robin`, `maxCostUsd` cap, **and
      the skip-if-no-credential semantics** (a provider lacking a resolvable credential is _skipped_, not a hard
      error) — characterization test ported from the router.
- [ ] TC-03: **no `process.env` read in the node source** (grep/guard over `packages/dag-nodes/llm-text/src`);
      credential resolution flows through the relocated `agent-core` resolver.
- [ ] TC-04: `createDagFramework({ providers })` overrides the registry; omitting it lazily defaults to
      `createDefaultProviderDefinitions()`; **`dag-framework` gains no static provider-SDK dependency**
      (dependency-direction scan green; asserted).
- [ ] TC-05: `defaults.model` / `allowedModels` / per-model cost resolve from `IProviderDefinition` (SSOT),
      not from per-node hardcoded state; golden test on the default definitions carries the migrated values;
      **no second `defaultModel` field introduced**.
- [ ] TC-06: the `llm-text` tombstone is inverted (a migrated `llm-text` workflow passes `definition-validator`);
      the five vendor packages + router are deleted; `ghost-package-refs` + `deps` + `workspace-refs` scans
      green; dag-cli/dag-core consumers migrated (no per-vendor `nodeType` branch remains — grep-asserted).
- [ ] TC-07: `options` passthrough on the single node (a passed option reaches the provider config).
- [ ] TC-08: full `pnpm harness:scan` 48/48 + `pnpm harness:test` + full-repo `pnpm typecheck` 0; changeset present.
- [ ] TC-09: **no mid-migration `/workflows` regression** — `/workflows` instant-node execution + create still
      resolve an LLM provider through the collapsed node (integration; deterministic suite uses a stubbed
      provider — no real call, common-mistakes #76; a real call is opt-in only).
- [ ] TC-10: **default-path partial-install behavior** — when the lazy default provider set cannot load
      because a provider SDK is absent, the framework surfaces a **typed diagnostic naming the missing
      provider package** and does NOT silently drop the `llm-text` node; explicit `providers` injection is the
      supported partial-install path (asserted in an isolated context, since the in-repo suite has all SDKs
      present and would otherwise not exercise this path).

## Test Plan

RED→GREEN per sub-sequence step. Unit-test the collapsed node against a stub `IProviderDefinition[]` (TC-01,
TC-03, TC-07); port the router strategy + skip-semantics characterization (TC-02); framework-level test for the
`providers` seam + lazy default + no-new-SDK-dep (TC-04); golden test on `createDefaultProviderDefinitions()`
for migrated model/cost/allowlist (TC-05); validator test for the un-tombstoned `llm-text` + grep-guard for
residual per-vendor branches (TC-06); a stubbed-provider `/workflows` integration for TC-09 (deterministic
suite makes **no** real provider call — common-mistakes #76). Full `harness:scan` + `harness:test` + typecheck

- changeset before merge (TC-08).

## Tasks

- [ ] Step 1 — agent-core: add `allowedModels?` + per-model cost catalog fields; relocate
      `normalizeProviderConfig`/`createProviderFromConfig` into agent-core (agent-executor re-exports). RED→GREEN.
- [ ] Step 2 — agent-provider-defaults: populate `defaults.model`/`allowedModels`/cost per definition (golden test).
- [ ] Step 3 — dag-core: invert the `llm-text` tombstone in `definition-validator.ts` (+ validator test).
- [ ] Step 4 — author `@robota-sdk/dag-node-llm-text` (one node; registry-injected; strategy + skip-if-no-cred;
      options passthrough; no process.env). TC-01/02/03/07.
- [ ] Step 5 — dag-framework: `createDagFramework({ providers })` + `createDefaultNodeRegistry(providers?)`
      (lazy default + typed diagnostic on missing SDK); dep-direction allowlist. TC-04/TC-10.
- [ ] Step 6 — migrate consumers (dag-cli commands/templates/lock/local-runner) + workflow kinds to `llm-text`.
- [ ] Step 7 — delete 5 vendor packages + router (atomic with step 6); doc sweep; changeset; harness green. TC-05/06/08/09.

## Evidence Log

- 2026-07-09 GATE-DRAFT — authored from ARCH-PROVIDER-001 Stage B + round-2 author notes.
- 2026-07-09 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction correct — Alt 2 +
  construction-time injection endorsed; 5 corrections folded in). (P5) Affected scope understated: the
  consumer surface spans `dag-cli` (`commands/{run,cost,benchmark,init,tutorial,node,lock}.ts`,
  `templates/dag-templates.ts`, `local-runner/node-registry.ts`) and **`dag-core/definition-validator.ts`**,
  not just fixtures/docs — now first-class "derive from `config.provider`" migration. (4) The `llm-text`
  tombstone (`definition-validator.ts:59-72`) actively rejects the identifier we reintroduce — invert it in
  this stage. (P7/2) Drop the proposed top-level `defaultModel` (existing `defaults.model` already owns it —
  one-fact-one-owner); cost belongs per-**model** on `IProviderModelCatalogEntry`, provider-scalar only as a
  labeled interim; state `allowedModels`↔`modelCatalog` relationship. (5) Name the credential-resolution seam
  owner — **relocate** `normalizeProviderConfig`/`createProviderFromConfig` into `agent-core` (they already
  import agent-core-only), so the node depends on `agent-core` alone and reads no `process.env`. (3) The
  `dag-framework → agent-provider-defaults` all-SDK edge is the coupling the parent defers to Stage C — keep
  the default path **lazy** (dynamic-import) so no static provider-SDK dep is introduced; update the
  dependency-direction allowlist. Plus: document `options.nodes`+`options.providers` interaction; preserve the
  deliberate `allowedModels=[defaultModel]` default; assert skip-not-fail provider semantics in TC-02. All
  premises verified TRUE against code. Revised → re-review.
- 2026-07-09 GATE-APPROVAL round 2 — proposal-reviewer **REVISE (narrow)**: all 5 round-1 corrections verified
  correctly + completely reflected against code; one bounded item remained. The lazy default path
  (`createDefaultProviderDefinitions()`, all-SDK, all-or-nothing) changes the default registry from today's
  per-vendor **graceful degradation** (silent skip of a vendor whose SDK is absent, `default-node-registry.ts:68-72`)
  to whole-node all-or-nothing — invisible in-repo (all SDKs present) but a real behavior change for external
  partial-SDK installs, which the "no regression" framing must not paper over. Resolved: added the
  "Default-registry granularity change" caveat owning the delta — the collapse deliberately changes granularity;
  the supported partial-install path is **explicit `providers` injection**; and when the lazy default set
  cannot load, the framework MUST surface a **typed diagnostic naming the missing provider package** (no silent
  node vanish; aligns with no-fallback + parent P2-2). Added **TC-10** (partial-install default-path behavior,
  isolated-context assertion). Fixed two citations (`lock.ts:12-19`; OpenAI catalog path
  `agent-provider-openai/src/openai/provider-definition.ts:34-38`). Re-review → round 3.
- 2026-07-09 GATE-APPROVAL round 3 — proposal-reviewer **ENDORSE**. Bounded round-2 item verified resolved
  against the real loader: the collapsed node depends on `agent-core` only, so it never vanishes for an SDK
  reason; only the lazy default _provider set_ can fail (`createDefaultProviderDefinitions()` imports its SDK
  packages at module top, all-or-nothing), and catching that to re-throw a typed diagnostic naming the missing
  package is directly implementable in the new `createDefaultNodeRegistry(providers?)`. TC-10 confirmed a real
  gate; both citations correct; no new inconsistency. One trivial wording nit (four SDK packages → six
  definitions) tightened. Design APPROVED → implement (7-step sub-sequence). Spec → active.
