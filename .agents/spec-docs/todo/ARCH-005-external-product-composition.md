---
status: approved
type: INFRA
tags:
  [
    architecture,
    product-composition,
    agent-product,
    capability-pack,
    preset,
    external-consumer,
    packaging,
  ]
---

# ARCH-005: external product composition — publishable `assembleProduct` + capability-pack + product-profile

> **Type note.** The spec-doc `type` frontmatter is the orthogonal SDLC classification enforced by
> `check-spec-doc-frontmatter.mjs`; `ARCH` is not one of the 11 accepted values, so this document uses
> `type: INFRA` (the same classification the prior architecture spec `ARCH-PROVIDER-001` used). The
> `ARCH-005` filename ID keeps its initiative/domain namespace — only the frontmatter type differs.
>
> **Owner-critical placement call — read `## Decision` § Placement first.** The load-bearing decision is
> whether a _published_ `assembleProduct` can exist without violating the existing
> **"Per-product assembly ownership — no shared product factory"** rule
> (`project-structure.md` L129, `feedback_no_shared_cli_factory`). The reconciliation does **not** rest on
> "profile-driven" alone (a profile-driven function could still accrete `if (profile.id === 'robota')`
> branches and become a de-facto shared factory). It rests on a stronger, **mechanically-enforced pure-fold
> property**: `assembleProduct` is a pure, deterministic, IO-free fold over `IProductProfile` data with zero
> product-specific branching — a peer of the repo's already-blessed `resolvePreset` / `mergeSettings` /
> `mergeCapabilityPacks`. See `## Decision` § "The pure-fold property".
>
> **GATE-APPROVAL outcome (2026-07-25):** both independent reviewers (`proposal-reviewer` +
> `architecture-auditor`) **endorsed the direction** and returned **REVISE** with a convergent set of
> contract/justification refinements (folded into this spec — see the `[GATE-APPROVAL]` Evidence Log
> entry). The L129 rule amendment carving out the pure-fold assembler is **coupled to the P0 guards** that
> make it safe and lands _with_ P0 — flagged as a governance change for owner visibility.

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

A _product-neutral composition kernel_ — the glue that turns those libraries into runtime materials — is
**hand-wired inside `packages/agent-cli/src/cli.ts`** (`startCli`) and is **not** exposed by any published
package. This is **not** "extract the ~502-line `startCli`": most of `startCli` is legitimate
**product-shell** — arg parsing, settings/file IO, terminal notices, first-run onboarding,
`init`/`--configure`/`ensureConfig`, memory/session-resume UX, and print/serve/TUI mode dispatch — all of
which **stay in `agent-cli`**. The extractable kernel is the narrow neutral subset enumerated below (the
`## Decision` § "In-kernel vs stays-in-shell" table draws the exact boundary). The value is **not**
proportional to lines moved; it is that the neutral subset becomes a published, reusable library. What that
neutral kernel currently wires (file `packages/agent-cli/src/cli.ts`):

| Concern                         | Wired at               | What it does                                                                                                                                                                                                      |
| ------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preset registration             | `cli.ts:221`           | `loadExternalPresets()` — registers `~/.robota/presets/*.json` before resolution                                                                                                                                  |
| Preset resolution               | `cli.ts:225-235`       | `resolveCliPreset(args, settingsPreset)` + `selectPresetId(...)` → `IResolvedPresetOptions`                                                                                                                       |
| Command modules + provider defs | `cli.ts:237-251`       | `buildCommandSetup(...)` (`startup/command-setup.ts`) → `{ providerDefinitions, commandModules, commandHostAdapters, remoteCommandPolicy, … }`, threaded with the preset's `enabled/disabledCommandModules` delta |
| Transport registry              | `cli.ts:255`, `99-119` | `createDefaultTransportRegistry()` — constructs `TransportRegistry` and registers a concrete `WsTransport` (reads `ROBOTA_WS_TOKEN`/`ROBOTA_WS_PORT`)                                                             |
| Remote-control controller       | `cli.ts:256-258`       | `createRemoteControlController(registry)` + `buildRemoteControlHostAdapter(...)`                                                                                                                                  |
| Provider construction           | `cli.ts:304-322`       | `readProviderSettings` + `createProviderFromSettings(...)` (or `loadReplayProvider` for `--session-log`)                                                                                                          |
| Background runners              | `cli.ts:323`           | `createDefaultBackgroundTaskRunners()` (from `agent-executor`, via the composition-root import exemption)                                                                                                         |
| Subagent runner factory         | `cli.ts:325-330`       | `createChildProcessSubagentRunnerFactory({ workerPath, providerConfig, logsDir, worktreeAdapter })`                                                                                                               |
| Session store + resume          | `cli.ts:332-348`       | `createProjectSessionStore(cwd)` + resume/continue/fork resolution                                                                                                                                                |
| Memory switch                   | `cli.ts:353-360`       | `resolveMemoryEnablement(...)` → `buildMemorySessionOptions(...)`                                                                                                                                                 |
| Presentation / mode dispatch    | `cli.ts:363-500`       | `runPrintMode` / `runServeMode` / `renderApp` + `createDefaultTuiCliAdapter` (the TUI)                                                                                                                            |

So an external repo that wants "their own product" faces a false choice: **reimplement this entire
composition root**, or **depend on the whole `agent-cli` product** (dragging in the Ink TUI, remote
control, the WS transport, and every CLI-only concern). Neither serves Mode A/B/C. That missing
published composition kernel is **the single linchpin gap**.

### Secondary gap 1 — presets are subtractive, not additive

`IResolvedPresetOptions` (`preset-types.ts:32-78`) expresses tool/command _selection over a superset the
product already hardcodes_: `allowedTools` / `deniedTools` (allow/deny lists) and
`enabledCommandModules` / `disabledCommandModules` (names filtered against the modules `buildCommandSetup`
already assembled). A preset **cannot bring its own** tool, command module, or subagent — it can only
narrow what the host product already offers. So an external "assistant" product that needs a _new_
capability set has no compositional axis; presets are behavior dials, not capability bundles. This is by
design (`Preset Package Rule`: "produces option data only … performs no session assembly") — the additive
axis is simply missing from the published surface.

