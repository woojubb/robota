---
title: 'PROV-008: IProviderModelCatalogEntry conflates three payloads with different lifetimes — dynamic model discovery, static per-model capability, and static per-model pricing all hang off a registry artifact the provider instance never holds, and the only path that could populate any of them is invoked by nothing'
status: done
created: 2026-08-16
completed: 2026-08-17
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

## Implementation Outcome (2026-08-17)

### The three payloads, separated

| Payload             | Where it lives now                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| which models EXIST  | `IProviderDefinition.modelCatalog` — discovery, unchanged, still on the definition                                                          |
| what a model CAN DO | `IProviderCapabilityTable`, declared by the package that ships the adapter and reachable from the provider INSTANCE via `capabilityTable()` |
| what a model COSTS  | unchanged — see the decision below                                                                                                          |

`IAIProvider.modelCatalog?()`, which PROV-006 had added as a stopgap instance seam, is replaced by
`capabilityTable?()`. Keeping capability on a discovery struct would have left the conflation in
place with one more reader.

### The shape: a vendor default plus verified deviations

The item required a table that records **deviations, not an enumeration**, and that a miss resolve to
the vendor default and never to a negative. Both are enforced by `resolveModelCapabilities`, and the
existing data proves why the shape matters:

- **qwen** had three entries; two carried the identical list and only `qwen-flash` differed. One
  default plus one deviation replaces three near-identical rows that drift the first time one is
  edited — `packages/agent-provider-openai-compatible/src/qwen/capability-table.ts`.
- **anthropic** assigned the SAME list to every entry its catalog produced. That is a vendor default
  written out once per model — the enumeration failure in its purest form:
  `packages/agent-provider-anthropic/src/anthropic/capability-table.ts`.
- **gemini** enumerated exactly ONE model, so every other Gemini model was "not in the catalog" and
  therefore declared nothing. As a default it now answers for all of them —
  `packages/agent-provider-gemini/src/gemini/capability-table.ts`.
- **deepseek** keeps the one deviation this whole thread began with, in
  `packages/agent-provider-openai-compatible/src/deepseek/capability-table.ts`.

The contract and its resolution rules are `packages/agent-core/src/interfaces/model-capability.ts`.

Nothing was re-researched: every capability claim and every `verifiedAt` is the one this repository
already made, lifted from the catalog it was written in. What changed is where it lives and who can
read it.

**OpenAI gets no table**, and that is a decision rather than an omission. Its catalog is
`status: 'unavailable'` with a message about live discovery; there is no capability claim in this
repository to lift, and inventing one — with a `verifiedAt` I could not verify — would be worse than
the absence. A provider with no table declares NOTHING, which is exactly today's behaviour, so
nothing regresses. Populating it needs a verified source.

### `refreshModelCatalog` is removed

Declared by every provider definition, invoked by nothing, and its path could never have populated
the static payloads anyway — a models-list endpoint returns ids. Giving it a caller means building
model-discovery UI, which is a feature rather than this defect; a structure with no caller and no
reader is dead structure. Removed from the contract, from five provider definitions, and with its
five refresh modules and their tests. `modelCatalogCacheTtlSeconds`, which only meant anything
alongside a refresh, went with it.

`packages/agent-core/src/interfaces/__tests__/provider-definition.test.ts` now pins the absence, so
re-adding a declared-and-unreachable refresh hook fails.

### Pricing: decided, and it does NOT move

`costPerInputToken` / `costPerOutputToken` have zero readers and zero populators, so the temptation is
to move them next to capability because both are static and per-model. **They stay where they are.**

Capability and price are static for different reasons: capability is versioned with the ADAPTER and
verified against vendor documentation, price is versioned with a vendor PRICE LIST and changes on a
schedule nobody in this repository controls. Putting them in one table because both happen to be
static is the same proximity error that produced the three-payload struct this item is about.

