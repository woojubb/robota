---
status: draft
type: INFRA
tags: [architecture, product-composition, agent-product, capability-pack, preset, external-consumer, packaging]
---

# ARCH-005: external product composition — publishable `assembleProduct` + capability-pack + product-profile

> **Type note.** The spec-doc `type` frontmatter is the orthogonal SDLC classification enforced by
> `check-spec-doc-frontmatter.mjs`; `ARCH` is not one of the 11 accepted values, so this document uses
> `type: INFRA` (the same classification the prior architecture spec `ARCH-PROVIDER-001` used). The
> `ARCH-005` filename ID keeps its initiative/domain namespace — only the frontmatter type differs.
>
> **Owner-critical placement call — read `## Decision` § Placement first.** The load-bearing decision is
> whether a *published, profile-driven* `assembleProduct` can exist without violating the existing
> **"Per-product assembly ownership — no shared product factory"** rule
> (`project-structure.md` L129, `feedback_no_shared_cli_factory`). This spec argues it can, but that
> reconciliation is exactly what GATE-APPROVAL (architecture-auditor + proposal-reviewer) must scrutinize.

## Problem

A third party must be able to, **from a separate repo**, do three things that Robota's published packages
almost — but do not yet — support:

- **(A) Build a specific product on our published `agent-framework`.** Ship "my coding assistant" as their
  own npm package/binary, reusing Robota's runtime.
- **(B) Author their OWN preset in code and layer it** to make a distinct product with a different
  behavior/persona.
- **(C) Consume OUR presets while packaging a product in a consumer style** (take `robota`'s built-in
  presets/opinions and wrap them in their own shell).

The **contract + opinion layers are ALL already published** and verified in-tree: `agent-core`,
`agent-tools`, `agent-framework`, `agent-preset`, `agent-command`, and the provider family
(`agent-provider-*` incl. `-defaults`). `IPreset` + `registerExternalPresets` + `loadExternalPresets`
already exist (`packages/agent-preset/src/{preset-types,resolve-preset,load-external-presets}.ts`).

### The linchpin gap — the product-assembly kernel is not a published library

The composition root that turns those libraries into a *runnable product* is **hand-wired inside
`packages/agent-cli/src/cli.ts`** (`startCli`, ~502 lines) and is **not** exposed by any published
package. Enumerating exactly what that composition root wires (file `packages/agent-cli/src/cli.ts`):

| Concern | Wired at | What it does |
| --- | --- | --- |
| Preset registration | `cli.ts:221` | `loadExternalPresets()` — registers `~/.robota/presets/*.json` before resolution |
| Preset resolution | `cli.ts:225-235` | `resolveCliPreset(args, settingsPreset)` + `selectPresetId(...)` → `IResolvedPresetOptions` |
| Command modules + provider defs | `cli.ts:237-251` | `buildCommandSetup(...)` (`startup/command-setup.ts`) → `{ providerDefinitions, commandModules, commandHostAdapters, remoteCommandPolicy, … }`, threaded with the preset's `enabled/disabledCommandModules` delta |
| Transport registry | `cli.ts:255`, `99-119` | `createDefaultTransportRegistry()` — constructs `TransportRegistry` and registers a concrete `WsTransport` (reads `ROBOTA_WS_TOKEN`/`ROBOTA_WS_PORT`) |
| Remote-control controller | `cli.ts:256-258` | `createRemoteControlController(registry)` + `buildRemoteControlHostAdapter(...)` |
| Provider construction | `cli.ts:304-322` | `readProviderSettings` + `createProviderFromSettings(...)` (or `loadReplayProvider` for `--session-log`) |
| Background runners | `cli.ts:323` | `createDefaultBackgroundTaskRunners()` (from `agent-executor`, via the composition-root import exemption) |
| Subagent runner factory | `cli.ts:325-330` | `createChildProcessSubagentRunnerFactory({ workerPath, providerConfig, logsDir, worktreeAdapter })` |
| Session store + resume | `cli.ts:332-348` | `createProjectSessionStore(cwd)` + resume/continue/fork resolution |
| Memory switch | `cli.ts:353-360` | `resolveMemoryEnablement(...)` → `buildMemorySessionOptions(...)` |
| Presentation / mode dispatch | `cli.ts:363-500` | `runPrintMode` / `runServeMode` / `renderApp` + `createDefaultTuiCliAdapter` (the TUI) |

