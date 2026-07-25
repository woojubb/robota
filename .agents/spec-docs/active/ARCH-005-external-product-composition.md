---
status: in-progress
type: INFRA
tags: [architecture, product-composition, packaging]
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

Three published deliverables. **`agent-core` is UNCHANGED. `agent-framework` takes ONE scoped additive
change** — the `agentDefinitions` injection seam (owner Decision 2, below); it stays neutral, and every
existing path is byte-identical when the option is absent.

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
agent-framework                  (assembly layer: session/runtime/command contracts; ONE scoped additive
                                  change — the `agentDefinitions` injection seam, owner Decision 2)
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

### Two owner decisions that S2 implements (2026-07-25)

An independent review of S1 returned **GO-WITH-CHANGES** on two entry conditions. The owner resolved both;
S2 implements them, and they supersede the S1 "deviations from the directional sketch" recorded below.

**Decision 1 — provider construction returns IN-KERNEL via a pure seam at an allowed layer.** S1 injected
the already-constructed provider because the only pure `config → IAIProvider` factory was believed to live
in `agent-executor` (not an allowed dependency). **That premise was wrong:** `createProviderFromConfig` was
relocated to **`@robota-sdk/agent-core`** by ARCH-PROVIDER-003 (`agent-core/src/index.ts:100`;
`agent-executor` merely re-exports it), and `agent-core` is already an allowed `agent-product` dependency.
**No relocation, no forked copy, and no framework edit were needed** — the SSOT is agent-core and
`agent-executor` already consumes it. So `assembleProduct` now constructs the provider from
`providerDefinitions` + `providerSettings` (the ALREADY-RESOLVED `IProviderDefinitionConfig` the shell
passes in as data), exactly as the In-kernel boundary table prescribes. `IProductProfile.provider` remains
an OPTIONAL injected override for advanced/test consumers (`robota` uses it for `--session-log` replay).
Both fields are optional, so **a Mode A consumer can pass only `providerDefinitions`** — the consumer then
supplies a provider in the `buildRuntime` session options. The fold stays pure/IO-free: every settings, env,
and file read remains in the shell, and all three guards still pass (guard (a) additionally now forbids an
`agent-executor` dependency; guard (b) additionally forbids `globalThis.process`).

**Decision 2 — pack subagents get a real runtime seam via a scoped, additive framework change.** S1 exposed
merged pack subagents as inert material (`IAssembledProduct.subagents`) because the framework's roster was
closed: `buildAgentRuntime` constructed `new AgentDefinitionLoader(cwd)` over the hard-coded
`BUILT_IN_AGENTS`. S2 adds an **injectable `agentDefinitions`** option to the session seam
(`TInteractiveSessionOptions` → `IInitOptions` → `ICreateSessionOptions` → `buildAgentRuntime`), composed
into the built-in tier ahead of `BUILT_IN_AGENTS`, and `assembleProduct`'s runtime overlay populates it from
the merged packs. `AgentDefinitionLoader` now dedupes within that tier (first wins) so an injected
definition may override a built-in without duplicating the roster. The option is threaded through the
headless and TUI channels so every `robota` surface carries it.

> **Precedence (explicit, highest → lowest):** discovered project/user definitions
> (`.robota/agents` > `.agents/agents` > `.claude/agents` > `~/.robota/agents` > `~/.claude/agents`)
> **>** injected `agentDefinitions` (packs, in profile order) **>** `BUILT_IN_AGENTS`.
> A pack may override a framework built-in; the consumer's own on-disk definition still overrides the pack
> (the ESLint "the consumer decides" rule, applied to subagents).

This is a **SCOPED ADDITIVE** change and nothing broader: absent `agentDefinitions`, every existing path is
byte-identical. Wherever this spec or the S1 evidence says "the framework is unchanged", read: **one scoped
additive change — the `agentDefinitions` injection seam.**

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

**Delivered (S3, 2026-07-25):** [`arch-005-external-consumer-proof-agent-run.md`](../../evals/scenarios/arch-005-external-consumer-proof-agent-run.md),
backed by `scripts/external-proof/` (`pnpm proof:external`) — 65 assertions, agent-run, exit 0.

