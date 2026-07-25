# agent-product Specification

## Scope

Owns the **product-assembly kernel** for the Robota SDK: the `IProductProfile` declarative product object,
the `IAssembledProduct` runtime-materials result, and the single composition function `assembleProduct`.
`assembleProduct(profile)` is a **pure, deterministic, IO-free fold** over `IProductProfile` DATA with
**zero product-specific branching** — the composition mechanism a third party imports to build their OWN
product on Robota's published runtime. It is a peer of the repo's already-blessed pure folds
(`resolvePreset`, `mergeSettings`, `mergeCapabilityPacks`). `robota` becomes one profile among many; an
external repo brings its own. (ARCH-005, Mode A/B/C gateway.)

## The pure-fold property (the L129 carve-out)

`assembleProduct` is carved out of project-structure L129 ("no shared product factory") **not** on
"profile-driven" alone (a profile-driven function could still accrete `if (profile.id === 'robota')`
branches and become a de-facto shared factory) but on a stronger, mechanically-enforced property:

> `assembleProduct` is a PURE, deterministic, IO-free fold over `IProductProfile` DATA, with ZERO
> product-specific branching. It reads only its argument, calls only pure sub-folds (`createPresetRegistry`
> / `mergeCapabilityPacks`) and the framework's runtime-construction seam, and returns assembled materials.

Enforced at all times by the three composition-neutrality guards
(`scripts/harness/scan-composition-neutrality.mjs`, registered in `run-all-scans`):

1. **Dependency-graph neutrality** — `agent-product` declares no concrete transport/TUI/CLI dependency
   (`agent-transport*`, `agent-transport-tui`, `agent-transport-ws`, `agent-cli`).
2. **Purity / no-IO** — no `node:fs`/`fs`, `process.env`, or settings-reader read in `agent-product/src`;
   all resolved data (settings, env, args) is fed IN from the shell. `globalThis.process` is banned too, so
   the qualified form cannot evade the check. Constructing a provider from already-resolved settings data is
   pure and therefore allowed.
3. **No product-name conditionals** — no product-identity BRANCH on `.id`/`.agentName` in any of its four
   forms: equality against a literal (`===`/`!==`, incl. backticks), `switch (profile.id)`,
   `profile.id.startsWith/endsWith/includes/match(…)`, or a lookup table keyed by the identity
   (`TABLE[profile.id]`). Reading the identity as DATA stays legal; branching on it does not.

## Boundaries

- Does **not** import a concrete transport, the TUI, remote-control, or the CLI. `agent-transport*`,
  `renderApp`/`createDefaultTuiCliAdapter`, and the `createDefault*` I/O adapters stay wired in the shell
  (`agent-cli`) and are injected into the profile as data.
- Does **not** read settings, files, or env (guard b). Settings/args/env resolution stays in the shell;
  `assembleProduct` receives already-resolved data.
- Does **not** re-implement runtime assembly. Runtime construction DELEGATES to `agent-framework`'s
  `buildRuntimeSession` seam (R2, RUNTIME-001 SSOT) — there is no competing runtime-construction SSOT.
- Does **not** READ provider settings — but it DOES construct the provider (ARCH-005 S2, owner Decision 1).
  The shell performs the settings/env/file reads and passes the resolved `IProviderDefinitionConfig` in as
  `IProductProfile.providerSettings`; `assembleProduct` then builds the provider from it via agent-core's
  pure `createProviderFromConfig` (relocated to `agent-core` by ARCH-PROVIDER-003 — an allowed dependency
  layer, so no `agent-executor` edge is needed). `IProductProfile.provider` remains an OPTIONAL injected
  override for advanced/test consumers. With neither field, no provider is constructed and the consumer
  supplies one in the `buildRuntime` session options — the Mode A shape, which carries only
  `providerDefinitions`.
- Does **not** mutate agent-preset's module-level `externalPresets` global. It builds a **per-call
  instance-scoped** preset registry via `createPresetRegistry` (R8).

## Architecture Overview

```
agent-core / agent-tools         (unchanged neutral foundation — contract types)
  ↑
agent-framework                  (unchanged assembly/runtime seam: buildRuntimeSession, session/command contracts)
  ↑            ↑              ↑
agent-preset   agent-capability-pack        (contract + pure merger packages)
  ↑            ↑
agent-product                    (this package: assembleProduct — deps = framework + preset + capability-pack
  ↑                               + type-only agent-interface-transport + agent-core types)
agent-cli                        (product shell — S2: brings concrete transports/TUI/adapters, passes them in a profile)
```

`assembleProduct` sits ABOVE the runtime-construction seam. The three layers are disjoint: the shell
resolves inputs → `assembleProduct` folds definitions into materials → the framework's `buildRuntimeSession`
constructs the runtime. Each concern has exactly one owner.

`buildRuntimeOptions` (on the assembled product) is the PURE overlay: the shell-supplied
`TInteractiveSessionOptions` with the assembled command modules, pack tools (`additionalTools`), merged pack
subagents (`agentDefinitions`), the constructed provider, and the default preset's `permissionMode` laid on
top. `buildRuntime` is `buildRuntimeSession(buildRuntimeOptions(input))` — it returns the framework
`InteractiveSession` the shell binds its own transport/presentation over.