So an external repo that wants "their own product" faces a false choice: **reimplement this entire
composition root**, or **depend on the whole `agent-cli` product** (dragging in the Ink TUI, remote
control, the WS transport, and every CLI-only concern). Neither serves Mode A/B/C. That missing
published composition kernel is **the single linchpin gap**.

### Secondary gap 1 — presets are subtractive, not additive

`IResolvedPresetOptions` (`preset-types.ts:32-78`) expresses tool/command *selection over a superset the
product already hardcodes*: `allowedTools` / `deniedTools` (allow/deny lists) and
`enabledCommandModules` / `disabledCommandModules` (names filtered against the modules `buildCommandSetup`
already assembled). A preset **cannot bring its own** tool, command module, or subagent — it can only
narrow what the host product already offers. So an external "assistant" product that needs a *new*
capability set has no compositional axis; presets are behavior dials, not capability bundles. This is by
design (`Preset Package Rule`: "produces option data only … performs no session assembly") — the additive
axis is simply missing from the published surface.

### Secondary gap 2 — no product identity/manifest unit

There is no published unit that ties **branding + capability packs + preset + provider-defaults** together
into one declarative "this is my product" object. Today that identity is implicit, scattered across
`cli.ts` argument handling, `DEFAULT_AGENT_NAME` (`agent-preset`), and settings. An external product has
nowhere to *declare* itself.

## Prior Art Research

**Topic:** ARCH-005 — extracting Robota's product-assembly kernel into three published deliverables:
`assembleProduct(profile) -> runtime` (composition root as a library), an `ICapabilityPack` additive-bundle
contract, and the existing `agent-preset` for behavior/persona. Researching precedent for the shape
"published contract + composition function + additive capability packs." (Product documentation only; no
third-party source code.)

### References consulted (product documentation)

**1. Backstage — new backend system (`createBackend()` composition root)**
Docs: https://backstage.io/docs/backend-system/ and https://backstage.io/docs/backend-system/building-backends/index

The backend is a pure composition root: a factory call, a sequence of additive `add()` calls, then `start()`.
> "import { createBackend } from '@backstage/backend-defaults'; const backend = createBackend(); backend.add(import('@backstage/plugin-app-backend')); backend.add(import('@backstage/plugin-catalog-backend')); backend.start();"

And the responsibility split between the three composable kinds:
> "The framework distinguishes between plugins (standalone features), modules (which augment existing plugins), and services (for overriding behavior). Each module targets only one plugin, which must also be present in the same backend."

The overview frames the whole system as:
> "The Backstage backend system provides a flexible foundation for building and extending Backstage backends. It uses a modular architecture where you can create and customize plugins, modules, and service implementations."

*Teaches Robota:* this is the single closest analog to `assembleProduct(profile) -> runtime`. The
composition root is a published function (`createBackend` from `@backstage/backend-defaults`) that a
*separate* repo imports and wires; the product owner assembles by additively `add()`-ing published
packages, not by editing the framework. The plugin/module/service split validates Robota's
pack-vs-preset-vs-profile separation: packs = "standalone features" (Backstage plugins), presets =
"override behavior" (Backstage services), and the profile is the `createBackend()`-equivalent assembly
list. Note the invariant that a module (augmentation) requires its target plugin present — Robota's packs
that extend other packs should carry an explicit dependency contract, not silent ordering.

**2. Docusaurus — presets (a preset *is* a bundle of plugins + themes)**
Docs: https://docusaurus.io/docs/using-plugins (presets section)

> "Presets are bundles of plugins and themes."

A preset is a constructor returning a composition object in the same shape the site config accepts: a
preset "should return an object of `{ plugins: PluginConfig[], themes: PluginConfig[] }`" in the same
format accepted in site configuration.

*Teaches Robota:* the industry meaning of "preset" is broader than Robota's proposed narrow one. In
Docusaurus a preset bundles *capability* units (plugins/themes) — i.e., it does what Robota is calling a
*pack* + *profile*. This is the key **naming-collision** constraint: Robota is deliberately splitting
Docusaurus's single "preset" concept into three (behavior-preset, capability-pack, product-profile). The
doc supports the split's mechanism — a preset resolves to a plain composition object in the *same format*
the top-level config accepts — which argues Robota's `profile` and `ICapabilityPack` should resolve to the
same shape `assembleProduct` accepts directly, so a pack is just "a profile fragment" and composition is
uniform.

