# @robota-sdk/agent-product

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
- Updated dependencies [007fd90]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-framework@3.0.0-beta.81
  - @robota-sdk/agent-capability-pack@3.0.0-beta.81
  - @robota-sdk/agent-interface-transport@3.0.0-beta.81
  - @robota-sdk/agent-preset@3.0.0-beta.81

## 3.0.0-beta.80

### Minor Changes

- 378c585: ARCH-005 Stage S1 — the external product-composition layer. Three new published packages plus a minimal
  `agent-preset` addition:

  - **`@robota-sdk/agent-capability-pack`** (new) — the additive capability-bundle contract
    (`ICapabilityPack`) and the pure `mergeCapabilityPacks` merger (base ⊕ packs in profile order, with a
    `{ merged, rejected }` conflict channel — never a silent override). The additive analog of
    `agent-preset`; contract + pure fold, no IO.
  - **`@robota-sdk/agent-product`** (new) — the product-assembly kernel. `assembleProduct(profile)` is a pure,
    deterministic, IO-free fold over `IProductProfile` with zero product-specific branching: it resolves
    presets via a per-call instance-scoped registry, merges additive packs, and DELEGATES runtime
    construction to `agent-framework`'s `buildRuntimeSession` seam (never re-implemented). Its neutrality is
    enforced by three mechanical guards (dependency-graph neutrality, purity/no-IO, no product-name
    conditionals), coupling the amended project-structure L129 carve-out to the guards.
  - **`@robota-sdk/pack-coding`** (new) — robota's coding capability as one `ICapabilityPack` (the built-in
    coding tools, the `/shell` + `/editor` command modules, and the coding subagents) — the additive-axis
    proof and robota's first pack.
  - **`@robota-sdk/agent-preset`** — adds `createPresetRegistry`, a per-call instance-scoped resolver that
    never mutates the module-level external-preset global (consumed by `assembleProduct`).

  `agent-framework` and `agent-core` are unchanged. The CLI is not yet wired to `assembleProduct` (that is
  Stage S2).

- 4c5148e: ARCH-005 Stage S2 — `robota` is now expressed as an `IProductProfile` and assembled by `assembleProduct`;
  the hand-wired composition root in `agent-cli` is gone.

  - **`@robota-sdk/agent-product`** — provider construction returns IN-KERNEL. `assembleProduct` builds the
    provider from `providerDefinitions` + the shell's already-resolved `providerSettings` via agent-core's
    pure `createProviderFromConfig`; `provider` is now an OPTIONAL injected override. Both are optional, so a
    Mode A profile can carry only `providerDefinitions`. The fold stays pure and IO-free — every
    settings/env/file read still happens in the shell. Adds `IAssembledProduct.buildRuntimeOptions`, the pure
    overlay `buildRuntime` delegates through, and `IAssembledProduct.providerDefinitions`.
    **Breaking for pre-release consumers:** `IProductProfile.providerDefinitions` is now required and
    `IProductProfile.provider` / `IAssembledProduct.provider` are now optional.
  - **`@robota-sdk/agent-framework`** — a scoped, additive session seam: `agentDefinitions` on
    `TInteractiveSessionOptions` / `ICreateSessionOptions`, composed into the built-in agent tier ahead of
    `BUILT_IN_AGENTS`, so capability-pack subagents actually reach the runtime. Precedence: discovered
    project/user definitions > injected > built-in. `AgentDefinitionLoader` now dedupes within that tier
    (first wins). Absent ⇒ unchanged behavior.
  - **`@robota-sdk/agent-transport` / `@robota-sdk/agent-transport-tui`** — forward the optional
    `agentDefinitions` through the headless and TUI channels so every robota surface carries the seam.
  - **`@robota-sdk/agent-cli`** — `robota`'s identity (branding, provider surface, presets,
    `packs: [codingPack]`, base command modules, injected transports/runners/subagent factory) is declared as
    data in a product profile and folded by `assembleProduct`. The coding command modules (`/shell`,
    `/editor`) now come from `pack-coding` rather than the base set, so the pack is load-bearing. What remains
    in the CLI is product-shell only: arg parsing, settings/file IO, terminal notices, first-run/init/
    `--configure`, memory + session-resume UX, and print/serve/TUI mode dispatch.

  End-user `robota` behavior is unchanged in substance — the assembled command-module set, provider surface,
  tool set, subagent roster, and preset resolution all match the pre-change assembly — with one accepted
  cosmetic delta: `/shell` and `/editor` now appear at the END of `/help` output and of the slash-command
  autocomplete popup rather than mid-list, because they arrive from `pack-coding` and both surfaces render in
  module-insertion order. Same commands, same behavior, different position.

