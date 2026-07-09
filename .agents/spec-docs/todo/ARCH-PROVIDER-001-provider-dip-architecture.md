---
status: approved
type: INFRA
tags: [architecture, cli]
---

# ARCH-PROVIDER-001: Provider dependency-inversion architecture (ARL-10/11/12/15 target design + staged migration)

## Problem

The 2026-07-08 audit's highest-leverage defect is an **inverted provider decomposition** (ARL-10),
entangled with ARL-11 (DAG leaf→assembly reach), ARL-12 (framework↔node coupling), and ARL-15 (provider
husks). Against the actual code:

- `agent-provider` is a **monolith** whose `package.json` hard-depends on all three LLM SDKs
  (`@anthropic-ai/sdk`, `openai`, `@google/genai`) behind per-vendor subpath exports; any importer pulls all
  three.
- Each per-vendor `dag-node-llm-text-*` package depends on the whole monolith AND imports the **concrete**
  provider class and constructs it inline (`new OpenAIProvider({ apiKey })`, `dag-nodes/llm-text-openai/src/index.ts:125`)
  instead of the `IAIProvider` **abstraction** that `agent-core` already owns. The 5 LLM-text vendor nodes
  copy-paste near-verbatim glue (identical `classifyLlmError`/`sanitizeErrorMessage`/schema/execute; only data
  differs); `dag-node-llm-text-router` depends on all 5 siblings (leaf breach).
- `dag-framework` declares workspace deps on ~19 node packages (static imports + hard-coded dynamic-import
  paths in `default-node-registry.ts`); adding a node edits the framework (ARL-12).
- `dag-node-skill` reaches up into `agent-framework` (assembly layer) (ARL-11).
- ~14 empty **husk** dirs encode a never-executed split, incl. `agent-provider-{anthropic,openai,
openai-compatible,bytedance,gemma,google}` (ARL-15): the per-vendor split was **intended**.

This spec defines the **target architecture** (dependency inversion end-to-end) + the **staged migration**.
Directive: pursue the most-correct architecture; large scale / structural inversion is acceptable (owner,
2026-07-09).

## SDK reality (grounds the split — re-verified exhaustively against `agent-provider/src/*`)

`agent-core` already owns the abstractions: `IAIProvider` / `AbstractAIProvider` (LLM) and, for media,
`IVideoGenerationProvider` etc.; every vendor already `extends AbstractAIProvider` (or a media base). The
split is a **packaging** inversion, not a rewrite.

| Vendor(s)                | SDK / transport                                                 | Contract                                     | Target package                                                                   |
| ------------------------ | --------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| anthropic                | `@anthropic-ai/sdk`                                             | `IAIProvider` (LLM)                          | `agent-provider-anthropic`                                                       |
| openai                   | `openai`                                                        | `IAIProvider` (LLM)                          | `agent-provider-openai`                                                          |
| deepseek, qwen, gemma    | `openai` (compat) + shared `openai-compatible` base             | `IAIProvider` (LLM)                          | `agent-provider-openai-compatible` (**config entries**, not per-vendor packages) |
| gemini (+ google facade) | `@google/genai`                                                 | `IAIProvider` (LLM)                          | `agent-provider-gemini`                                                          |
| **bytedance**            | **bespoke HTTP** (no openai SDK; `/contents/generations/tasks`) | **`IVideoGenerationProvider` (media/video)** | **`agent-provider-bytedance`** (media group, NOT openai-compatible)              |

⇒ **5 SDK/contract-aligned leaf packages**: `-anthropic`, `-openai`, `-openai-compatible`, `-gemini`,
`-bytedance`. deepseek/qwen/gemma differ only by data (defaults/model-catalog/types) over one shared openai
SDK + one shared base → they are **config entries inside `-openai-compatible`**, not four packages (splitting
them buys zero dependency isolation — the "coordination cost without isolation" the audit flags). The
`agent-provider-{gemma}` husk is deleted; `-bytedance` husk becomes the real (video) package.

## Target architecture (the end-state)

**Principle: dependency inversion at every seam.** High-level packages (nodes, framework, CLI) depend on the
`agent-core` **contracts** (`IAIProvider` / `IProviderDefinition`); concrete vendor providers are **leaf
packages each owning one SDK**; the concrete provider is **selected at the composition root**, never
constructed inside a library node.

1. **Per-vendor provider packages (5 leaves).** Each depends on `agent-core` + its one SDK, exporting its
   `Provider extends AbstractAIProvider` (or media base) + its `IProviderDefinition`. `-openai-compatible`
   owns the shared openai base + the deepseek/qwen/gemma provider-definitions as config. **Remove the
   `agent-provider` monolith** (no thin re-export facade — it re-bundles all SDKs and violates no-pass-through);
   consumers repoint to the vendor package(s) they use. `agent-cli` (product tier) may depend on all; libraries
   depend only on what they use (ISP).