They are also not the same kind of dead as `refreshModelCatalog`: that was a structure every provider
populated and nothing invoked — a mechanism pretending to work. These are empty fields with a named
owner and a documented migration (ARCH-PROVIDER-003 records the provider-level `costPerTokenUsd` as
INTERIM and these as its target). Deleting the target of a migration somebody else planned, so it can
be re-added later, is churn in the other direction.

### Verification

- `pnpm harness:verify` green for all six scopes in this item's `area`: `agent-core`,
  `agent-provider-openai`, `agent-provider-openai-compatible`, `agent-provider-anthropic`,
  `agent-provider-gemini`.
- `pnpm build` clean; every workspace package's suite passes (`dag-adapters-sqlite`/`dag-worker`
  excluded — a missing `better-sqlite3` native binding locally, outside this change's file set).
- `pnpm harness:scan`: 114 passed, 2 skipped.
- `agent-provider-anthropic/src/anthropic/provider.ts` was already frozen above the 300-line ceiling
  and this pushed it past its freeze, so its vendor-level capabilities were split into
  `provider-capabilities.ts` rather than the file being shaved; the ratchet is re-locked.

## User Execution Test Scenarios — executed

**Reclassified from "not applicable".** The item filed this as a contract reshaping with no
user-facing behaviour until a consumer reads it. PROV-006 landed that consumer, so the difference is
now directly observable in what tools a model is offered — and the most important case is one the
item's own Direction predicted: a model **nobody enumerated** must be an ordinary model.

**No API key, no network** — the observables are what the tables answer and what the turn does with
them.

**Invocation.** From `scratch/`:
`node ../node_modules/tsx/dist/cli.mjs --conditions=source src/prov-008-s1.ts`

- Expected observable result: `SCENARIO 1 PASS`, `EXIT:0` — a model absent from the deviation list
  keeps its tools via the vendor default, a verified deviation still removes them, the deviation
  replaces rather than adds, the table stays short, and a provider with no table declares NOTHING
  rather than "no".
- Evidence: executed 2026-08-17 against the completed implementation; **EXIT:0**. Full output:

```text
a model nobody enumerated → ["echo_tool"]
a model that verifiably deviates → []
capabilities resolved for the unenumerated model → ["tools","json_schema","streaming"]
a provider with no table says → null
PASS a model nobody enumerated gets the vendor default, so it keeps its tools
PASS a verified deviation still removes them
PASS the deviation REPLACES the default rather than adding to it
PASS a table short enough to maintain still answers for every model
PASS and a provider with no table at all declares NOTHING, not "no"
SCENARIO 1 PASS
```

Behaviour pinned in the repository by
`packages/agent-core/src/interfaces/__tests__/model-capability.test.ts`,
`packages/agent-core/src/core/__tests__/model-aware-tool-gating.test.ts` and
`packages/agent-provider-openai-compatible/src/deepseek/__tests__/model-capabilities.test.ts`.