**3. ESLint — plugins + bundled `configs` (additive, never forced)**
Docs: https://eslint.org/docs/latest/extend/plugins

A plugin is a contract object exposing named capability buckets:
> "a JavaScript object that exposes certain properties to ESLint" including "'configs' — an object containing named configurations", "'rules' — an object containing the definitions of custom rules", and "'processors' — an object containing named processors".

A plugin may ship recommended bundles:
> "You can bundle configurations inside a plugin by specifying them under the `configs` key. This can be useful when you want to bundle a set of custom rules with a configuration that enables the recommended options."

Critical composition constraint:
> "Plugins cannot force a specific configuration to be used. Users must manually include a plugin's configurations in their configuration file."

*Teaches Robota:* the `ICapabilityPack` contract should look exactly like ESLint's plugin object — a plain
data record of named buckets (tools/commands/subagents), not IO or lifecycle behavior. And the "cannot
force" rule is the load-bearing lesson: **capability packs compose additively and opt-in; the consumer's
product-profile decides what is enabled — a pack must not activate itself.** ESLint's flat-config model
composes by concatenation (later entries add/override), which is the additive-not-subtractive model Robota
should adopt for pack merging.

**4. Claude Agent SDK — additive capability via the `plugins` option (AI-agent reference)**
Docs: https://code.claude.com/docs/en/agent-sdk/overview

The SDK is explicitly "Claude Code as a library" — the same kernel, exposed as a composable function
`query({ prompt, options })`. Capability is contributed additively through options and a dedicated plugin
bucket:
> "The Agent SDK includes built-in tools for reading files, running commands, and editing code, so your agent can start working immediately without you implementing tool execution."

And the plugin bundle contract (from the Claude Code features table):
> "Plugins | Extend with skills, agents, hooks, and MCP servers | Programmatic via `plugins` option"

Subagents, MCP servers, and tools are each passed as additive maps into `options` (e.g.
`agents: { "code-reviewer": {...} }`, `mcpServers: {...}`, `allowedTools: [...]`).

*Teaches Robota:* this is the strongest AI-agent-domain precedent and it matches Robota's target shape
almost exactly — a single composition function (`query`/`assembleProduct`) takes a profile-like options
object, and capability arrives as additive bundles (a `plugins` bundle that carries "skills, agents,
hooks, and MCP servers" is precisely an `ICapabilityPack` of "tools/commands/subagents"). It also
validates the neutrality invariant: the core loop ships with built-in tools but extension is purely
additive through options — the library never hard-wires a particular product's capability set.

**5. VS Code — contribution points (capability contribution is declarative + host-isolated)** *(supporting reference)*
Docs: https://code.visualstudio.com/api/references/contribution-points

> "Contribution Points are a set of JSON declarations that you make in the `contributes` field of the `package.json` Extension Manifest. Your extension registers Contribution Points to extend various functionalities within Visual Studio Code."

*Teaches Robota:* capability contribution is best expressed *declaratively* and enumerable by the host
without executing the contributor's runtime code. For Robota this argues an `ICapabilityPack` should be
introspectable metadata (what tools/commands/subagents it brings) that `assembleProduct` can enumerate and
gate *before* activation — the same isolation that lets the profile/permission layer decide what runs.

### Common shape across the references

All five converge on the same three-layer productization pattern:

1. **A published contract layer** — a plain data record of named capability buckets (ESLint plugin's
   `{configs, rules, processors}`; Backstage plugin/module; Claude SDK `plugins` = skills/agents/hooks/MCP;
   VS Code `contributes` JSON). No IO, no lifecycle — just declarations. This is Robota's `ICapabilityPack`.
2. **A composition function / composition root** — one published entry that turns declarations into a
   running product (`createBackend()...start()`; Docusaurus preset constructor → config object; Claude SDK
   `query(options)`). This is Robota's `assembleProduct(profile)`.
3. **Additive capability packs** — capability arrives by *adding* bundles, never by editing the kernel;
   bundles may themselves aggregate sub-units (Docusaurus preset bundles plugins+themes; ESLint plugin
   bundles configs+rules; Claude `plugins` bundle multiple kinds).

### Constraints/lessons that apply to Robota

- **Additive, not subtractive, and opt-in.** ESLint is explicit: "Plugins cannot force a specific
  configuration to be used. Users must manually include a plugin's configurations." A capability pack must
  not self-activate; the product-profile is the sole authority on what is enabled. Merge semantics should
  be concatenation/override (flat-config style), not silent global mutation.
- **Contract layer must stay IO-free.** Every contract precedent (ESLint plugin object, VS Code
  `contributes` JSON, Backstage plugin declaration) is inert data/metadata. `@robota-sdk/agent-capability-pack`
  should carry declarations that `assembleProduct` enumerates and gates *before* running anything —
  preserving the "framework/core stay neutral" invariant and the existing permission/profile gating.
- **The "preset" name collides with industry usage.** Docusaurus's "preset" already means "bundle of
  plugins and themes" (i.e., Robota's pack+profile). Robota is narrowing "preset" to behavior/persona only,
  so the spec should state that distinction loudly to avoid confusing consumers who arrive with the
  Docusaurus/`create-react-app` mental model.
- **Distinguish standalone vs augmenting units, with declared dependencies.** Backstage separates plugins
  (standalone), modules (augment a specific plugin — which must be present), and services (override
  behavior). Robota's split maps cleanly (pack≈plugin, preset≈service/behavior-override, profile≈the
  `createBackend` list), but packs that augment other packs need an explicit dependency/ordering contract
  rather than relying on assembly order.