2. **Reuse the existing provider-registry seam (no new contract).** `agent-core` **already** owns the
   registry abstraction: `IProviderDefinition` = `type` (name) + `createProvider(config): IAIProvider`
   (factory) + catalog/setup metadata, with `findProviderDefinition(defs, type)` as the resolver and
   `createDefaultProviderDefinitions()` as the aggregator. The "provider registry" is therefore
   `readonly IProviderDefinition[]` (optionally a thin `IProviderRegistry` wrapper exposing `resolve(type)`).
   Do **not** introduce a parallel registry type (it would become a second SSOT that drifts). Relocate
   `createDefaultProviderDefinitions()` out of the deleted monolith into the composition layer.
3. **One provider-agnostic LLM-text node (DIP).** Collapse the 5 LLM-text vendor `dag-node-llm-text-*`
   packages **and the router** into ONE `dag-node-llm-text` node that depends on `agent-core` (`IAIProvider` +
   the `Robota` runtime it drives — not a vendor package). The node config carries `{ provider, model, …common,
options }` where `options: Record<string, TUniversalValue>` is a provider-namespaced **passthrough** routed
   into the existing `IProviderDefinitionConfig.options`, so vendor-specific params (deepseek `reasoning_effort`,
   gemini safety) survive the collapse. The node resolves `findProviderDefinition(registry, config.provider)
.createProvider({ apiKey, model, options })` from the injected registry; **credentials are resolved by the
   definition/composition layer** (the existing `apiKey` `$ENV:` / `source:'env-default'` mechanism) — the node
   reads no `process.env`. Per-vendor **cost-per-token, `allowedModels`, and default-model migrate into
   `IProviderDefinition` (data)** so cost/validation fidelity is preserved. Multi-provider fallback (today's
   router) becomes a config list on the one node. (Media nodes — seedance-video/text-to-image/gemini-image-edit
   — are a **separate axis** consuming media providers; this node covers LLM-text only.)
4. **Injected registries (ARL-12).** `dag-framework` accepts `createDagFramework({ nodes, providers })` and
   depends on **no** node/provider package. A new `dag-nodes-default` **composition-only leaf** (depended on
   ONLY by entry points — `dag-cli`/`dag-mcp-server`/`agent-cli`; enforced by the dependency-direction scan)
   composes the default node set + default provider list via **explicit static registration** (replacing the
   current dynamic-import + silent-skip, which drops a node when its SDK is absent — an unknown provider must
   be a typed error, not a silently-missing node).
5. **Skill/tool execution port (ARL-11).** A stable execution port for the skill/tool capability, owned by
   `agent-core` (or an `agent-interface-*` contract), with `agent-framework`'s concrete `executeSkill`
   injected at the composition root — so `dag-node-skill`/`-tool` bridge via contract, not the assembly layer.
6. **Husk reconciliation (ARL-15).** The 5 `agent-provider-*` husks that map to real leaves become real (1);
   `agent-provider-gemma` (folded into `-openai-compatible`) and the non-provider husks (agent-runtime/-sdk/
   -team/etc.) are deleted; the "split only on independent SDK/heavy-dep, not on data" policy is written into
   `project-structure.md`.

Net: every provider dependency points at an abstraction; each SDK lives in one leaf; the composition root is
the only place concretes/credentials are chosen; framework and nodes are open/closed.

## Key decisions (alternatives)

- **D1 — Remove the monolith (no thin facade).** Chosen: remove. A facade re-bundles all SDKs and is a banned
  pass-through. Consumers depend on vendor packages directly.
- **D2 — One `dag-node-llm-text` (provider injected) vs per-vendor node packages.** Chosen: one node. Per-vendor
  KINDs exist only because the provider is constructed in the node; once injected, the vendor is **data**
  (cost/allowedModels/model-catalog all belong in `IProviderDefinition`, which already exists). One node +
  `options` passthrough loses no capability and deletes 6 packages + the router.
- **D3 — Reuse `IProviderDefinition[]` as the registry (no new contract).** `agent-core` already owns
  `createProvider`/`findProviderDefinition`/`createDefaultProviderDefinitions`; a parallel registry would be a
  second SSOT. (Audit P1-1.)
- **D4 — `-openai-compatible` is ONE package with per-vendor config entries; bytedance is its own media/video
  package.** deepseek/qwen/gemma share one SDK + base → data, not packages. bytedance is a bespoke-HTTP
  `IVideoGenerationProvider`, not openai-compatible → its own leaf in the media group. (Audit P1-2 + reviewer.)

## Staged migration (each stage = an independently-shippable gate unit; no stage leaves the build red)

- **Stage A — Provider split.** Create the 5 leaf packages (+ `-openai-compatible` config entries); move each
  `src/<vendor>` out of the monolith; relocate `createDefaultProviderDefinitions()` to the composition layer;
  repoint the 6 real consumers (`agent-cli`, `agent-command-workflows`, `agent-subagent-runner`,
  `agent-playground`, `apps/agent-server`, `apps/starter-nextjs`); delete the `agent-provider` monolith +
  `-gemma` husk; changesets. Closes ARL-10 provider-half + ARL-15 provider husks.
