---
title: 'PROV-008: IProviderModelCatalogEntry conflates three payloads with different lifetimes — dynamic model discovery, static per-model capability, and static per-model pricing all hang off a registry artifact the provider instance never holds, and the only path that could populate any of them is invoked by nothing'
status: todo
created: 2026-08-16
priority: high
urgency: soon
area: packages/agent-core, packages/agent-provider-openai, packages/agent-provider-openai-compatible, packages/agent-provider-anthropic, packages/agent-provider-gemini
depends_on: []
---

# PROV-008: the model catalog is three contracts wearing one struct

Filed under [finding-depth.md](../rules/finding-depth.md) from a `DEPTH: FOUNDATIONAL` verdict
(`finding-depth-triager`, 2026-08-16) on an expansion that CORE-043's design had absorbed. Split out
so the cause has its own owner rather than being carried under an item whose thesis is elsewhere.

## Problem

`IProviderModelCatalogEntry` (`packages/agent-core/src/interfaces/provider-definition.ts:66-85`)
carries three payloads whose lifetimes and sources have nothing in common:

| Payload                                     | Nature                                     |
| ------------------------------------------- | ------------------------------------------ |
| model existence / ids                       | **dynamic**, per-account, live-refreshable |
| `capabilities?: TProviderModelCapability[]` | **static**, versioned with the adapter     |
| `costPerInputToken` / `costPerOutputToken`  | **static**, versioned with vendor pricing  |

The struct hangs off `IProviderDefinition`, a setup/registry artifact — **the provider instance does
not hold its own definition**, so nothing at runtime can read any of it.

Three consequences, each verified against `develop` (2026-08-16):

1. **`refreshModelCatalog` is invoked by nothing.** It is declared by all six provider-definitions and
   there is no caller in any `src`, and no reader of `modelCatalog.entries` either. The structure is
   not a dead _field_ — it is a dead _structure_.
2. **The dynamic path could never populate the static payloads anyway.** `refreshOpenAIModelCatalog`
   builds entries from `GET /v1/models`, and `IOpenAIModelCatalogResource` carries `id` and nothing
   else. So a live refresh can never supply a capability or a price.
3. **`status: 'unavailable'` is a statement about discovery being read as a statement about
   capability.** `agent-provider-openai/src/openai/provider-definition.ts:36-40` says "model
   availability should be discovered live from `GET /v1/models`". A consumer looking for what a model
   can _do_ finds that verdict and reads "declares nothing" — which is how CORE-043's first design
   revision concluded OpenAI had no declared source.

## Direction

Separate the concerns the struct conflates: discovery stays where it is, and **what a model can do**
moves to a static, dated table each provider package owns and its **instance** can import. DeepSeek
already has that shape (`getDeepSeekFallbackModelCatalogEntry` reads a module-scope array in its own
package); OpenAI has no such array and gets one.

The table records **verified deviations from the provider's vendor default, not an enumeration of
models** — otherwise it is a per-model × N-flag matrix nobody maintains. That is only safe if a
capability miss resolves to the vendor default and never to a negative; that rule belongs with
whichever item makes the capability live (PROV-006), and this item must not ship a table without it.

Pricing is a third question: it is static and per-model like capability, so it plausibly travels with
it — but it has **zero readers and zero populators repo-wide**, so nothing forces the move. Decide it
here rather than letting it ride along with capability by proximity.

## Relationship to other items

- **PROV-006** owns whether the per-model capability vocabulary is consumed or deleted. This item owns
  where a consumed vocabulary would _live_. PROV-006's decision comes first; if it is "delete", this
  item's capability half changes shape.
- **NEUT-010** already names this struct as "the correct seam … documented as correct and unused",
  scoped to vendor knowledge in neutral packages. This item is the structural half NEUT-010 does not
  cover.
- **CORE-043** needs a declared capability source and is therefore a consumer of the outcome, not the
  owner of it.

## Test Plan

- A test pins that the capability table is reachable from a provider **instance**, not only from its
  definition — the property whose absence makes today's catalog unreadable at runtime.
- A test pins the discovery/capability split: a live-refreshed entry carries ids and never claims a
  capability.
- `refreshModelCatalog` either gains a caller or is removed; a scan or test fails if it is declared
  and unreachable again.
- `pnpm harness:verify -- --scope packages/agent-core` and the affected provider scopes green.

## User Execution Test Scenarios

Not applicable as filed — this is a contract reshaping with no user-facing behaviour of its own until
a consumer reads it. The consumer that makes it observable is CORE-043, whose scenarios cover it. If
this item ships a `/model`-visible capability display, that display is the scenario and must be
specified here at that point.