> **One deliberate reduction against Scenario 1's wording.** Scenario 1 said "drive one prompt turn through
> the assembled runtime → expect a model response". The proof constructs the provider IN-KERNEL and builds a
> live `InteractiveSession` through the framework seam, but does **not** issue a model call: that would make
> the done-gate depend on a paid vendor credential and a network round-trip, which no CI or offline agent run
> can reproduce. What the proof asserts instead is strictly stronger where it matters and honest about the
> rest — the provider is a real `IAIProvider` code object built by the kernel from the definitions, and
> `buildRuntime` returns a real framework `InteractiveSession`. The model round-trip itself is already
> covered by the in-repo scripted-provider e2e suites.

## Completion Criteria

- [x] **TC-1 (Mode A)** — from outside the monorepo, a profile carrying only `providerDefinitions` +
      branding assembles, and a profile that adds `providerSettings` gets its **provider constructed
      IN-KERNEL** (the consumer builds none and depends on no `agent-provider-*` package); the assembled
      materials (commands/tools/subagents/agentName) are exposed and reach a live framework session.
- [x] **TC-2 (Mode B)** — a hand-authored `IPreset` layered by an external consumer drives the resolved
      options (persona/model/effort/denied tools + the permission posture DERIVED from `autonomy`), reaches
      the session options, and — R8 — does **not** leak into a second `assembleProduct` call or into
      `agent-preset`'s module-level registry.
- [x] **TC-3 (Mode C: preset reuse + additive merge)** — a Robota built-in preset is reusable by id with
      nothing registered, a consumer-authored `ICapabilityPack` merges additively in `base ⊕ packs` order,
      and a deliberate id collision is **reported on the rejection channel** (distinct base-vs-pack reasons,
      first registration wins) rather than silently dropped or overridden.
- [ ] **TC-4 (Mode C: tool axis)** — **PARTIALLY MET, and deliberately not checked.** A pack tool the
      framework does not already ship IS additive through `buildRuntime`/`buildRuntimeOptions` (proven). But
      `createSession` assembles `[...createDefaultTools(), ...additionalTools]` with no dedupe and no
      suppression hook, so a pack can neither remove nor replace a framework default, and a pack whose tools
      duplicate the defaults (as `pack-coding`'s do by design) would be listed twice — which is why
      `robota`'s own surfaces still take their tools from `createDefaultTools()`. Tracked by
      **[ARCH-006](../../backlog/ARCH-006-framework-tool-axis-neutrality.md)**.
- [x] **TC-5 (published-surface sufficiency)** — the proof installs real `pnpm pack` tarballs via
      `npm install` (no workspace link, no relative import, `npm overrides` pinning every `@robota-sdk/*`
      specifier so nothing resolves from the registry) and type-checks with `skipLibCheck: false` against the
      SHIPPED `.d.ts` files. No product source change was needed to make it pass.
- [x] **TC-6 (reproducible + opt-in)** — the fixture and runner are committed at `scripts/external-proof/`
      and re-runnable with `pnpm proof:external`; they are excluded from the default test suite because they
      pack and install.
- [ ] **TC-7 (robota eats its own runtime seam)** — **NOT MET, carried from the S2 disclosure.** `cli.ts`
      consumes the kernel's MATERIALS but not `product.buildRuntime`/`buildRuntimeOptions` nor
      `product.resolvePreset`. Neither is a kernel defect and neither affects any external mode, but the
      dogfooding claim is weaker than the boundary table states. Tracked by
      **[ARCH-007](../../backlog/ARCH-007-robota-consumes-kernel-runtime-seam.md)** — which S3 had to FILE,
      because the S2 entry's "tracked by the follow-up backlog items filed from the review (B1/B2)" pointed
      at items that were never actually created.

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

### [S1] — ✅ IMPLEMENTED (packages + guards + L129) | 2026-07-25

Owner-directed full-slice staging: **Stage S1** landed the three new published packages, the three R1
guards, and the coupled L129 amendment — **without editing `cli.ts`** (that wiring is S2). All red-first
TDD; full `pnpm -w typecheck`, per-package builds, and `run-all-scans` green.

- **`@robota-sdk/agent-capability-pack`** (new) — `ICapabilityPack` typed to the REAL contracts
  (`ICommandModule`/`IAgentDefinition` from agent-framework, `FunctionTool` from agent-core — no
  `IToolContribution`, R7b) + pure `mergeCapabilityPacks(baseCommandModules, packs) → { merged, rejected }`
  (R5: one precedence order base < packs-in-order; colliding id rejected+reported, never overridden). Packs
  carry executable code objects, not JSON (R6) — stated in the SPEC. 7 red-first tests.
- **`@robota-sdk/agent-product`** (new) — `assembleProduct(profile)`: pure, IO-free, zero product-name
  branching. Per-call instance-scoped preset registry (R8), pack merge, and runtime construction that
  DELEGATES to `buildRuntimeSession` (R2 — proven `instanceof InteractiveSession`, never re-implemented).
  Deps = agent-framework + agent-preset + agent-capability-pack + type-only agent-interface-transport
  (`ITransportRegistryView`, R7a) + agent-core contract TYPES. 5 red-first tests.
- **`@robota-sdk/pack-coding`** (new) — robota's coding capability as one `ICapabilityPack` (built-in tools
  imported from agent-tools factories + `/shell`+`/editor` command modules + `BUILT_IN_AGENTS` subagents);
  tool set drift-pinned to `createDefaultTools()`. 5 red-first tests.