Merged pack **subagents** reach the runtime through `agent-framework`'s `agentDefinitions` injection seam
(ARCH-005 S2, owner Decision 2 — a scoped ADDITIVE framework change). Precedence in the framework, highest →
lowest: discovered project/user definitions > injected `agentDefinitions` > `BUILT_IN_AGENTS`. The overlay
leaves `agentDefinitions` UNSET when no pack contributes one, so the framework default is untouched.

## Type Ownership

| Type                | Location             | Purpose                                                                        |
| ------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `IProductProfile`   | `product-profile.ts` | The declarative product object — identity + provider + presets + packs + plumbing |
| `IAssembledProduct` | `product-profile.ts` | The neutral runtime materials `assembleProduct` produces                        |
| `IBuildRuntimeInput`| `product-profile.ts` | The shell-supplied session options `buildRuntime` overlays materials onto       |

## Public API Surface

| Export               | Kind      | Description                                                                                                |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `assembleProduct`    | Function  | `(profile: IProductProfile) => IAssembledProduct`; the pure, IO-free product-composition fold             |
| `IProductProfile`    | Interface | Declarative product object (identity, provider, presets, packs, injected plumbing)                        |
| `IAssembledProduct`  | Interface | Neutral runtime materials + `resolvePreset` (instance-scoped) + `buildRuntimeOptions` (pure overlay) + `buildRuntime` (delegates to the seam) |
| `IBuildRuntimeInput` | Interface | `{ session: TInteractiveSessionOptions }` — the shell input `buildRuntime` overlays assembled materials onto |

## Merge & precedence semantics

- **Capability merge:** `assembleProduct` calls `mergeCapabilityPacks(profile.baseCommandModules ?? [],
  profile.packs ?? [])`. Precedence: base < packs in profile order; a colliding later id is rejected and
  surfaced in `IAssembledProduct.rejectedCapabilities`, never silently overridden. The merged command
  modules are the base ⊕ pack superset; a preset's `enabledCommandModules`/`disabledCommandModules` delta
  is applied AFTER this merge by the shell's command-setup (they compose — this widens, the preset delta
  filters).
- **Preset resolution:** an instance-scoped `IPresetRegistry` over `[built-ins, ...profile.presets]`; the
  default preset (`profile.defaultPresetId`) is resolved to seed `IAssembledProduct.defaultPreset` and the
  `permissionMode` default `buildRuntime` applies when the shell leaves it unset.
- **Provider resolution:** `profile.provider` (injected override) > `createProviderFromConfig(
  profile.providerSettings, profile.providerDefinitions)` > `undefined` (the consumer supplies one at
  `buildRuntime` time). An unknown provider `name` THROWS naming the supported types — never a silent
  no-provider.

## Extension Points

| Extension Point   | Kind      | How to extend                                                                          |
| ----------------- | --------- | ------------------------------------------------------------------------------------- |
| `IProductProfile` | Interface | Author a profile value (identity + provider + presets/packs + injected plumbing) and pass it to `assembleProduct` |

## Error Taxonomy

`assembleProduct` throws no error classes of its own. `resolvePreset`/`createPresetRegistry` throw a plain
`Error` on an unknown preset id (surfaced from `agent-preset`).

## Test Strategy

`src/__tests__/assemble-product.test.ts` (vitest) covers: the capability fold (base ⊕ pack command
modules, pack tools, pack subagents) and surfaced rejections; instance-scoped preset resolution honoring
`defaultPresetId` with no module-global cross-contamination across two calls (R8); and runtime-construction
delegation — `buildRuntime` returns an `InteractiveSession` built via `buildRuntimeSession` (R2), threading
the assembled command modules + pack tools. The `test` script runs `vitest run --passWithNoTests`.

## Class Contract Registry

This package contains no classes. It exports three interfaces and one pure function. No abstract classes
or cross-package port implementations are defined here.

## Dependencies

- `@robota-sdk/agent-framework` — the runtime-construction seam (`buildRuntimeSession`), session/command
  contracts, and `InteractiveSession`.
- `@robota-sdk/agent-preset` — `createPresetRegistry` (the instance-scoped resolver, R8) and preset types.
- `@robota-sdk/agent-capability-pack` — `mergeCapabilityPacks` (the additive merger).
- `@robota-sdk/agent-core` — provider/tool/permission contract TYPES (`IAIProvider`, `IProviderDefinition`,
  `IProviderDefinitionConfig`, `FunctionTool`, `TPermissionMode`), consumed because `agent-framework` does
  not re-export them, PLUS the pure `createProviderFromConfig` value (owner Decision 1). `agent-executor` is
  explicitly NOT a dependency — the guard forbids it.
- `@robota-sdk/agent-interface-transport` — the read-only `ITransportRegistryView` VIEW interface
  (type-only). The concrete `TransportRegistry` class (`agent-transport`) is NEVER a dependency.

No concrete transport / TUI / CLI dependency — enforced by the composition-neutrality guards.