- **Ship a "defaults" package separate from the composition function.** Backstage imports `createBackend`
  from `@backstage/backend-**defaults**` — the composition helper and the opinionated default wiring are
  one published unit, distinct from individual plugins. Robota already has `agent-provider-defaults`; keep
  `assembleProduct` (mechanism) cleanly separable from the default profile/packs it ships (opinion), so a
  third party can call `assembleProduct` with their own profile and none of Robota's product opinion.

## Decision

Three published deliverables. **`agent-framework` and `agent-core` are UNCHANGED and stay neutral.**

1. **`@robota-sdk/agent-product` (new, published)** — the product-assembly kernel, exposing
   `assembleProduct(profile)`. Extract the *product-neutral* composition of runtime materials out of
   `cli.ts` into a pure, profile-driven library; `agent-cli` becomes a thin caller that binds its own
   presentation. **(Mode A gateway.)**
2. **`@robota-sdk/agent-capability-pack` (new, published)** — the `ICapabilityPack` contract + a pure
   registry merger. Tool/command/subagent bundles as the *additive* composition unit. Mirrors
   `agent-preset` exactly (contract + pure merger, no IO). **(Mode C additive axis.)**
3. **`agent-preset` (existing, published)** — already provides `IPreset` + `registerExternalPresets` +
   `loadExternalPresets` for behavior/persona. Expose and document for external authoring; **no contract
   change needed.** **(Modes B/C behavior axis.)**

### Placement — the owner-critical call (lead)

The existing rule (`project-structure.md` L129, `feedback_no_shared_cli_factory`) says:

> **Per-product assembly ownership — no shared product factory.** … Do NOT extract a shared cross-product
> assembly factory (e.g., a `createCliAgent`) … Reuse is achieved by sharing lower-layer materials, not by
> sharing the product's assembly.

`assembleProduct(profile)` is **not** the thing that rule rejects, and the distinction is the whole
architecture:

- The **rejected `createCliAgent`** (TEST-008, cancelled by owner) was a factory that baked *the CLI's
  own* provider/preset/command/TUI choices into a reusable utility — "call this to get **the CLI's**
  wiring." That shares *a product's assembly*.
- **`assembleProduct(profile)`** ships *no product*. It is a **product-agnostic mechanism** whose entire
  product identity — branding, provider surface, presets, capability packs, and the concrete
  transport/presentation adapters — arrives as the `IProductProfile` **data argument**. `robota` becomes
  *one* profile among many; an external repo brings its own. This is precisely the rule's own remedy —
  "the reusable, product-agnostic capability lives in the framework/transport layers" and "reuse is
  achieved by sharing lower-layer materials." A generic profile-driven assembler **is** a lower-layer
  material (a composition mechanism), not a shared product.