- **`@robota-sdk/agent-preset`** — minimal addition `createPresetRegistry` (the instance-scoped resolver
  R8 needs; no module-global mutation). 4 red-first tests; full preset suite green.
- **Three R1 guards** — one focused scan `scan-composition-neutrality.mjs` (config in
  `.agents/harness.config.json` → `compositionNeutrality`; registered in `run-all-scans`): (a)
  dependency-graph neutrality, (b) purity/no-IO, (c) no product-name conditionals. 8 red-first unit tests +
  an end-to-end red proof (planted fs-import + `process.env` + `profile.id === 'robota'` + `agent-cli` dep →
  scan FAILED with 4 findings → reverted → passed).
- **L129 amendment** (governance-flagged) — carved out "a pure, IO-free, data-driven assembler that
  hard-codes no product's choices", explicitly NOT "profile-driven assemblers" generally, coupled to the
  composition-neutrality guards. The prohibition on product-specific factories is intact.

**Deviations from the directional sketch (flagged for S2 / owner-gate) — BOTH RESOLVED IN S2:**

- ~~**Provider is INJECTED, not resolved inside `assembleProduct`.**~~ **Superseded by owner Decision 1.**
  The stated premise was wrong: `createProviderFromConfig` lives in **`agent-core`** (relocated by
  ARCH-PROVIDER-003), an already-allowed dependency — `agent-executor` only re-exports it. S2 returns
  provider construction to the kernel with no relocation and no framework edit.
- **agent-core is a direct TYPE dependency of agent-product** (`IAIProvider`/`IProviderDefinition`/
  `FunctionTool`/`TPermissionMode`) because `agent-framework` does not re-export those core types. Neutral
  and allowed (the guards forbid only concrete transport/TUI/CLI, not agent-core).
- **`buildRuntime` returns the framework `InteractiveSession`** (the seam the shell binds its
  transport/presentation over, as the TUI does), not a channel-bound `IInteractiveRuntime` — the sketch's
  `createInteractiveRuntime` seam drops `additionalTools`, so it cannot carry pack tools. ~~Merged pack
  **subagents** are exposed as material; the deeper subagent-runner wiring is S2.~~ **Subagent exposure
  superseded by owner Decision 2** — S2 adds the framework `agentDefinitions` injection seam so merged pack
  subagents reach the runtime.
- **spec-surface-baseline.json** — the ratchet represents a fully-documented (zero-debt) package by
  ABSENCE; the new packages document every runtime export, so `--write-baseline` normalizes away any `0`
  entry. Registration in `check-spec-public-surface` is via each package's `docs/SPEC.md` (found by
  `listSpecPackageDirs`), which enforces full documentation.
- **`changeset status` is broken on `develop`** by a pre-existing dangling `@robota-sdk/agent-web-ui` entry
  in `.changeset/config.json` `fixed` (unrelated to S1); the S1 changeset file
  (`arch-005-s1-composition-layer.md`) is well-formed. The new packages were NOT added to the `fixed` group
  to avoid touching that broken list.