### Secondary gap 2 — no product identity/manifest unit

There is no published unit that ties **branding + capability packs + preset + provider-defaults** together
into one declarative "this is my product" object. Today that identity is implicit, scattered across
`cli.ts` argument handling, `DEFAULT_AGENT_NAME` (`agent-preset`), and settings. An external product has
nowhere to _declare_ itself.

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

_Teaches Robota:_ this is the single closest analog to `assembleProduct(profile) -> runtime`. The
composition root is a published function (`createBackend` from `@backstage/backend-defaults`) that a
_separate_ repo imports and wires; the product owner assembles by additively `add()`-ing published
packages, not by editing the framework. The plugin/module/service split validates Robota's
pack-vs-preset-vs-profile separation: packs = "standalone features" (Backstage plugins), presets =
"override behavior" (Backstage services), and the profile is the `createBackend()`-equivalent assembly
list. Note the invariant that a module (augmentation) requires its target plugin present — Robota's packs
that extend other packs should carry an explicit dependency contract, not silent ordering.

**2. Docusaurus — presets (a preset _is_ a bundle of plugins + themes)**
Docs: https://docusaurus.io/docs/using-plugins (presets section)

> "Presets are bundles of plugins and themes."

A preset is a constructor returning a composition object in the same shape the site config accepts: a
preset "should return an object of `{ plugins: PluginConfig[], themes: PluginConfig[] }`" in the same
format accepted in site configuration.

_Teaches Robota:_ the industry meaning of "preset" is broader than Robota's proposed narrow one. In
Docusaurus a preset bundles _capability_ units (plugins/themes) — i.e., it does what Robota is calling a
_pack_ + _profile_. This is the key **naming-collision** constraint: Robota is deliberately splitting
Docusaurus's single "preset" concept into three (behavior-preset, capability-pack, product-profile). The
doc supports the split's mechanism — a preset resolves to a plain composition object in the _same format_
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

_Teaches Robota:_ the `ICapabilityPack` contract should look exactly like ESLint's plugin object — a plain
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