- **Stage B — LLM-node DIP (self-contained provider path).** Author one `dag-node-llm-text` consuming
  `IAIProvider` via the `IProviderDefinition[]` registry; **land the full provider-registry injection in this
  stage** — the `createDagFramework({ providers })` seam + the default provider composition — so the collapsed
  node is functional the moment the vendor nodes are deleted (no mid-migration `/workflows` regression); migrate
  per-vendor cost/allowedModels/default-model into `IProviderDefinition`; migrate the default registry + workflow
  `kind`s (accepted pre-release break); delete the 5 LLM vendor node packages + the router. Closes ARL-10
  node-half + ARL-11-llm + the glue duplication.
- **Stage C — Node-registry injection.** `createDagFramework({ nodes })` seam + extract the composition-only
  `dag-nodes-default`; framework depends on no node package; enforce `dag-nodes-default` as entry-point-only;
  retire the ARL-11 router allowlist in `check-dependency-direction`. Closes ARL-12.
- **Stage D — Skill/tool port.** Owned execution port; `dag-node-skill`/`-tool` bridge via contract;
  `executeSkill` injected at the root. Closes ARL-11 skill/tool.
- **Stage E — Husk + policy cleanup.** Delete remaining husks; write the SDK-aligned split policy into
  `project-structure.md`. Closes ARL-15 remainder.

## Completion Criteria (this design spec)

- [ ] TC-01: target + the DIP seams (5 provider leaves / reused `IProviderDefinition` registry / one LLM node /
      injected node+provider registries / skill-tool port) specified with each package's owner + dep direction.
- [ ] TC-02: the SDK/contract→package mapping is correct and complete — bytedance is a media/video provider
      (own package), deepseek/qwen/gemma are config entries in `-openai-compatible` (verified vs `src/*`).
- [ ] TC-03: staged plan A–E each names closed ARL items + affected packages and is independently shippable —
      in particular Stage B lands the provider-registry injection so the collapsed node is functional.
- [ ] TC-04: proposal-reviewer ENDORSE (soundness + rules) and architecture-auditor agree the target is the
      correct end-state.
- [ ] TC-05: on endorsement, Stage A is authored as its own gated spec; ARL-10/11/12/15 annotated in the
      remediation log as "target design ARCH-PROVIDER-001; staged".

## Test Plan

A **design** spec — its "tests" are the two review verdicts (proposal-reviewer soundness + architecture-auditor
design-quality), both of which confirmed the direction and required the tightenings folded in above. Each
execution stage (A–E) carries its own RED→GREEN tests, changesets, full-repo typecheck + harness:scan in its
own gated spec. Nothing in this spec edits package `src`.

## Tasks

- [ ] 미생성 — on ENDORSE, author Stage A spec.

## Evidence Log

- 2026-07-09 GATE-APPROVAL round 1 — dual-lens design review. **architecture-auditor**: target direction
  correct (DIP end-to-end, node collapse code-justified); 5 tightenings — reuse `IProviderDefinition` as the
  registry (no new contract, P1-1), `-openai-compatible` = one package with config entries not four (P1-2),
  one-node `options` passthrough (P2-1), `dag-nodes-default` entry-only + explicit registration/typed error
  (P2-2), credentials via the definition layer not `process.env` (P2-3). **proposal-reviewer** REVISE: target +
  D1–D4 directions endorsed; two hard corrections — (1) SDK table error: **bytedance is a bespoke-HTTP video
  provider, not openai-compatible** → own media package; (2) re-sequence: land the provider-registry injection
  in Stage B so the collapsed node is functional (Stage B was not independently shippable as written); plus a
  Stage-B criterion that per-vendor cost/allowedModels/default-model migrate into `IProviderDefinition`. All
  folded into this revision (SDK table, Target §2/§3/§4, D3/D4, Stage A/B, TC-02/TC-03).
- 2026-07-09 GATE-APPROVAL round 2 — **dual-lens ENDORSE**. proposal-reviewer ENDORSE (both hard corrections
  landed: bytedance = own media/video package TC-02; Stage B carries the provider-registry injection TC-03),
  all auditor tightenings verified TRUE against the `agent-core` API (IProviderDefinition.createProvider /
  findProviderDefinition / createDefaultProviderDefinitions already own the registry seam; options passthrough
  - apiKey `$ENV:` mechanism already on IProviderDefinitionConfig). Non-blocking notes for the Stage B author:
    (1) migrating per-vendor cost needs a small additive cost field on IProviderDefinition (planned extension of
    the SSOT, not incidental); (2) Stage B should internally sub-sequence (seam → node → default composition →
    migrate kinds → delete old) to keep each commit green. Design APPROVED → author Stage A.