### [S2] — ✅ IMPLEMENTED (robota-as-profile + CLI collapse + both owner decisions) | 2026-07-25

Stage S2 re-expressed `robota` as an `IProductProfile` and **deleted** the hand-wired composition root in
`cli.ts` — no compat shim, no parallel old path, per the owner directive
("정석대로, 지름길 금지, 레거시 보존 금지").

**Owner Decision 1 — provider construction IN-KERNEL.** No relocation was needed: `createProviderFromConfig`
already lives in `@robota-sdk/agent-core` (`src/index.ts:100`, relocated by ARCH-PROVIDER-003), an allowed
dependency; `agent-executor` merely re-exports it, so there is one SSOT and no forked copy.
`assembleProduct` now builds the provider from `providerDefinitions` + the shell's already-resolved
`providerSettings`; `provider?` is an optional injected override (`robota` uses it for `--session-log`
replay). Both optional ⇒ a Mode A profile carries only `providerDefinitions`. The fold stays pure — 5
red-first cases failed before the change (undefined provider, Mode A profile rejected, no unknown-provider
error, missing `buildRuntimeOptions`), then passed.

**Owner Decision 2 — `agentDefinitions` runtime seam.** Injectable on `TInteractiveSessionOptions` /
`IInitOptions` / `ICreateSessionOptions`, composed into the built-in tier ahead of `BUILT_IN_AGENTS`;
`AgentDefinitionLoader` dedupes within the tier (first wins). Precedence: discovered > injected > built-in.
Threaded through the headless + TUI channels. 2 red-first cases failed first (injected definition
unreachable; duplicated `Explore` in the roster), then passed. A SCOPED ADDITIVE change — absent the option,
every path is byte-identical; the "framework unchanged" claims in this spec are corrected accordingly.

**The collapse.** `robota`'s identity is data in `packages/agent-cli/src/product/robota-profile.ts`;
`cli.ts` keeps only the stays-in-shell rows of the boundary table. **`pack-coding` is load-bearing, not a
mirror**: `buildCommandSetup` builds the base as the default set MINUS the pack-supplied names, so `/shell`
and `/editor` come from the pack — dropping the pack from the profile drops them from the product (proven by
test). Composition order follows the spec: the capability merge widens (base ⊕ packs, rejection channel),
then the preset's enabled/disabled delta narrows that superset; the fixed modules (`/workflows`,
caller-injected) stay outside the delta, unchanged.

**EQUIVALENCE EVIDENCE (the P0 bar).** `packages/agent-cli/src/__tests__/robota-assembly-equivalence.test.ts`
pins literals captured from the PRE-CHANGE hand-wired assembly (at `378c585e9`) and re-derives them through
the new fold: the 27-module command set, the 6 provider definition types, the 10 default tools, the 3
subagents, `DEFAULT_AGENT_NAME`, and `resolvePreset('default')`/`('careful-reviewer')` — plus the INFRA-032
unknown-name notices and the preset delta over the merged superset. Proven NOT accidentally green: replacing
`ROBOTA_PACKS` with `[]` fails 2 of its assertions. The 15 `startCli` e2e tests drive the REAL collapsed
shell end-to-end with a scripted provider.

**Verification (all foreground, all green).** Full `pnpm build`; `pnpm -w typecheck` clean; **2184 tests**
across `agent-cli` (247), `agent-transport-tui` (526), `agent-framework` (1261), `agent-transport` (56),
`agent-preset` (71), `agent-product` (11), `agent-capability-pack` (7), `pack-coding` (5); **all 61
`run-all-scans` pass**; the real `robota` binary runs (`--version`, `--help`).

**Guard hardening (reviewer remediation).** Guard (c) caught only `===`/`!==`; it now bans four named forms —
equality (incl. backticks), `switch (X.id)`, `X.id.startsWith/endsWith/includes/match(…)`, and a lookup table
keyed by `X.id`. Guard (a) adds `@robota-sdk/agent-executor`; guard (b) adds `globalThis.process` (which
evaded the bare `process.env` pattern, whose lookbehind rejects a preceding `.`). Red-first: 6 unit cases
failed first, and an end-to-end proof planted all five evasions in the real `agent-product` tree → scan
exited 1 with 5 findings → reverted → clean pass. Reading an identity as DATA stays legal; branching on it
does not.