```ts
// scratch/src/prov-008-s1.ts
/**
 * PROV-008 Scenario 1 — a model nobody enumerated is an ordinary model.
 *
 * The item filed this as having no user-facing behaviour of its own. PROV-006 changed that: the
 * capability vocabulary is now READ, so where the answer comes from is directly observable in what
 * tools a model is offered.
 *
 * Before: capability hung off `IProviderModelCatalogEntry`, on the provider DEFINITION, which the
 * running provider never holds — and the entries enumerated models. Gemini's catalog listed exactly
 * one, so every other Gemini model was "not in the catalog" and therefore declared nothing.
 *
 * After: each provider package declares a VENDOR DEFAULT plus verified deviations, reachable from
 * the instance. A model absent from the deviation list is an ordinary model, which is what makes a
 * short table safe — an enumeration would have to list every model a vendor will ever ship.
 *
 * No API key and no network: the observable is what the capability tables answer and what the turn
 * does with them.
 */
import {
  AbstractAIProvider,
  AbstractTool,
  Robota,
  modelDeclaresCapability,
  resolveModelCapabilities,
} from '@robota-sdk/agent-core';

import type {
  IChatOptions,
  IProviderCapabilityTable,
  IToolResult,
  IToolSchema,
  TToolParameters,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

/** The shape a provider package now ships: one default, and only what verifiably differs. */
const TABLE: IProviderCapabilityTable = {
  vendorDefault: ['tools', 'json_schema', 'streaming'],
  deviations: {
    'reasoner-model': {
      capabilities: ['reasoning', 'json_schema', 'streaming'],
      verifiedAt: '2026-08-16',
    },
  },
  verifiedAt: '2026-08-16',
};

class TableProvider extends AbstractAIProvider {
  override readonly name = 'table-provider';
  override readonly version = '1.0.0';
  toolsOffered: string[][] = [];

  capabilityTable(): IProviderCapabilityTable {
    return TABLE;
  }

  override async chat(
    _messages: TUniversalMessage[],
    options?: IChatOptions,
  ): Promise<TUniversalMessage> {
    this.toolsOffered.push((options?.tools ?? []).map((tool) => tool.name));
    return {
      id: 'r1',
      role: 'assistant',
      content: 'noted',
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }
}

class EchoTool extends AbstractTool {
  override get schema(): IToolSchema {
    return {
      name: 'echo_tool',
      description: 'echoes its input back',
      parameters: { type: 'object' as const, properties: {} },
    };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: {} };
  }
}

async function toolsOfferedTo(model: string): Promise<string[]> {
  const provider = new TableProvider();
  const agent = new Robota({
    name: 'PROV-008 Scenario',
    aiProviders: [provider],
    defaultModel: { provider: 'table-provider', model },
    tools: [new EchoTool()],
    logging: { level: 'silent', enabled: false },
  });
  await agent.run('hello');
  return provider.toolsOffered[0] ?? [];
}

async function main(): Promise<void> {
  const neverEnumerated = await toolsOfferedTo('a-model-released-after-this-table-was-written');
  const deviating = await toolsOfferedTo('reasoner-model');

  console.log('a model nobody enumerated →', JSON.stringify(neverEnumerated));
  console.log('a model that verifiably deviates →', JSON.stringify(deviating));
  console.log(
    'capabilities resolved for the unenumerated model →',
    JSON.stringify(
      resolveModelCapabilities(TABLE, 'a-model-released-after-this-table-was-written'),
    ),
  );

  // A provider that declares no table at all is a third state, distinct from both.
  const silent = modelDeclaresCapability(undefined, 'anything', 'tools');
  console.log('a provider with no table says →', JSON.stringify(silent ?? null));

  const checks: Array<[string, boolean]> = [
    [
      'a model nobody enumerated gets the vendor default, so it keeps its tools',
      neverEnumerated.includes('echo_tool'),
    ],
    ['a verified deviation still removes them', deviating.length === 0],
    [
      'the deviation REPLACES the default rather than adding to it',
      modelDeclaresCapability(TABLE, 'reasoner-model', 'reasoning') === true &&
        modelDeclaresCapability(TABLE, 'reasoner-model', 'tools') === false,
    ],
    [
      'a table short enough to maintain still answers for every model',
      Object.keys(TABLE.deviations ?? {}).length === 1,
    ],
    ['and a provider with no table at all declares NOTHING, not "no"', silent === undefined],
  ];

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
    if (!ok) failed += 1;
  }
  console.log(failed === 0 ? 'SCENARIO 1 PASS' : `SCENARIO 1 FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
```

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-17

**Status upgrade:** in-progress → done

- The scenario was executed by the agent against the completed implementation, `EXIT:0`, output
  recorded above.
- The observed result matched the expected observable result, including the case the item's Direction
  named as the safety condition for a short table.
- Evidence references durable repository artifacts (the three test files named above).
- No engineering verification is cited as user-execution evidence — the suites and harness runs are
  recorded separately under _Verification_.
- No capability-absence claim is made; no credential was needed.