_Teaches Robota:_ this is the strongest AI-agent-domain precedent and it matches Robota's target shape
almost exactly — a single composition function (`query`/`assembleProduct`) takes a profile-like options
object, and capability arrives as additive bundles (a `plugins` bundle that carries "skills, agents,
hooks, and MCP servers" is precisely an `ICapabilityPack` of "tools/commands/subagents"). It also
validates the neutrality invariant: the core loop ships with built-in tools but extension is purely
additive through options — the library never hard-wires a particular product's capability set.

**5. VS Code — contribution points (capability contribution is declarative + host-isolated)** _(supporting reference)_
Docs: https://code.visualstudio.com/api/references/contribution-points

> "Contribution Points are a set of JSON declarations that you make in the `contributes` field of the `package.json` Extension Manifest. Your extension registers Contribution Points to extend various functionalities within Visual Studio Code."

_Teaches Robota — with an important caveat on the analogy's limits._ VS Code's model expresses contribution
_declaratively_ (a `package.json` manifest the host reads without running the contributor's code) because it
crosses a **serialization boundary** (a separately-installed extension in another process). **Robota packs
do NOT cross that boundary.** An `ICapabilityPack` is an **in-process composition argument** carrying
**executable code objects** — `ICommandModule.name` with `systemCommands` handlers
(`command-module.ts:8-20`), tools with `execute` functions, and profile factory functions. So VS Code's
"enumerable without running contributor code" property (and the no-function-across-serialization criterion
that comes with it) is **simply N/A** to Robota — the pack is not a serialized manifest but a live
composition value. What DOES carry over is the _structural_ lesson: a pack is a plain record of **named
capability buckets** (tools/commands/subagents) that `assembleProduct` can **enumerate** and hand to the
profile/permission layer, so that contributed commands/tools **execute only through the existing
permission-gated runtime (`PermissionEnforcer`) at call time** — never by the mere act of being merged.
That is the honest safety property (see the responsibility-split invariants below), not "inert JSON".

### Common shape across the references

All five converge on the same three-layer productization pattern:

1. **A published contract layer** — a plain data record of named capability buckets (ESLint plugin's
   `{configs, rules, processors}`; Backstage plugin/module; Claude SDK `plugins` = skills/agents/hooks/MCP;
   VS Code `contributes` JSON). No IO, no lifecycle — just declarations. This is Robota's `ICapabilityPack`.
2. **A composition function / composition root** — one published entry that turns declarations into a
   running product (`createBackend()...start()`; Docusaurus preset constructor → config object; Claude SDK
   `query(options)`). This is Robota's `assembleProduct(profile)`.
3. **Additive capability packs** — capability arrives by _adding_ bundles, never by editing the kernel;
   bundles may themselves aggregate sub-units (Docusaurus preset bundles plugins+themes; ESLint plugin
   bundles configs+rules; Claude `plugins` bundle multiple kinds).

### Constraints/lessons that apply to Robota

- **Additive, not subtractive, and opt-in.** ESLint is explicit: "Plugins cannot force a specific
  configuration to be used. Users must manually include a plugin's configurations." A capability pack must
  not self-activate; the product-profile is the sole authority on what is enabled. Merge semantics should
  be concatenation/override (flat-config style), not silent global mutation.
- **Contract layer must stay IO-free — but "IO-free" ≠ "inert JSON".** Every contract precedent (ESLint
  plugin object, VS Code `contributes` JSON, Backstage plugin declaration) performs no IO/lifecycle at
  contribution time. `@robota-sdk/agent-capability-pack` matches that _at the package level_ (the package
  declares no classes with IO and does no side-effects on import). But unlike VS Code's serialized manifest,
  a Robota pack **carries executable code objects** (command handlers, tool `execute` fns) as an in-process
  composition argument — it is a live value, not a serialized declaration. The honest safety property is
  therefore **not** "no code, just JSON" but: **packs are OPT-IN (present only when the profile lists them),
  `assembleProduct` merges them purely (no execution), and any contributed command/tool runs ONLY through
  the existing permission-gated runtime (`PermissionEnforcer`) at call time** — preserving the
  "framework/core stay neutral" invariant and the existing permission/profile gating.
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
   `assembleProduct(profile)` as a **pure, deterministic, IO-free fold** over `IProductProfile` data (a peer
   of `resolvePreset` / `mergeSettings` / `mergeCapabilityPacks`; see § "The pure-fold property"). Extract
   the _product-neutral_ composition of runtime materials out of `cli.ts` into that pure library; `agent-cli`
   becomes a thin caller that resolves settings/args/env and binds its own presentation. **(Mode A gateway.)**
2. **`@robota-sdk/agent-capability-pack` (new, published)** — the `ICapabilityPack` contract + a pure
   registry merger. Tool/command/subagent bundles as the _additive_ composition unit. Mirrors
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

- The **rejected `createCliAgent`** (TEST-008, cancelled by owner) was a factory that baked _the CLI's
  own_ provider/preset/command/TUI choices into a reusable utility — "call this to get **the CLI's**
  wiring." That shares _a product's assembly_.
- **`assembleProduct(profile)`** ships _no product_. It is a **product-agnostic mechanism** whose entire
  product identity — branding, provider surface, presets, capability packs, and the concrete
  transport/presentation adapters — arrives as the `IProductProfile` **data argument**. `robota` becomes
  _one_ profile among many; an external repo brings its own. This is precisely the rule's own remedy —
  "the reusable, product-agnostic capability lives in the framework/transport layers" and "reuse is
  achieved by sharing lower-layer materials." A **pure, IO-free, data-driven assembler that hard-codes no
  product's choices is** a lower-layer material (a composition mechanism), not a shared product.

The carve-out rests on the pure-fold property below — **not** on "profile-driven" alone.

The invariant that keeps this honest: **`agent-product` never imports a concrete transport, presentation,
or the CLI.** It must NOT depend on `agent-transport-tui`, `agent-transport-ws`, or `agent-cli`. Concrete
transports (`WsTransport`), the TUI (`renderApp` / `createDefaultTuiCliAdapter`), remote-control, and the
`createDefault*` I/O adapters stay wired **in `agent-cli`** and are passed _into_ the profile as injected
factories. `cli.ts` keeps owning its presentation and mode dispatch; it merely calls `assembleProduct` to
build the neutral runtime materials, then binds its own TUI. That satisfies the layering rules
"Orchestrator/adapter split" (L122) and "Composable material first" (L120): concrete I/O lives in injected
adapters; only the neutral assembly kernel is extracted.

### The pure-fold property — what makes the carve-out safe (R1)

"Profile-driven" is **not sufficient**: a profile-driven function could still accrete
`if (profile.id === 'robota') { … }` branches and quietly become a de-facto shared product factory — the
exact thing L129 forbids. The carve-out therefore rests on a stronger, **mechanically-enforced** property:

> **`assembleProduct` is a PURE, deterministic, IO-free fold over `IProductProfile` DATA, with ZERO
> product-specific branching.** It reads only its argument, calls only pure sub-folds
> (`resolvePreset` / `mergeSettings` / `mergeCapabilityPacks`) and the framework's runtime-construction
> seam, and returns assembled materials. It is a **peer** of the repo's already-blessed pure folds
> (`resolve-preset.ts` `resolvePreset`, `command-api/provider/provider-merge.ts` `mergeSettings`), which
> the architecture already accepts as neutral lower-layer materials.

This property is enforced at **P0** by **three mechanical guards** (all landing with the extraction):

1. **(a) Dependency-graph neutrality.** `agent-product`'s `package.json` declares **no** concrete
   transport/TUI/agent-cli dependency (`agent-transport-*`, `agent-cli`) — enforced by
   `check-dependency-direction.mjs` plus the neutrality dependency-graph test in the Test Plan (importing
   `@robota-sdk/agent-product` pulls no `agent-transport-*` / `agent-cli` code).
2. **(b) Purity / no-IO assertion.** No `fs`, settings-file, or `process.env` read inside `agent-product` —
   all resolved data (settings values, env, args) is fed IN from the shell. Enforced by a source scan over
   the package (`node:fs`/`process.env`/settings-reader imports are disallowed) so the fold cannot silently
   acquire IO.
3. **(c) No product-name conditionals.** A guard forbids product-identity conditionals in `agent-product`
   source (e.g. a `profile.id === '…'` / `agentName === '…'` branch), so the fold cannot special-case any
   one product. This is what upgrades "profile-driven" into "hard-codes no product's choices".

**Proposed L129 amendment (precise wording — lands WITH P0, coupled to the guards above):** carve out

> "a **pure, IO-free, data-driven assembler that hard-codes no product's choices**"

— explicitly **NOT** "profile-driven assemblers" generally (which would re-open the hole). The amendment is
deliberately coupled to guards (a)/(b)/(c): the rule relaxation is only ever true while the mechanical
guards hold, so the rule and its enforcement land together, not the rule alone.

> **Governance flag (owner visibility).** Editing L129 (`feedback_no_shared_cli_factory` in
> `project-structure.md`) is a **governance change** to a mandatory rule. It is proposed here and, per the
> GATE-APPROVAL outcome, lands **with P0** (bundled with guards (a)/(b)/(c)) rather than unilaterally
> ahead of them. If the guards cannot be made to hold, the fallback is Alternative (iii-b) (publish only
> the materials + a documented assembly recipe, no `assembleProduct`) and L129 stays unchanged.

### Single-runtime-seam invariant — reconcile with RUNTIME-001 (R2)

`agent-product` MUST **delegate runtime construction** to `agent-framework`'s existing seam —
`buildRuntimeSession` / `createInteractiveRuntime` / `startRuntimeHost`
(`packages/agent-framework/src/runtime/runtime-host.ts:11-15`,
`interaction/createInteractiveRuntime.ts:103`) — and **NEVER re-implement it.** RUNTIME-001 already decided
that the neutral runtime host lives in the framework, "NOT the product shell (`agent-cli`) and NOT a new
package: it is presentation/product-neutral (takes already-resolved options; settings/first-run/preset
resolution stay in the consumer)."

The reconciliation, so there is **no competing runtime-construction SSOT**:

- `buildRuntimeSession`/`startRuntimeHost` (framework) = the **runtime-construction seam** — takes
  _already-resolved_ `TInteractiveSessionOptions`. This does not move.
- `assembleProduct` (agent-product) = the **preset/pack/provider-DEFINITION fold that sits ABOVE that
  seam** — it resolves presets, merges capability packs, and constructs the provider from
  `IProviderDefinition[]` + resolved settings, then feeds the result INTO `buildRuntimeSession`. The
  framework itself cannot host this fold because it would require the framework to depend on
  `agent-preset` / `agent-capability-pack`, reversing the one-way `preset → framework` edge.
- **Settings / args / env resolution STILL stays in the shell (`cli.ts`).** `agent-product` receives
  already-resolved data (per guard (b)); it never reads settings/env itself. So the three layers are
  disjoint: shell resolves inputs → `assembleProduct` folds definitions into materials → framework's seam
  constructs the runtime. Each concern has exactly one owner.

> **This was the load-bearing decision GATE-APPROVAL tested — both reviewers endorsed it.** If a future
> reviewer were to judge that even a pure-fold assembler counts as a "shared product factory," the fallback
> is Alternative (iii-b) (keep the composition in `agent-cli` and publish only the _materials_ + a
> documented assembly recipe). The L129 amendment above is the coupled governance change; it lands with P0,
> not unilaterally.

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
  `agent-core` for the real tool contract (`FunctionTool`, `agent-core/src/index.ts:175` — R7b, NOT a
  nonexistent `IToolContribution`); it declares no classes with IO and must not re-export `agent-framework`.
  It is a _contract + pure `mergeCapabilityPacks`_ package, the additive analog of `resolvePreset`.
- `agent-product` sits **above** `agent-command`/`agent-preset`/`agent-capability-pack` and **below**
  `agent-cli`. Its only workspace deps are `agent-framework` (runtime/session assembly entry),
  `agent-preset` (resolver), `agent-capability-pack` (merger), and **type-only** `agent-interface-transport`
  (the `ITransportRegistryView` view interface — re-exportable via framework; the concrete
  `TransportRegistry` class in `agent-transport` is NOT a dep). The concrete `createDefault*` runners,
  `WsTransport`, and TUI are **not** deps — they are injected via the profile.
- The reverse edges (`agent-framework → agent-product`, `agent-product → agent-cli`,
  `agent-product → agent-transport-*`) must never exist; enforced by
  `check-dependency-direction.mjs` (one-way `package.json` edges, no allowlist entry needed — same
  mechanism that governs `agent-preset`).

### In-kernel vs stays-in-shell — the extraction boundary (R3/R4)

The value of ARCH-005 is **not** proportional to lines moved out of `cli.ts`. Most of `startCli` is
legitimate product-shell and **stays in `agent-cli`**. Only the narrow product-neutral subset moves into
`agent-product`. The boundary is drawn precisely so reviewers can confirm the kernel is **closed over
data**:

| Concern                                                                                                                        | Destination                                             | Rationale                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| External-preset registration + preset-resolve glue (`loadExternalPresets` result → per-call resolver)                          | **In-kernel** (`agent-product`)                         | pure fold over preset DATA (settings/file read happens in shell, result passed in) |
| Command-module selection / merge glue                                                                                          | **In-kernel**                                           | pure selection over module DATA                                                    |
| `mergeCapabilityPacks` (additive pack merge)                                                                                   | **In-kernel**                                           | pure fold, additive analog of `resolvePreset`                                      |
| Provider construction FROM `IProviderDefinition[]` + already-resolved settings                                                 | **In-kernel**                                           | pure over definitions + injected settings data (no settings-file read)             |
| Runtime-build **delegation** to `buildRuntimeSession`/`startRuntimeHost`                                                       | **In-kernel** (delegates, never re-implements — see R2) | single framework seam                                                              |
| `init` / `--configure` / `ensureConfig` flows                                                                                  | **Stays-in-shell** (`agent-cli`)                        | interactive IO, file writes                                                        |
| All `terminal.write*` notices / first-run onboarding                                                                           | **Stays-in-shell**                                      | presentation                                                                       |
| Session resume / continue / fork UX                                                                                            | **Stays-in-shell**                                      | interactive UX + store IO                                                          |
| Arg parsing; settings/env reads                                                                                                | **Stays-in-shell**                                      | resolves inputs, feeds resolved DATA into the kernel                               |
| Mode dispatch (print / serve / TUI) + `process.exit`                                                                           | **Stays-in-shell**                                      | presentation + process lifecycle                                                   |
| Concrete transports (`WsTransport`), TUI (`renderApp`/`createDefaultTuiCliAdapter`), remote-control, `createDefault*` adapters | **Stays-in-shell** (injected into the profile)          | concrete I/O adapters                                                              |

**The DATA seam (what crosses into `assembleProduct` vs what stays behind — R4).** Everything the kernel
consumes is plain, already-resolved DATA supplied by the shell; nothing the kernel does reaches back out to
IO. **Crosses IN** (as `IProductProfile` fields): identity/branding values, `IProviderDefinition[]` +
already-resolved provider settings, `IPreset[]` + `defaultPresetId`, `ICapabilityPack[]` +
`baseCommandModules`, and injected plumbing (`backgroundTaskRunners`, `subagentRunnerFactory`,
`transports`). **Stays in `cli.ts`** (never crosses): the settings/env/arg _reads_ that produce those
values, all `terminal.write*`, first-run/onboarding, mode dispatch, and `process.exit`. Because the seam is
closed over data, the P0 refactor can be verified as a pure move (below).

**P0 byte-identical claim — scoped (R4).** The "byte-identical pure-refactor" bar applies to **the extracted
neutral subset only** (the In-kernel rows): after the move, `cli.ts` must produce an **identical runtime
assembly** through `assembleProduct` — same provider, same command-module set, same preset resolution, same
transport registry — with **zero** behavioral diff. The done-gate is unchanged: `robota` CLI golden + full
`agent-cli` + `agent-transport-tui` suites green + reviewer confirmation that the assembled runtime is
identical.

### Contract sketches (validated/refined at the gate — signatures are directional)

```ts
// @robota-sdk/agent-capability-pack — additive capability bundle (contract + pure merger, mirrors agent-preset)
import type { ICommandModule, IAgentDefinition } from '@robota-sdk/agent-framework';
// R7(b): the tool field targets a REAL agent-core tool contract — `FunctionTool` / the tool-registration
// definition (`agent-core/src/index.ts:175`, exported alongside `ToolRegistry`). There is NO
// `IToolContribution` type; using a real contract is load-bearing for the acyclicity claim and is resolved
// BEFORE P1 (not deferred to the gate).
import type { FunctionTool } from '@robota-sdk/agent-core';

export interface ICapabilityPack {
  id: string;
  title?: string;
  description?: string;
  // All additive, all optional — merged INTO the assembled runtime (never subtractive):
  commandModules?: readonly ICommandModule[];
  tools?: readonly FunctionTool[];
  subagents?: readonly IAgentDefinition[];
}

// R5: mirror IPresetRegistrationResult (resolve-preset.ts:60-95) — return the merged set AND a rejection
// channel, never a bare array. `ICommandModule.name` and tool names can collide across packs, against
// `baseCommandModules`, and against a preset's enabled/disabledCommandModules delta.
export interface IMergedCapabilities {
  merged: {
    commandModules: readonly ICommandModule[];
    tools: readonly FunctionTool[];
    subagents: readonly IAgentDefinition[];
  };
  rejected: readonly { kind: 'commandModule' | 'tool' | 'subagent'; id: string; reason: string }[];
}

// Pure, deterministic, IO-free — the additive analog of resolvePreset.
// Precedence (ONE order, no silent override): `baseCommandModules` < packs in profile order. A later id
// (across packs, or colliding with a base module / earlier pack) that duplicates an already-claimed id is
// REJECTED and reported in `rejected` — NEVER silently overridden (mirrors registerExternalPresets'
// "first registration wins / report rejection"). The preset's enabled/disabledCommandModules delta is
// applied AFTER this merge by `buildCommandSetup` as it does today — this merger only produces the base
// ⊕ pack superset that the preset delta then filters; the two compose, they do not fight.
export function mergeCapabilityPacks(
  baseCommandModules: readonly ICommandModule[],
  packs: readonly ICapabilityPack[],
): IMergedCapabilities;
```

```ts
// @robota-sdk/agent-product — the product-assembly kernel
import type { IProviderDefinition, IAIProvider } from '@robota-sdk/agent-core';
import type {
  ICommandModule,
  IBackgroundTaskRunner,
  TSubagentRunnerFactory,
  IInteractiveRuntime,
} from '@robota-sdk/agent-framework';
// R7(a): the transports field targets the READ-ONLY registry VIEW interface
// `ITransportRegistryView` (from `@robota-sdk/agent-interface-transport`,
// `transport-config.ts:24`; re-exportable via agent-framework). There is NO `ITransportRegistry` type;
// the concrete `TransportRegistry` CLASS lives in `agent-transport` and must NOT be a dep of agent-product.
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';
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
  transports?: ITransportRegistryView | (() => ITransportRegistryView);
}

export interface IAssembledProduct {
  provider: IAIProvider; // resolved from providerDefinitions + settings
  commandModules: readonly ICommandModule[]; // baseCommandModules ⊕ merged pack modules (see mergeCapabilityPacks)
  rejectedCapabilities: readonly { kind: string; id: string; reason: string }[]; // surfaced from the merge
  // R8: a PER-CALL (instance-scoped) resolver bound over THIS profile's presets. `assembleProduct` MUST
  // NOT mutate agent-preset's module-level `externalPresets` global (resolve-preset.ts:46,76-103): two
  // products in one process would share one registry and repeat calls would accumulate / hit duplicate-id
  // rejections. The fold builds its own instance-scoped registry, keeping it pure w.r.t. process state
  // (reinforcing the R1 purity property). Single-product-per-process is NOT assumed.
  resolvePreset: (id: string) => /* IResolvedPresetOptions */ unknown;
  buildRuntime: (channelBinding: /* … */ unknown) => IInteractiveRuntime; // DELEGATES to buildRuntimeSession (R2)
  // …session store / memory options / transport registry as neutral materials the shell consumes
}

// The single composition function — a PURE, deterministic, IO-free fold (R1). Product-agnostic:
// everything product-specific is in `profile`; it reads no settings/env/fs and hard-codes no product's id.
export function assembleProduct(profile: IProductProfile): IAssembledProduct;
```

### Responsibility-split invariant (spec invariant, mechanically reviewable)

- **preset = behavior/persona** — persona, systemPrompt, model/effort, permission posture, and
  _subtractive_ tool/command selection. (Unchanged `agent-preset`.)
- **pack = capability** — _additive_ tools/commands/subagents a consumer brings.
- **profile = product assembly** — branding + packs + preset(s) + provider-defaults + injected plumbing.

A pack must never carry persona/model dials (that is preset territory); a preset must never carry new
tools/commands (that is pack territory); the profile carries neither behavior nor capability _definitions_
— it only _references_ them and supplies identity + injected adapters.

Two invariants the prior art makes load-bearing (see `## Prior Art Research`):

- **Packs are opt-in; contributed code runs only through the permission-gated runtime.** Following ESLint
  ("plugins cannot force a specific configuration to be used"), a pack contributes only when the
  `IProductProfile` lists it. A pack is **not "inert JSON"** — it carries **executable code objects**
  (`ICommandModule` with `systemCommands` handlers, tools with `execute` fns; the profile also carries
  factory fns), passed as an **in-process composition argument** (not a serialization boundary, so the
  no-function-across-serialization criterion is **N/A** — see the VS Code prior-art caveat). The honest
  safety property is: **the merge is pure (`assembleProduct` executes none of that code); a contributed
  command/tool runs ONLY through the existing permission-gated runtime (`PermissionEnforcer`) at call
  time.** `assembleProduct` enumerates a pack's contributions so the profile/permission layer gates them
  _before_ activation; merge semantics are additive concatenation/override with an explicit rejection
  channel, never silent global mutation.
- **The merge has ONE precedence order and a rejection channel (R5).** `mergeCapabilityPacks` returns
  `{ merged, rejected }` (mirroring `IPresetRegistrationResult`). Order: `baseCommandModules` < packs in
  profile order; a later id that duplicates an already-claimed id is rejected+reported, never silently
  overridden. This runs _before_ the preset's enabled/disabledCommandModules delta that `buildCommandSetup`
  already applies — the merge produces the base ⊕ pack superset, the preset delta then filters it; they
  compose.
- **Runtime construction is delegated, never re-implemented (R2).** `assembleProduct` DELEGATES to
  `agent-framework`'s `buildRuntimeSession` / `createInteractiveRuntime` / `startRuntimeHost`
  (`runtime-host.ts:11-15`) — there is no competing runtime-construction SSOT. The fold sits ABOVE that
  seam (preset/pack/provider-definition resolution); settings/args/env resolution stays in the shell.
- **The preset registry is per-call, not a mutated global (R8).** `assembleProduct` builds an
  instance-scoped preset resolver over the profile's presets; it MUST NOT push into agent-preset's
  module-level `externalPresets` array (`resolve-preset.ts:46,76-103`), so two products in one process do
  not share one registry and repeat calls do not accumulate. This keeps the fold pure w.r.t. process state.
- **"Preset" is deliberately narrowed vs industry usage.** Docusaurus/`create-react-app` "preset" means a
  _bundle of plugins/themes_ — i.e. what Robota calls a _pack_ + _profile_. ARCH-005 narrows `IPreset` to
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

### Staged delivery (owner-directed FULL vertical slice — 2026-07-25, supersedes the P0/P1/P2 plan below)

> **Owner directive (2026-07-25):** "정석대로 처리하고, 지름길을 찾지 말고 레거시를 보존하지 말 것 — 크게
> 리팩터링하더라도 올바른 방향으로." The target is the **correct end-state**, not a minimal-diff carve-out
> that leaves a hand-wired composition root in place. `agent-cli` becomes a **genuinely thin product-shell**
> (arg parsing, terminal IO, onboarding, mode dispatch only); the old composition root is **fully removed**
> — no compat shim, no parallel old path. The capability-pack is **not deferred**: **`robota` itself is
> re-expressed as an `IProductProfile` composed from a real `pack-coding`**, which IS the pack's first
> consumer (dogfooding — "robota builds robota"), so the additive surface is validated, not speculative.
>
> The correctness guards are **kept in full** (they protect the layered architecture, they are not
> shortcuts): RUNTIME-001 delegation to the framework runtime seam; the pure-fold property + the three
> mechanical guards; the coupled L129 amendment; and **end-user `robota` behavior identical** (CLI golden +
> full suites) — _regression prevention_, not legacy preservation (internals rebuilt correctly; only the
> observable CLI behavior held invariant).

Staged into reviewable PRs, but **each stage lands correct structure — never a half-migrated placeholder**:

- **S1 — new composition layer (additive; no `cli.ts` change yet).** `@robota-sdk/agent-capability-pack`
  (`ICapabilityPack` + `mergeCapabilityPacks` → `{ merged, rejected }`, precedence defined) and
  `@robota-sdk/agent-product` (`assembleProduct`: pure/no-IO/no-product-branch fold that **delegates runtime
  construction to the framework seam**), plus extract the coding toolset/commands/subagents into
  **`pack-coding`**. All-new packages, red-first contract tests, registered in `check-spec-public-surface`.
  Lands the three R1 guards + the L129 amendment (governance-flagged). Independent architecture review
  before S2.
- **S2 — re-express `robota` as a profile + collapse `cli.ts` to a thin shell.** `robota`'s
  provider/preset/command/subagent choices become an `IProductProfile` assembled via
  `assembleProduct({ packs: [packCoding], … })`; the old hand-wired composition root in `cli.ts` is
  **deleted**, leaving only the product-shell (per the In-kernel/stays-in-shell table). **`robota` behavior
  byte-identical** (CLI golden + full `agent-cli`/`agent-transport-tui` suites; reviewer confirms an
  identical assembled runtime). This is where "no legacy preservation" bites — full migration, not
  additive-alongside. Sequenced AFTER the in-flight NEUT-005-remainder `cli.ts` change merges (conflict
  avoidance).
- **S3 — external-consumer proof (done-gate).** A throwaway package **outside the monorepo** installs the
  `pnpm pack` tarballs and exercises Modes A/B/C (our packs+preset / a hand-authored `IPreset` / our preset
  by id + a custom pack) — the agent-run evidence that closes the done-gate.

<details><summary>Superseded conservative staging (pre-owner-directive, kept for provenance)</summary>

- **P0 — pure refactor + the guards + the coupled L129 amendment.** Extract _only the neutral In-kernel
  subset_ from `cli.ts`; `cli.ts` keeps its own transport/TUI binding and mode dispatch. (Superseded: this
  left the hand-wired root largely in place — the owner directed a full migration instead.)
- **P1 — `assembleProduct` + re-express `robota` as a profile.** (Now folded into S2.)
- **P2 — `ICapabilityPack` + first additive pack, deferred until a second product exists.** (Superseded:
  `robota`-as-profile via `pack-coding` is the real first consumer, so the pack is no longer deferred.)

</details>

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
  id: 'acme-reviewer',
  title: 'Acme Reviewer',
  description: 'strict review persona',
  persona: 'You are a meticulous code reviewer…',
  autonomy: 'ask-first',
  deniedTools: ['shell'],
};

const product = assembleProduct({
  id: 'acme-review-tool',
  providerDefinitions: defaultProviderDefinitions,
  presets: [acmeReviewer], // resolved via a PER-CALL instance-scoped registry (R8) — not a global mutation
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
  packs: [acmePack], // ADDITIVE capability on top of the base modules
  defaultPresetId: 'careful-reviewer', // OUR preset, reused as-is
});
```

## Alternatives Considered

**(i) Keep the composition in `agent-cli` and tell externals to depend on it.** _Rejected._ Depending on
`agent-cli` pulls a whole product — the Ink TUI (`agent-transport-tui`), `WsTransport`, remote-control,
mode dispatch, first-run/onboarding — none of which an embedded or differently-presented product wants.
It also makes every external product a fork of `startCli`. This is the status quo that defines the gap.

**(ii) Extend `IPreset` to be additive instead of a separate pack layer.** _Weighed, rejected as the
primary axis._ We could add `tools`/`commandModules`/`subagents` to `IPreset`. But it **conflates two
axes** the prior art keeps separate (ESLint config vs plugin; Docusaurus preset-behavior vs plugin; VS
Code settings vs contributions): behavior/persona dials and capability contribution have different
authors, different stability guarantees, and different composition semantics (subtractive vs additive).
Merging them bloats the preset contract, breaks the clean `resolvePreset` merge (which is option-override
math, not module composition), and violates the `Preset Package Rule` ("produces option data only …
performs no session assembly"). A preset _may_ reference a pack by id (a thin convenience), but capability
lives in its own contract. Keeping them separate is what the responsibility-split invariant encodes.

**(iii) Where does `assembleProduct` live — `agent-framework` vs a new `agent-product`?**

- _(iii-a) Fold it into `agent-framework`._ **Rejected.** `agent-framework` is the neutral assembly layer
  and must stay free of _product-assembly opinion_ (provider-default selection, preset registration,
  capability-pack merging, product identity). Even as a pure fold, `assembleProduct` is a higher-altitude
  concern than session/runtime assembly; folding it in blurs the framework's neutrality and would drag the
  `agent-preset`/`agent-capability-pack` dependency _into_ the framework (today `agent-preset → framework`,
  never the reverse) — the same one-way edge RUNTIME-001 preserves for the runtime host (R2). A dedicated
  `agent-product` package keeps the direction clean.
- _(iii-b) Publish only the materials + a documented assembly recipe; no `assembleProduct` at all._
  **The fallback if the pure-fold guards cannot be made to hold.** Externals would copy an
  assembly recipe from a guide/`examples/` (like the current per-product-assembly rule prescribes). Costs:
  every external product re-implements and must _track_ the composition root's evolution by hand — the
  exact maintenance burden `assembleProduct` removes. Chosen only if the R1 guards (a)/(b)/(c) prove
  infeasible, i.e. a pure IO-free assembler that hard-codes no product's choices cannot be enforced.

**Chosen:** deliverable set (1)+(2)+(3) with `assembleProduct` in a new `agent-product`. GATE-APPROVAL
(2026-07-25) **affirmed** the pure-fold reconciliation of L129 (both reviewers endorsed the direction; see
the Evidence Log). The reconciliation rests on the mechanically-enforced pure-fold property + coupled L129
amendment, NOT on "profile-driven" alone.

## Licensing

**Deferred, per owner (2026-07-25): architecture first, license later.** This spec is
**license-agnostic** — none of the composition contracts (`assembleProduct`, `ICapabilityPack`,
`IProductProfile`, `IPreset`) encode or depend on any licensing posture. The repo's dual-license
**AGPL + Commercial (no CLA)** stance is noted only as a **downstream business decision** that governs
_who may consume the published packages under what terms_ — it does not shape the technical contracts and
must not be baked into the design. Any consumption-terms enforcement (e.g. commercial-license gating) is
out of scope for ARCH-005 and tracked separately when the owner decides the posture.

## Test Plan

**P0 — pure-refactor equivalence (byte-identical for the extracted subset, R4) + the R1 guards.**

- `robota` CLI **golden** output tests unchanged and green (help/version/print-mode goldens).
- Full `agent-cli` + `agent-transport-tui` suites green with **zero** behavioral diff.
- Mechanical guard: the P0 extraction is a _move_ of the neutral In-kernel subset only, not a _change_ —
  reviewers confirm `cli.ts` produces an identical runtime assembly through `assembleProduct` (same
  provider, same command-module set, same preset resolution, same transport registry). The byte-identical
  bar is scoped to that subset; the shell (init/configure, notices, mode dispatch) is unchanged.
- **R1 guard (a) — dependency-graph neutrality:** `check-dependency-direction.mjs` + a dependency-graph
  test that importing `@robota-sdk/agent-product` pulls **no** `agent-transport-*` / `agent-cli` code.
- **R1 guard (b) — purity/no-IO scan:** a source scan over `agent-product` forbidding `node:fs`,
  `process.env`, and settings-reader reads (all resolved data is fed in from the shell).
- **R1 guard (c) — no product-name conditionals:** a scan forbidding product-identity conditionals
  (`profile.id === '…'` / `agentName === '…'`) in `agent-product` source.
- **Coupled L129 amendment landed** with the guards (governance-flagged edit to
  `feedback_no_shared_cli_factory`).

**New public surfaces — red-first contract tests.**

- `mergeCapabilityPacks(baseCommandModules, packs)`: additive merge, deterministic profile-order precedence,
  and the **`{ merged, rejected }` contract (R5)** — red-first assert (1) the merged set contains a pack's
  contributed module _before_ the merger exists, and (2) a colliding id (across packs / against a base
  module) appears in `rejected` with a reason and is NOT silently overridden.
- `assembleProduct`: profile → assembled materials (provider resolved from `IProviderDefinition[]` +
  injected settings, base ⊕ pack modules merged, `rejectedCapabilities` surfaced, presets resolved via a
  **per-call instance-scoped registry (R8)** — assert two `assembleProduct` calls in one process do NOT
  cross-contaminate or accumulate duplicate-id rejections, `defaultPresetId` honored); runtime construction
  **delegates** to `buildRuntimeSession` (R2 — assert no re-implemented session construction).
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
  repo against the _published_ surface — it is the **agent-run evidence** the done-gate requires (the agent
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

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-25

- Prior Art Research: substantiated (`prior-art-researcher`: Backstage `createBackend()` composition root,
  Docusaurus preset=plugin/theme bundle, ESLint plugin `{configs,rules,processors}` + "cannot force"
  additive rule, Claude Agent SDK `plugins`/`query(options)`, VS Code `contributes`) → `PRIOR_ART_RESEARCH:
FOUND`; scan-spec-research green.
- Frontmatter (status/type INFRA/tags) present; `type: INFRA` chosen because `ARCH` is not one of the 11
  accepted SDLC types (the `ARCH-005` filename keeps its namespace).
- Three deliverables framed: `@robota-sdk/agent-product` (`assembleProduct`), `@robota-sdk/agent-capability-pack`
  (`ICapabilityPack` + merger), existing `agent-preset` for behavior/persona.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-25

Two independent reviewers — `proposal-reviewer` + `architecture-auditor` — **both ENDORSED THE DIRECTION**
and returned **REVISE** with a convergent, complementary set of required spec refinements. Verdict framing:

- **Deliverable 2 (`agent-capability-pack`)** and **deliverable 3 (`agent-preset` external exposure)** were
  **endorsed as correct**.
- **Deliverable 1 (`agent-product` / `assembleProduct`)** is a **defensible direction** contingent on the
  justification/contract refinements below (chiefly: the carve-out must rest on a mechanically-enforced
  pure-fold property, not "profile-driven" alone).

All eight REVISE items were folded into this spec:

1. **R1 — pure-fold property + 3 P0 guards + precise L129 wording.** Folded into `## Decision` §
   "The pure-fold property" (new subsection): `assembleProduct` defined as a pure, deterministic, IO-free
   fold and peer of `resolvePreset`/`mergeSettings`/`mergeCapabilityPacks`, enforced by guards (a)
   dependency-graph neutrality, (b) purity/no-IO scan, (c) no product-name conditionals. Precise L129
   amendment wording ("a pure, IO-free, data-driven assembler that hard-codes no product's choices" — NOT
   "profile-driven assemblers" generally). Amendment coupled to P0 guards + flagged as a governance change.
   Also reflected in the header note, deliverable-1 blurb, staged-delivery P0, and Test Plan P0 guards.
2. **R2 — single-runtime-seam invariant + RUNTIME-001 reconciliation.** Folded into `## Decision` §
   "Single-runtime-seam invariant": `agent-product` delegates to `buildRuntimeSession` /
   `createInteractiveRuntime` / `startRuntimeHost` (`runtime-host.ts:11-15`) and never re-implements;
   `assembleProduct` is the fold ABOVE that seam; settings/args/env stay in the shell. No competing SSOT.
3. **R3 — corrected the "502-line kernel" characterization + boundary table.** Folded into the linchpin-gap
   intro (most of `startCli` is legitimate product-shell that STAYS) and the new `## Decision` §
   "In-kernel vs stays-in-shell" table. Framing that value ∝ lines moved removed.
4. **R4 — P0 byte-identical claim scoped + DATA seam shown.** Folded into the boundary-table section (the
   DATA seam: what crosses into `assembleProduct` vs what stays in `cli.ts`) and staged-delivery/Test-Plan
   P0 (bar scoped to the extracted neutral subset; done-gate unchanged).
5. **R5 — `mergeCapabilityPacks` conflict-resolution contract.** Folded into the capability-pack contract
   sketch (returns `{ merged, rejected }` mirroring `IPresetRegistrationResult`; takes `baseCommandModules`)
   and a responsibility-split invariant defining ONE precedence order (`baseCommandModules` < packs in
   profile order; colliding later id rejected+reported, never silently overridden) and how it composes with
   the preset enabled/disabled delta `buildCommandSetup` applies.
6. **R6 — restated the pack safety property honestly (not "inert JSON").** Folded into the VS Code prior-art
   reference (packs carry executable code objects; no-function-across-serialization criterion N/A because a
   pack is an in-process composition arg), the "Contract layer must stay IO-free" constraint, and the
   "packs are opt-in" invariant (contributed commands/tools execute only through the permission-gated
   runtime `PermissionEnforcer` at call time).
7. **R7 — fixed seam typing to real/named contracts.** Folded into both contract sketches: (a) `transports`
   targets `ITransportRegistryView` (`agent-interface-transport`, `transport-config.ts:24`) — not the
   nonexistent `ITransportRegistry`; concrete `TransportRegistry` stays out of `agent-product`'s deps;
   (b) pack `tools` use the real `agent-core` `FunctionTool` contract (`agent-core/src/index.ts:175`) — not
   the nonexistent `IToolContribution`. Both marked resolved BEFORE P1 (load-bearing for acyclicity).
8. **R8 — per-call preset registry (reentrancy).** Folded into the `IAssembledProduct` sketch + a
   responsibility-split invariant: `assembleProduct` builds a per-call instance-scoped preset resolver and
   MUST NOT mutate agent-preset's module-level `externalPresets` global (`resolve-preset.ts:46,76-103`);
   Mode B example comment corrected; Test Plan asserts two calls in one process do not cross-contaminate.

**L129 governance note:** the amendment to `feedback_no_shared_cli_factory` (`project-structure.md` L129)
carving out the pure-fold assembler lands **with P0**, coupled to guards (a)/(b)/(c) that make it safe —
flagged here for owner visibility as a change to a mandatory rule. Status → `approved`; spec moved to
`todo/`.