- 37af5dc: ARCH-006 + ARCH-007 — the capability-pack TOOL axis reaches parity with the command and subagent axes,
  and `robota` consumes the composition kernel's RUNTIME SEAM instead of only its materials.

  - **`@robota-sdk/agent-framework` (ARCH-006)** — the default tool set is no longer hard-coded.
    `createSession` accepts `defaultTools`, which REPLACES the `createDefaultTools()` tier (`[]` suppresses
    it entirely) — the tool-axis mirror of NEUT-003's `builtInAgents` seam for subagents. The assembled
    list `defaultTools ⊕ additionalTools ⊕ goalTool` is now **deduplicated by tool name, first occurrence
    wins**, the same rule `AgentDefinitionLoader` applies within the subagent built-in tier. So a
    contributed tool with a NEW name is additive, a contributed tool that mirrors a framework default is
    deduped rather than listed twice, and a product can hand its whole tool surface to its capability
    packs. A name collision keeps the framework default and drops the contribution: the default tier is
    built WITH the session context (`cwd` supplies `agent-tools`' working-directory path guard, plus the
    sandbox client and retrieval adapter) and an already-constructed contribution carries none of it, so
    replacement is expressible only through the explicit `defaultTools` seam — never as a side effect of a
    collision. The edit-checkpoint wrap now covers the assembled set, so a pack-contributed `Write`/`Edit`
    is checkpointed too. Option threaded through `ICreateSessionOptions` / `IInitOptions` /
    `IInteractiveSessionStandardOptions`. Absent `defaultTools` and absent a duplicate name, every existing
    path is byte-identical.
  - **`@robota-sdk/agent-product` (ARCH-007)** — `buildRuntimeOptions` no longer overwrites a
    caller-supplied `commandModules`. A shell that has already narrowed the merged `base ⊕ packs` superset
    (as `robota` does with its preset's enabled/disabled delta) keeps that selection; the assembled set is
    overlaid only when the caller left it unset — the same rule `permissionMode` already followed.
  - **`@robota-sdk/agent-cli` (ARCH-007)** — `startCli` now routes through
    `product.buildRuntimeOptions(...)`. The shell resolves its own session inputs and the kernel lays the
    product-owned materials on top: the packs' tools (`additionalTools`), the packs' subagents
    (`agentDefinitions`), and the default preset's permission posture when `--permission-mode` left it
    unset. The hand-threaded `product.subagents` path and the three per-surface
    `args.permissionMode ?? resolvedPreset.permissionMode` expressions are gone — every surface binds to
    the one kernel result.

  End-user `robota` behavior is unchanged: the assembled command-module set, provider surface, tool set,
  subagent roster, preset resolution, and permission posture all match the pre-change assembly.

- d157f4b: ARCH-008 — `robota` resolves presets through the composition kernel's per-call registry, so there is one
  preset resolution path instead of two.

  - **`@robota-sdk/agent-product`** — `IProductProfile` gains two optional fields. `presetRegistry` lets a
    consumer hand in an `IPresetRegistry` it already built (`createPresetRegistry`); when present the
    assembler ADOPTS that instance instead of building a second, equivalent one, so `product.presets` is
    that very object. This is the seam for a shell that must resolve a preset BEFORE it can build its
    profile — a preset can carry the `model` and `agentName` the profile is itself constructed from, so
    "resolve, then assemble" is a real ordering constraint. `presetContext` carries the override layers
    (`cliOverrides` / `explicit`) used when resolving `defaultPresetId`, so `product.defaultPreset` is the
    caller's full resolution rather than a variant missing its overrides. R8 is unaffected: the registry is
    still instance-scoped and no module-level state is read or mutated. Both fields are optional and the
    existing `presets` + `defaultPresetId` shape behaves exactly as before.
  - **`@robota-sdk/agent-cli`** — `resolveCliPreset` is replaced by `resolveShellPreset(externalPresets,
args, settingsPreset)`, which builds the per-call registry, resolves over it, and returns
    `{ registry, presetId, context, options }` as one value. `createRobotaProfile` takes that whole value,
    so the shell cannot hand the kernel a registry, id, or override context other than the ones it actually
    resolved with. `robota`'s startup path no longer reads `agent-preset`'s module-global resolver; that
    registry remains only as the in-session `/preset` DISCOVERY surface, which is executed inside the
    session and has no handle on the assembled product. Both surfaces are fed by the one
    `loadExternalPresets()` call, so they cannot disagree.

  End-user `robota` behavior is unchanged: the same preset resolves to the same options, external presets
  in `~/.robota/presets/*.json` remain visible to both `--preset <id>` and `/preset`, and the assembled
  command-module set, provider surface, tool set, subagent roster, and permission posture are untouched.

- 2d3b2c0: ARCH-027 makes product and capability-pack composition contracts exhaustive and observable. Capability
  pack merging now preserves accepted `id`/`title`/`description` metadata, rejects later duplicate pack ids
  atomically through `rejectedPacks`, and includes the contributor `packId` on every capability collision.
  `assembleProduct` projects all three result channels losslessly.

  This is a beta-line breaking contract correction: `IProductProfile.providerOverride` is removed because
  provider-name selection belongs to the shell's settings resolution, and capability rejection values now
  require `packId`.

- 90e7a10: The default background observer warning code and exported `OBSERVER_FAILURE_WARNING_CODE` value
  change from `ROBOTA_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
  the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
  their background manager or session options. The Robota CLI supplies its existing code explicitly
  across print, goal, serve, MCP, and TUI sessions.

### Patch Changes

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [08a9bd6]
- Updated dependencies [37b4bd7]
- Updated dependencies [818f0c8]
- Updated dependencies [4eea54b]
- Updated dependencies [1698be4]
- Updated dependencies [a5961c9]
- Updated dependencies [9368d00]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [af2f2ad]
- Updated dependencies [267af5f]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [a5cc36e]
- Updated dependencies [d23c848]
- Updated dependencies [b70fa3d]
- Updated dependencies [2711ec6]
- Updated dependencies [4dd45cc]
- Updated dependencies [378c585]
- Updated dependencies [4c5148e]
- Updated dependencies [37af5dc]
- Updated dependencies [807d161]
- Updated dependencies [fec722f]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [9db63ee]
- Updated dependencies [b078afa]
- Updated dependencies [2ebff01]
- Updated dependencies [9db63ee]
- Updated dependencies [2ebff01]
- Updated dependencies [2d3b2c0]
- Updated dependencies [b078afa]
- Updated dependencies [2d3b2c0]
- Updated dependencies [baa6863]
- Updated dependencies [2d3b2c0]
- Updated dependencies [2d3b2c0]
- Updated dependencies [3a8876b]
- Updated dependencies [4772067]
- Updated dependencies [7b85767]
- Updated dependencies [0f98419]
- Updated dependencies [64ba748]
- Updated dependencies [9fbab1b]
- Updated dependencies [d312755]
- Updated dependencies [a009f5b]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [bed26ea]
- Updated dependencies [fe48835]
- Updated dependencies [1e40b5b]
- Updated dependencies [7669851]
- Updated dependencies [4b76cfa]
- Updated dependencies [d9bd9ec]
- Updated dependencies [8865acf]
- Updated dependencies [90e7a10]
- Updated dependencies [fcb0da3]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [dd444c1]
- Updated dependencies [1f57e7f]
- Updated dependencies [833afe1]
- Updated dependencies [d6b9404]
- Updated dependencies [7863b16]
- Updated dependencies [fde558e]
- Updated dependencies [db5c439]
- Updated dependencies [4a01a87]
- Updated dependencies [cbee54e]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
- Updated dependencies [242a644]
  - @robota-sdk/agent-framework@3.0.0-beta.80
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-interface-transport@3.0.0-beta.80
  - @robota-sdk/agent-capability-pack@3.0.0-beta.80
  - @robota-sdk/agent-preset@3.0.0-beta.80