The invariant that keeps this honest: **`agent-product` never imports a concrete transport, presentation,
or the CLI.** It must NOT depend on `agent-transport-tui`, `agent-transport-ws`, or `agent-cli`. Concrete
transports (`WsTransport`), the TUI (`renderApp` / `createDefaultTuiCliAdapter`), remote-control, and the
`createDefault*` I/O adapters stay wired **in `agent-cli`** and are passed *into* the profile as injected
factories. `cli.ts` keeps owning its presentation and mode dispatch; it merely calls `assembleProduct` to
build the neutral runtime materials, then binds its own TUI. That satisfies the layering rules
"Orchestrator/adapter split" (L122) and "Composable material first" (L120): concrete I/O lives in injected
adapters; only the neutral assembly kernel is extracted.

> **This is the load-bearing decision GATE-APPROVAL must test.** If the reviewers judge that a
> profile-driven assembler still counts as a "shared product factory," the fallback is Alternative (iii-b)
> (keep the composition in `agent-cli` and publish only the *materials* + a documented assembly recipe).
> Either way, L129 likely needs a one-line clarification carving out the profile-driven-neutral-assembler
> case — that amendment is proposed here but decided at the gate, not landed unilaterally.

**Dependency direction (no cycles; framework/core untouched):**

```
agent-core / agent-tools         (unchanged, neutral foundation)
  ↑
agent-framework                  (unchanged assembly layer: session/runtime/command contracts)
  ↑            ↑              ↑
agent-preset   agent-capability-pack        (contract + pure merger packages; framework TYPE deps only, no IO)
  ↑            ↑
agent-product                    (NEW neutral assembler: deps = agent-framework + agent-preset + agent-capability-pack)
  ↑
agent-cli                        (product shell: brings concrete transports/TUI/adapters, passes them in a profile)
```

- `agent-capability-pack` placement mirrors the **Preset Package Rule** verbatim: it depends on
  `agent-framework` **for option/contract types only** (`ICommandModule`, `IAgentDefinition`) and on
  `agent-core` for tool types; it declares no classes with IO and must not re-export `agent-framework`. It
  is a *contract + pure `mergeCapabilityPacks`* package, the additive analog of `resolvePreset`.
- `agent-product` sits **above** `agent-command`/`agent-preset`/`agent-capability-pack` and **below**
  `agent-cli`. Its only workspace deps are `agent-framework` (runtime/session assembly entry),
  `agent-preset` (resolver), and `agent-capability-pack` (merger). The concrete `createDefault*` runners,
  `WsTransport`, and TUI are **not** deps — they are injected via the profile.
- The reverse edges (`agent-framework → agent-product`, `agent-product → agent-cli`,
  `agent-product → agent-transport-*`) must never exist; enforced by
  `check-dependency-direction.mjs` (one-way `package.json` edges, no allowlist entry needed — same
  mechanism that governs `agent-preset`).

### Contract sketches (validated/refined at the gate — signatures are directional)

```ts
// @robota-sdk/agent-capability-pack — additive capability bundle (contract + pure merger, mirrors agent-preset)
import type { ICommandModule, IAgentDefinition } from '@robota-sdk/agent-framework';
import type { /* tool factory/definition type */ IToolContribution } from '@robota-sdk/agent-core';

export interface ICapabilityPack {
  id: string;
  title?: string;
  description?: string;
  // All additive, all optional — merged INTO the assembled runtime (never subtractive):
  commandModules?: readonly ICommandModule[];
  tools?: readonly IToolContribution[];
  subagents?: readonly IAgentDefinition[];
}

export interface IMergedCapabilities {
  commandModules: readonly ICommandModule[];
  tools: readonly IToolContribution[];
  subagents: readonly IAgentDefinition[];
}

// Pure, deterministic, IO-free — the additive analog of resolvePreset. Conflict policy (id collision
// across packs) resolved here, mirroring registerExternalPresets' "first wins / report rejection".
export function mergeCapabilityPacks(packs: readonly ICapabilityPack[]): IMergedCapabilities;
```