**Conformance-review outcome (independent review of PR #1386): GO-WITH-CHANGES — applied on the same
branch.** The collapse, both owner decisions, the equivalence provenance, and the mutation proof all
verified. Four fixes were required and are in:

- **F4 (gate hole — the important one).** The equivalence test RE-IMPLEMENTED
  `selectCommandModules(...) + fixedCommandModules` inline instead of calling the shipped
  `selectProductCommandModules`, so the production path was uncovered. The reviewer proved it: deleting
  `...fixedCommandModules` from the helper — which drops `/workflows` and every caller-injected module from
  the real CLI — left all 247 agent-cli tests GREEN. The test now calls the shipped helpers, and the same
  mutation FAILS it (2 assertions). Lesson: an equivalence gate that re-derives the shipped logic tests the
  test, not the product.
- **F5** — the INFRA-032 notice restored to its original position (above).
- **F3** — the false "nothing observable is ordered by that list" claim corrected (above).
- **F6** — `agent-framework/docs/SPEC.md` (the package's own SSOT) now documents `agentDefinitions`, its
  precedence, and the within-tier dedupe, and explicitly reconciles it with the adjacent NEUT-003
  `builtInAgents` seam: NEUT-003 **REPLACES** the built-in set, ARCH-005 **PREPENDS INTO** it. That
  ambiguity is now written down rather than left to be inferred.

**DISCLOSURE — `robota` consumes the kernel's MATERIALS but not its RUNTIME SEAM (F1/F2).** Two In-kernel
rows of the boundary table are therefore **unmet for the dogfooding product itself**, even though the kernel
implements both:

- **Runtime-build delegation.** `cli.ts` does not call `product.buildRuntime` / `product.buildRuntimeOptions`.
  It passes the assembled materials (provider, command modules, `agentDefinitions`) into `renderApp` /
  `runPrintMode` / `runServeMode`, each of which constructs its session through its own channel. Those
  channels do reach `buildRuntimeSession`, so there is no competing runtime-construction SSOT — but the
  kernel's overlay is exercised by tests and external Mode-A consumers, not by `robota`.
- **Preset-resolve glue.** `cli.ts` does not call `product.resolvePreset`. It still resolves through
  `agent-preset`'s module-global `resolvePreset` (via `resolveCliPreset`), because the resolved preset is
  needed BEFORE the base command modules are built (its module-selection delta feeds them) and because the
  in-session `/preset` command reads that same module-global registry — moving the shell to the instance
  registry alone would split that SSOT.

Neither is a defect in the kernel and neither affects the equivalence bar; both are real gaps between "the
kernel offers the seam" and "robota eats it". Closure is tracked by the follow-up backlog items filed from
the review (B1/B2), not resolved here.

**Deviations / follow-ups for S3:**

- **The pack's TOOL axis is declared but not additive for `robota`.** `agent-framework`'s `createSession`
  hard-codes `createDefaultTools()` and concatenates `additionalTools` with no dedupe, so overlaying
  `pack-coding`'s (identical) tools would DUPLICATE all ten. The tools are therefore exposed as
  `IAssembledProduct.tools` and reach `buildRuntime` consumers, but `robota`'s own surfaces still get them
  from the framework default. Making the framework's default tool set injectable/suppressible is a neutrality
  change deliberately NOT taken here (out of the scoped-additive budget) — it is the S3 item that would make
  the tool axis as load-bearing as the command/subagent axes.
- **Command-module ORDER shifts, and it IS user-visible — an ACCEPTED delta.** The coding modules are
  appended after the base rather than sitting mid-list. An earlier revision of this entry claimed "nothing
  observable is ordered by that list"; **that was wrong.** `CommandRegistry.getCommands()` concatenates per
  source with no sort, and `SystemCommandExecutor.listCommands()` returns Map values in insertion order, so
  `/shell` and `/editor` move to the END of `/help` output and of the slash-command autocomplete popup.
  Content identical, position changed. Accepted rather than fixed: restoring the old position would mean
  teaching the neutral merger about one product's preferred ordering — precisely what the
  composition-neutrality guards exist to forbid.
- ~~**The INFRA-032 unknown-preset-module notice moved later in the startup sequence.**~~ **FIXED after
  review — the recorded rationale did not hold.** The claim was that the notice needs the merged superset,
  which exists only after `assembleProduct`. But `findUnknownModuleNames` takes only NAMES
  (`command-module-selection.ts`), and the shell already holds both halves without any merge knowledge. The
  notice is restored at its ORIGINAL position (immediately after `buildCommandSetup`, before the
  `init`/`--configure`/provider-config early-returns) using `mergedCommandModuleNames(baseCommandModules,
ROBOTA_PACK_COMMAND_MODULE_NAMES)`. Byte-identity on the early-return paths AND the normal-run ordering
  are both restored. The name-superset shortcut is only valid while it equals the real merged product's
  names, so the equivalence test asserts that identity directly — the two cannot drift apart.
- `packages/agent-transport` and `packages/agent-transport-tui` each took a 2-line optional pass-through so
  the Decision-2 seam reaches robota's real surfaces; two files that the threading pushed past the file-size
  ratchet were SPLIT (not extended) per the ratchet's own remedy.

### [S3] — ✅ IMPLEMENTED (external-consumer proof) | 2026-07-25

**Status: `approved` → `in-progress` (spec `todo/` → `active/`). NOT `done` — see the disposition below.**

Stage S3 built the external-consumer proof: a throwaway package **outside the monorepo tree** that installs
the `pnpm pack` tarballs and exercises Modes A/B/C against the PUBLISHED surface. Committed and re-runnable
at `scripts/external-proof/` via **`pnpm proof:external`** (opt-in — it packs and installs, so it is outside
the default test suite, following the `*.bintest.ts` precedent).

**It is a real external install, not a dressed-up in-repo test.** The runner derives the workspace dependency
closure of the entry packages (**17 packages**), refuses to run if any lacks build output, `pnpm pack`s each
one, materialises the fixture into a temp directory it **hard-fails on if it is inside the repo**, and
`npm install`s the tarballs. `npm overrides` pin every `@robota-sdk/*` specifier to a local tarball —
load-bearing, because `@robota-sdk/agent-core@3.0.0-beta.79` IS published, so without the pin npm would
silently install the REGISTRY build for the transitive deps and the proof would measure the wrong tree. The
consumer then type-checks with **`skipLibCheck: false`** against the shipped `.d.ts` files before running.

**Result: `EXTERNAL PROOF PASSED — 65 assertions across Modes A, B and C.` (exit 0), `tsc` clean.**

- **Mode A (TC-1).** The literal spec-sketch profile (branding + `providerDefinitions` only) assembles and
  honestly yields nothing else — no hidden product opinion. Adding `providerSettings` gets a provider
  **constructed IN-KERNEL** (owner Decision 1 verified from outside): a real `IAIProvider` with
  `name === 'openai'` and a callable `chat`, from a consumer that builds no provider and depends on **no**
  `agent-provider-*` package; an unknown provider name is rejected by the kernel naming the supported types.
  Adding `pack-coding` surfaces the 2 coding command modules, the 10 coding tools and the 3 coding subagents,
  and `buildRuntime` returns a value that is `instanceof` the framework's `InteractiveSession` — which also
  proves there is exactly ONE framework copy in the install.
- **Mode B (TC-2).** A hand-authored `IPreset` drives persona/model/effort/`deniedTools`/`selfVerification`,
  and its permission posture is **derived** from the `autonomy: 'ask-first'` dial (→ `permissionMode:
'default'`) by the published resolver. The posture is overlaid onto the session options, and an explicit
  shell `permissionMode` is NOT overwritten. **R8 verified from outside:** a second `assembleProduct` call
  cannot see the preset (`getPreset` → `undefined`, `resolvePreset` throws), `agent-preset`'s module-level
  global was never mutated (the globally-imported `resolvePreset` throws too), and the FIRST product still
  resolves it — per-call registries, not per-process.
- **Mode C (TC-3).** `careful-reviewer` is reused by id with nothing registered (its shipped persona/autonomy/
  effort/`selfVerification` all arrive). A consumer-authored pack (own `FunctionTool`, own `ICommandModule`
  with a `systemCommands` handler, own `IAgentDefinition`) merges additively in `base ⊕ packs` order. A
  deliberate 4-way id collision is **reported**, with `duplicate commandModule id` and `collides with base
command module` as DISTINCT reasons, exactly one surviving module per id, and the FIRST definition surviving
  (asserted by inspecting the survivor's contents, not just its count).
- **TC-5/TC-6.** No product source change was needed — S3 required none, as the staging predicted. The
  fixture + runner are committed and re-runnable.

**Proven NOT accidentally green.** Two mutations were planted in the shipped source and the packages rebuilt:
dropping the rejection channel from `mergeCapabilityPacks` (silently skip instead of report) and dropping the
`agentDefinitions` injection from `assembleProduct`'s overlay → `FAILED — 7 failed, 58 passed`. Reverted and
rebuilt → back to 65/65.

**Published-surface findings — none blocking, all recorded** in
`scripts/external-proof/fixture/src/surface-notes.ts` rather than silently worked around:

- **F1** — `buildRuntimeOptions` returns the UNION `TInteractiveSessionOptions`, so a consumer must narrow it
  before reading back `additionalTools`/`agentDefinitions` — the very fields the overlay just added. The
  return type does not track the branch of the input that produced it. (Discovered as a hard `tsc` failure.)
- **F2** — `IAssembledProduct.provider` is optional while `IInteractiveSessionStandardOptions.provider` is
  required, so a consumer relying on in-kernel construction still asserts non-null at the call site.
- **F3** — `ICommandResult` is not re-exported from `agent-framework`; authoring a command module works
  (contextual typing) but naming the handler's return type requires `@robota-sdk/agent-interface-transport`.

**THE HONEST GAP (TC-4) — the pack TOOL axis is half-additive, and the proof MEASURES it rather than
asserting it in prose.** Section C5 verifies from the published surface that (a) a pack tool the framework
does not ship IS additive and reaches the runtime, (b) `pack-coding`'s tools are name-identical to
`createDefaultTools()`, and (c) the overlay only APPENDS to `additionalTools`. Combined with
`create-session.ts`'s `[...defaultTools, ...additionalTools]` (no dedupe, no suppression hook), the precise
statement is: **a NEW pack tool is fully additive; a pack can neither remove nor replace a framework default;
a pack duplicating a default would be listed twice** — which is exactly why `robota`'s own surfaces still
take their tools from `createDefaultTools()`. Filed as
**[ARCH-006](../../backlog/ARCH-006-framework-tool-axis-neutrality.md)**. Nothing stronger is claimed.

**A dangling reference S3 had to fix.** The S2 entry above says the B1/B2 disclosures are "tracked by the
follow-up backlog items filed from the review". They were never filed — neither in `.agents/backlog/` nor as
issues. S3 filed them as
**[ARCH-007](../../backlog/ARCH-007-robota-consumes-kernel-runtime-seam.md)**.

**Verification (all foreground).** `pnpm build` green; `pnpm proof:external` 65/65 exit 0 (plus the mutation
run and the revert); `pnpm harness:verify-like-ci` green. Scenario catalog entry:
[`arch-005-external-consumer-proof-agent-run.md`](../../evals/scenarios/arch-005-external-consumer-proof-agent-run.md).

**DISPOSITION — the spec stays `active`, deliberately.** Modes A, B and C all work from a genuinely external
consumer against the published surface; the linchpin gap the spec was written to close IS closed. But two
Completion Criteria are not met and the done-gate is not a place to round up:

- **TC-4** — the tool axis is additive only for NEW tools and only through the `buildRuntime` seam
  (→ **ARCH-006**).
- **TC-7** — `robota` itself consumes the kernel's materials but not its runtime seam or preset resolver, so
  the dogfooding claim is weaker than the boundary table reads (→ **ARCH-007**).

Neither blocks an external consumer, which is why S3 is recorded as ✅ IMPLEMENTED. Both are real gaps against
what THIS spec claims, which is why the spec is **not** moved to `done/`. It moves `todo/` → `active/` with
`status: in-progress` and closes when ARCH-006 and ARCH-007 land.
