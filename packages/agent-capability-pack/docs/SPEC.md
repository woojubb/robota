# agent-capability-pack Specification

## Scope

Owns the **additive capability-bundle contract** for the Robota SDK: the `ICapabilityPack` definition
shape, the `IMergedCapabilities` result shape, and the pure `mergeCapabilityPacks` merger. A capability
pack is the _additive_ composition unit — a plain data record of named capability buckets (command
modules, tools, subagents) a consumer brings on top of a product's base command modules. It is the
additive analog of `@robota-sdk/agent-preset`: where a preset dials **behavior** (subtractive
tool/command selection, persona, permission posture), a pack contributes **capability** (new tools,
command modules, subagents). This package produces contract types + one pure fold; it performs no session
assembly and no IO. (ARCH-005.)

## Boundaries

- Does **not** assemble sessions, construct providers, resolve presets, or build runtimes — those belong
  to `agent-framework` (assembly/runtime seam) and `@robota-sdk/agent-product` (the assembler that
  consumes this merger).
- Does **not** read settings, files, or env, and declares no classes with IO — it is a contract + pure
  function package (mirrors the Preset Package Rule verbatim).
- Does **not** execute contributed code. `mergeCapabilityPacks` folds pack contributions purely; any
  contributed command/tool runs only through the existing permission-gated runtime (`PermissionEnforcer`)
  at call time, never by the mere act of being merged.
- Does **not** re-export `agent-framework` or `agent-core` (no pass-through re-export). It depends on them
  for **contract types only** (`ICommandModule` / `IAgentDefinition` from the framework, `FunctionTool`
  from core).

## Model-facing / declarative-vs-executable note (R6)

A capability pack is **NOT declarative JSON.** Unlike a serialized manifest (e.g. VS Code's `contributes`
block, which the host can enumerate without running contributor code), a pack carries **executable code
objects** — `ICommandModule` values with `systemCommands` handlers, `FunctionTool` instances with
`execute` functions, and subagent definitions. It is an **in-process composition argument** — a live
value handed to the assembler, not a serialized declaration. The "no function across a serialization
boundary" property that governs VS Code manifests is therefore N/A here.

The honest safety property is not "inert JSON" but three invariants:

1. **Packs are OPT-IN** — a pack contributes only when a product profile lists it (following ESLint's
   "plugins cannot force a specific configuration to be used"). A pack never self-activates.
2. **The merge is pure** — `mergeCapabilityPacks` executes none of the contributed code; it only folds
   the declarations into a superset.
3. **Contributed code runs only through the permission-gated runtime** — a merged command/tool executes
   solely through the existing `PermissionEnforcer` at call time.

## Architecture Overview

```
agent-core        ← FunctionTool contract (tool object SSOT)
agent-framework   ← ICommandModule / IAgentDefinition contracts
  └── agent-capability-pack   ← this package: ICapabilityPack contract + mergeCapabilityPacks
        ├── capability-pack-types.ts   ← ICapabilityPack / IMergedCapabilities / IRejectedCapability (SSOT for the pack shape)
        └── merge-capability-packs.ts  ← the pure additive fold (analog of resolvePreset)
```

`mergeCapabilityPacks(baseCommandModules, packs)` produces the `base ⊕ pack` superset and a
`{ merged, rejected }` result (mirroring `IPresetRegistrationResult`). **ONE precedence order, no silent
override:** `baseCommandModules` < packs in profile order. A later contribution whose id duplicates an
already-claimed id is REJECTED and reported in `rejected` — never silently overridden. Ids are claimed per
bucket: command modules by `ICommandModule.name`, tools by `FunctionTool.getName()`, subagents by
`IAgentDefinition.name`. The merger produces only the superset; a preset's
`enabledCommandModules`/`disabledCommandModules` delta is applied AFTER this merge by the product shell —
this widens, the preset delta filters, they compose.

## Type Ownership

Types owned by this package (SSOT):

| Type                  | Location                   | Purpose                                                                              |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| `ICapabilityPack`     | `capability-pack-types.ts` | Additive bundle: identity triple + optional `commandModules` / `tools` / `subagents` |
| `IMergedCapabilities` | `capability-pack-types.ts` | `{ merged: { commandModules, tools, subagents }; rejected }` fold result             |
| `IRejectedCapability` | `capability-pack-types.ts` | `{ kind, id, reason }` — a contribution dropped for a colliding id                   |
| `TCapabilityKind`     | `capability-pack-types.ts` | `'commandModule' \| 'tool' \| 'subagent'`                                            |

## Public API Surface

| Export                 | Kind      | Description                                                                                                                              |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ICapabilityPack`      | Interface | Additive capability bundle (identity triple + optional command-module/tool/subagent buckets)                                             |
| `IMergedCapabilities`  | Interface | `{ merged: { commandModules, tools, subagents }; rejected }` — the pure merge result                                                     |
| `IRejectedCapability`  | Interface | `{ kind, id, reason }` — a contribution rejected for a colliding id                                                                      |
| `TCapabilityKind`      | Type      | `'commandModule' \| 'tool' \| 'subagent'`                                                                                                |
| `mergeCapabilityPacks` | Function  | `(baseCommandModules, packs) => IMergedCapabilities`; pure additive fold, deterministic profile-order precedence, `{ merged, rejected }` |

## Merge Semantics — conflict resolution (R5)

`mergeCapabilityPacks` is a pure, deterministic, IO-free fold — the additive analog of `resolvePreset`.

- **Precedence:** `baseCommandModules` (command modules only) claim the namespace first, then packs in
  profile order. First registration wins.
- **Rejection channel:** a contribution whose id is already claimed is dropped from `merged` and reported
  in `rejected` with a `kind`, `id`, and `reason`. Reasons distinguish a base collision from a
  pack-vs-pack duplicate:
  - `'collides with base command module'` / `'collides with base tool'` / `'collides with base subagent'`
    — the base already owns this id (tools/subagents have no base in the current profile shape, so these
    surface only if a future caller supplies base buckets).
  - `'duplicate commandModule id'` / `'duplicate tool id'` / `'duplicate subagent id'` — an earlier pack
    already claimed this id.
- **Purity:** the merger reads only its arguments and returns fresh arrays; it mutates neither
  `baseCommandModules` nor any pack, and executes no contributed code.

## Extension Points

| Extension Point   | Kind      | How to extend                                                                                        |
| ----------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `ICapabilityPack` | Interface | Author a pack object conforming to `ICapabilityPack` (see `@robota-sdk/pack-coding` for a reference) |

## Error Taxonomy

This package defines no error classes and throws no errors. A colliding contribution is surfaced through
the `IMergedCapabilities.rejected` channel, never as a thrown exception.

## Test Strategy

`src/__tests__/merge-capability-packs.test.ts` (vitest) covers: additive merge of a pack command module
on top of base modules; additive pack tools and subagents; deterministic profile-order precedence across
multiple packs; the `{ merged, rejected }` conflict contract (base collision, pack-vs-pack duplicate for
command modules, tools, and subagents); and input immutability (purity). The `test` script runs
`vitest run --passWithNoTests`.

## Class Contract Registry

This package contains no classes. It exports interfaces, one type union, and one pure function. No
abstract classes or cross-package port implementations are defined here.

## Dependencies

- `@robota-sdk/agent-core` — consumed for the `FunctionTool` tool contract (tool object SSOT).
- `@robota-sdk/agent-framework` — consumed for the `ICommandModule` and `IAgentDefinition` contracts.

No other workspace dependency. Neither is re-exported (no pass-through re-export).