```ts
// @robota-sdk/agent-product — the product-assembly kernel
import type { IProviderDefinition, IAIProvider } from '@robota-sdk/agent-core';
import type { ICommandModule, IBackgroundTaskRunner, TSubagentRunnerFactory,
              ITransportRegistry, IInteractiveRuntime } from '@robota-sdk/agent-framework';
import type { IPreset } from '@robota-sdk/agent-preset';
import type { ICapabilityPack } from '@robota-sdk/agent-capability-pack';

export interface IProductProfile {
  // (1) identity / branding
  id: string;
  agentName?: string;
  version?: string;

  // (2) provider surface (data — mirrors the published provider DIP; no vendor hardcoded)
  providerDefinitions: readonly IProviderDefinition[];
  providerOverride?: string;

  // (3) behavior axis — external presets to register + the default id
  presets?: readonly IPreset[];
  defaultPresetId?: string;

  // (4) capability axis — additive packs + the product's own base command modules
  packs?: readonly ICapabilityPack[];
  baseCommandModules?: readonly ICommandModule[];

  // (5) injected runtime plumbing (concrete I/O stays product-owned — NOT hardcoded in agent-product)
  backgroundTaskRunners?: readonly IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  transports?: readonly ITransportRegistry[] | ((...) => ITransportRegistry);
}

export interface IAssembledProduct {
  provider: IAIProvider;                       // resolved from providerDefinitions + settings
  commandModules: readonly ICommandModule[];   // baseCommandModules ⊕ merged pack modules
  resolvePreset: (id: string) => /* IResolvedPresetOptions */ unknown;   // bound over registered presets
  buildRuntime: (channelBinding: /* … */ unknown) => IInteractiveRuntime; // neutral runtime; product binds presentation
  // …session store / memory options / transport registry as neutral materials the shell consumes
}

// The single composition function. Product-agnostic: everything product-specific is in `profile`.
export function assembleProduct(profile: IProductProfile): IAssembledProduct;
```

### Responsibility-split invariant (spec invariant, mechanically reviewable)

- **preset = behavior/persona** — persona, systemPrompt, model/effort, permission posture, and
  *subtractive* tool/command selection. (Unchanged `agent-preset`.)
- **pack = capability** — *additive* tools/commands/subagents a consumer brings.
- **profile = product assembly** — branding + packs + preset(s) + provider-defaults + injected plumbing.

A pack must never carry persona/model dials (that is preset territory); a preset must never carry new
tools/commands (that is pack territory); the profile carries neither behavior nor capability *definitions*
— it only *references* them and supplies identity + injected adapters.

Two invariants the prior art makes load-bearing (see `## Prior Art Research`):

- **Packs are opt-in and never self-activate.** Following ESLint ("plugins cannot force a specific
  configuration to be used"), a pack contributes only when the `IProductProfile` lists it. Merge semantics
  are additive concatenation/override, never silent global mutation. `ICapabilityPack` stays **inert,
  introspectable data** so `assembleProduct` can enumerate a pack's contributions and let the
  profile/permission layer gate them *before* activation.
- **"Preset" is deliberately narrowed vs industry usage.** Docusaurus/`create-react-app` "preset" means a
  *bundle of plugins/themes* — i.e. what Robota calls a *pack* + *profile*. ARCH-005 narrows `IPreset` to
  behavior/persona only and splits the bundle role into `ICapabilityPack` (capability) + `IProductProfile`
  (assembly). The published docs must state this narrowing loudly so consumers with the Docusaurus mental
  model are not surprised. A pack SHOULD resolve to the same shape the profile accepts (a "profile
  fragment"), so `assembleProduct` has one uniform merge path.

### API-stability plan (the external product surface)

- Register `@robota-sdk/agent-product` and `@robota-sdk/agent-capability-pack` in the
  **`check-spec-public-surface`** gate (each ships `docs/SPEC.md` with a complete **Public API** table)
  and add their frozen counts to `scripts/harness/spec-surface-baseline.json` — so a new undocumented
  export fails the gate, exactly as for every other published package.
- Both packages follow semver + the `api-boundary` / publish rules; breaking changes to `ICapabilityPack`,
  `IProductProfile`, or `assembleProduct` are gated because external consumers depend on them.
- `IPreset` is already on the published surface; document its external-authoring contract in
  `agent-preset/docs/SPEC.md` and the guide.

### Staged delivery (no big-bang)

- **P0 — pure refactor.** Extract the product-neutral composition kernel from `cli.ts` into
  `agent-product`; `cli.ts` calls `assembleProduct` and keeps its own transport/TUI binding. **`robota`
  behavior byte-identical** (CLI golden + full `agent-cli`/`agent-transport-tui` suites green).
- **P1 — `assembleProduct` + re-express `robota` as a profile.** The CLI's provider/preset/command choices
  become an `IProductProfile` value; publish `agent-product` + document Mode A/B/C imports.
- **P2 — `ICapabilityPack` + first additive pack.** Land `agent-capability-pack` and its first non-coding
  capability pack **when a real second product exists to consume it** (avoids speculative surface).

## Consumption modes → concrete published imports

**Mode A — build a product on `agent-framework` from a separate repo:**

```ts
// external-repo/src/my-assistant.ts
import { assembleProduct } from '@robota-sdk/agent-product';
import { defaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';

const product = assembleProduct({
  id: 'acme-assistant',
  agentName: 'acme',
  providerDefinitions: defaultProviderDefinitions,
  defaultPresetId: 'default',
  // brings no custom packs/presets — just Robota's runtime, their branding + their own shell
});
// external repo binds product.buildRuntime(...) to ITS OWN presentation/transport.
```

**Mode B — author your OWN preset in code and layer it:**

```ts
import { assembleProduct } from '@robota-sdk/agent-product';
import type { IPreset } from '@robota-sdk/agent-preset';
import { defaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';

const acmeReviewer: IPreset = {
  id: 'acme-reviewer', title: 'Acme Reviewer', description: 'strict review persona',
  persona: 'You are a meticulous code reviewer…',
  autonomy: 'ask-first', deniedTools: ['shell'],
};

const product = assembleProduct({
  id: 'acme-review-tool',
  providerDefinitions: defaultProviderDefinitions,
  presets: [acmeReviewer],       // registered via registerExternalPresets under the hood
  defaultPresetId: 'acme-reviewer',
});
```

**Mode C — consume OUR presets + add capability, packaging consumer-style:**

```ts
import { assembleProduct } from '@robota-sdk/agent-product';
import type { ICapabilityPack } from '@robota-sdk/agent-capability-pack';
import { defaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';
// Robota's built-in presets ('default', 'autonomous-builder', 'careful-reviewer', 'neutral-executor')
// are already registered by agent-preset — Mode C just references one by id.

const acmePack: ICapabilityPack = {
  id: 'acme-jira',
  tools: [/* their Jira tool */],
  commandModules: [/* their /jira command module */],
};

const product = assembleProduct({
  id: 'acme-devtool',
  providerDefinitions: defaultProviderDefinitions,
  packs: [acmePack],                 // ADDITIVE capability on top of the base modules
  defaultPresetId: 'careful-reviewer', // OUR preset, reused as-is
});
```

## Alternatives Considered

**(i) Keep the composition in `agent-cli` and tell externals to depend on it.** *Rejected.* Depending on
`agent-cli` pulls a whole product — the Ink TUI (`agent-transport-tui`), `WsTransport`, remote-control,
mode dispatch, first-run/onboarding — none of which an embedded or differently-presented product wants.
It also makes every external product a fork of `startCli`. This is the status quo that defines the gap.

**(ii) Extend `IPreset` to be additive instead of a separate pack layer.** *Weighed, rejected as the
primary axis.* We could add `tools`/`commandModules`/`subagents` to `IPreset`. But it **conflates two
axes** the prior art keeps separate (ESLint config vs plugin; Docusaurus preset-behavior vs plugin; VS
Code settings vs contributions): behavior/persona dials and capability contribution have different
authors, different stability guarantees, and different composition semantics (subtractive vs additive).
Merging them bloats the preset contract, breaks the clean `resolvePreset` merge (which is option-override
math, not module composition), and violates the `Preset Package Rule` ("produces option data only …
performs no session assembly"). A preset *may* reference a pack by id (a thin convenience), but capability
lives in its own contract. Keeping them separate is what the responsibility-split invariant encodes.

**(iii) Where does `assembleProduct` live — `agent-framework` vs a new `agent-product`?**

- *(iii-a) Fold it into `agent-framework`.* **Rejected.** `agent-framework` is the neutral assembly layer
  and must stay free of *product-assembly opinion* (provider-default selection, preset registration,
  capability-pack merging, product identity). Even profile-driven, `assembleProduct` is a higher-altitude
  concern than session/runtime assembly; folding it in blurs the framework's neutrality and would drag the
  `agent-preset`/`agent-capability-pack` dependency *into* the framework (today `agent-preset → framework`,
  never the reverse). A dedicated `agent-product` package keeps the direction clean.
- *(iii-b) Publish only the materials + a documented assembly recipe; no `assembleProduct` at all.*
  **The fallback if GATE-APPROVAL rules against the profile-driven assembler.** Externals would copy an
  assembly recipe from a guide/`examples/` (like the current per-product-assembly rule prescribes). Costs:
  every external product re-implements and must *track* the composition root's evolution by hand — the
  exact maintenance burden `assembleProduct` removes. Chosen only if the reviewers judge a published
  assembler an unacceptable "shared product factory."

**Chosen:** deliverable set (1)+(2)+(3) with `assembleProduct` in a new `agent-product`, contingent on
GATE-APPROVAL affirming the profile-driven-assembler reconciliation of L129.

## Licensing

**Deferred, per owner (2026-07-25): architecture first, license later.** This spec is
**license-agnostic** — none of the composition contracts (`assembleProduct`, `ICapabilityPack`,
`IProductProfile`, `IPreset`) encode or depend on any licensing posture. The repo's dual-license
**AGPL + Commercial (no CLA)** stance is noted only as a **downstream business decision** that governs
*who may consume the published packages under what terms* — it does not shape the technical contracts and
must not be baked into the design. Any consumption-terms enforcement (e.g. commercial-license gating) is
out of scope for ARCH-005 and tracked separately when the owner decides the posture.

## Test Plan

**P0 — pure-refactor equivalence (byte-identical `robota`).**
- `robota` CLI **golden** output tests unchanged and green (help/version/print-mode goldens).
- Full `agent-cli` + `agent-transport-tui` suites green with **zero** behavioral diff.
- Mechanical guard: the P0 extraction is a *move*, not a *change* — reviewers confirm `cli.ts` produces an
  identical runtime assembly through `assembleProduct` (same provider, same command-module set, same
  preset resolution, same transport registry).

**New public surfaces — red-first contract tests.**
- `mergeCapabilityPacks`: additive merge, deterministic order, id-collision policy (red-first: assert the
  merged set contains a pack's contributed module *before* the merger exists).
- `assembleProduct`: profile → assembled materials (provider resolved, base ⊕ pack modules merged,
  external presets registered, `defaultPresetId` honored); neutrality assertion — importing
  `@robota-sdk/agent-product` pulls **no** `agent-transport-*` / `agent-cli` code (dependency-graph test).
- `check-spec-public-surface` baseline entries for both new packages (Public API tables complete).

**External-consumer smoke — the done-gate agent-run evidence.**
A throwaway package **outside the monorepo** that installs the **built tarballs** (`pnpm pack` →
`npm install ./robota-sdk-agent-product-*.tgz …`) and exercises all three modes from truly outside the
workspace:
- **(A)** `assembleProduct` with our packs+preset (Robota runtime, external branding).
- **(B)** `assembleProduct` with a hand-authored `IPreset`.
- **(C)** `assembleProduct` consuming OUR preset by id while adding an `ICapabilityPack`.
The smoke asserts each assembled product builds a runnable runtime and that a pack-contributed
tool/command is actually present in the assembled surface. This proves Modes A/B/C work from a separate
repo against the *published* surface — it is the **agent-run evidence** the done-gate requires (the agent
runs the smoke itself; no owner manual step), per the agent-run capability-verification rule.

**Staging:** P0 (equivalence) → P1 (`assembleProduct` + `robota`-as-profile + Mode A/B smokes) → P2
(`agent-capability-pack` + Mode C smoke + first real pack).

## User Execution Scenarios

- **Scenario 1 (Mode A):** from a fresh out-of-monorepo package, `npm install` the `agent-product` +
  `agent-provider-defaults` tarballs, call `assembleProduct({...})`, and drive one prompt turn through the
  assembled runtime → expect a model response, proving an external product runs on the published kernel.
- **Scenario 2 (Mode B):** same external package registers a hand-authored `IPreset` and selects it →
  expect the assembled session to carry the preset's persona/permission posture.
- **Scenario 3 (Mode C):** same external package adds an `ICapabilityPack` and reuses a Robota built-in
  preset by id → expect the pack's tool/command to appear in the assembled command surface and be
  invocable.

The **external-consumer smoke** (Test Plan) is the backing, agent-run evidence for all three scenarios and
the done-gate; the scenario catalog entry is authored at implementation time under
`.agents/evals/scenarios/` and each backing test is run by the agent itself.
