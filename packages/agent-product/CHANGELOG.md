# @robota-sdk/agent-product

## 3.2.1
### Patch Changes

  - @robota-sdk/agent-framework@3.2.1
  - @robota-sdk/agent-capability-pack@3.2.1
  - @robota-sdk/agent-preset@3.2.1
  - @robota-sdk/agent-core@3.2.1
  - @robota-sdk/agent-interface-transport@3.2.1

## 3.2.0
### Patch Changes

- Updated dependencies [e5ce7d6]
- Updated dependencies [12ab3f5]
- Updated dependencies [ffaf7d5]
- Updated dependencies [9da9c6c]
- Updated dependencies [ad5e9fb]
  - @robota-sdk/agent-framework@3.2.0
  - @robota-sdk/agent-core@3.2.0
  - @robota-sdk/agent-capability-pack@3.2.0
  - @robota-sdk/agent-preset@3.2.0
  - @robota-sdk/agent-interface-transport@3.2.0

## 3.1.2
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.1.2
  - @robota-sdk/agent-core@3.1.2
  - @robota-sdk/agent-framework@3.1.2
  - @robota-sdk/agent-interface-transport@3.1.2
  - @robota-sdk/agent-preset@3.1.2

## 3.1.1
### Patch Changes

  - @robota-sdk/agent-framework@3.1.1
  - @robota-sdk/agent-capability-pack@3.1.1
  - @robota-sdk/agent-preset@3.1.1
  - @robota-sdk/agent-core@3.1.1
  - @robota-sdk/agent-interface-transport@3.1.1

## 3.1.0
### Minor Changes

- ee7f7ef: Make the main entries of `@robota-sdk/agent-tools`, `@robota-sdk/agent-framework`, `@robota-sdk/agent-command`, `@robota-sdk/agent-preset` and `@robota-sdk/agent-product` platform-neutral. They run unchanged in a browser, a Web Worker, Node, Deno and Bun, and no longer map `"browser": null` on `.`. Every package is now in exactly one of ARCHITECTURE.md's three platform lists; the "Not yet neutral" list is gone.

  - `@robota-sdk/agent-tools` no longer re-exports `GrepIsolationError`, `ReadByteLimitError`, `ReadCancelledError`, `createBashTool`, `createEditTool`, `createGlobTool`, `createGrepTool`, `createReadTool`, `createShellTool`, `createWriteTool` and `webFetchTool` from its main entry. They are on `@robota-sdk/agent-tools/node` only, which is where `@robota-sdk/workflows` 0.0.4 imports them.
  - The five packages build once into `dist` (not `dist/node`) and their `exports` map `import` and `require` only. A Node-only subpath keeps `"browser": null`: `./node` on `agent-tools`, `agent-framework`, `agent-command` and `agent-preset`, and `./testing` on `agent-framework`. Specifiers and the code behind them are unchanged; only a deep import of `dist/node/*` breaks.
  - `/user-local` and `executeUserLocalDirectCommand` read and write their storage root through an injected file system, as `/doctor` does through `doctorDeps`: `createUserLocalCommandModule(storageRoot, fsAsync)`, the `userLocalFileSystem` option of `createDefaultCommandModules` and the `fsAsync` option of `executeUserLocalDirectCommand`. They no longer import `NodeFileSystemAsync` themselves, and absent a file system the command is listed and answers that it is unavailable on this host; nothing is read or written.
  - `@robota-sdk/agent-cli` passes `new NodeFileSystemAsync()` from `@robota-sdk/agent-framework/node` for both, so `/user-local` and `agent user-local` behave as before.
- 7ce5e73: Add the framework host and make `host` and `cwd` required wherever the framework builds a session. The host is passed and accepted but nothing reads it yet, so behaviour is unchanged.

  - `@robota-sdk/agent-framework`: `IFrameworkHost` lists what a platform lends the framework (home directory, workspace resolver, path canonicalizer, exit flush, environment, files, git, git remotes, hook executors, background task runners, default tools, observer failure report, async scope, project mutation support). Every member is optional and an absent one means the capability is off, so `{}` is a valid host. `IAsyncScope` is the port behind `createAsyncScope`.
  - `@robota-sdk/agent-framework/node` (new, `"browser": null`) exports `createNodeFrameworkHost({ createDefaultTools })`, which fills every member for a Node process. The composition root names `createDefaultTools` from `@robota-sdk/agent-tool-defaults`; pass `() => []` for sessions with no default tier. `@robota-sdk/agent-framework/testing` exports `createTestFrameworkHost(overrides?)`, the same host with the real default tools, where an override replaces a member and an explicit `undefined` removes it.
  - `host` is required on `InteractiveSession` (both construction shapes, so on `buildRuntimeSession` and `startRuntimeHost` too), `createSession`, `createSubagentSession`, `createQuery`, `createAgentRuntime` and `createStatelessRuntime`, and on the options of `createInteractiveRuntime`, `createProgrammaticAgent`, `HeadlessInteractionChannel` and an in-process subagent runner. A missing `host` throws at construction, naming `createNodeFrameworkHost`.
  - `cwd` is required, and absolute as it already had to be, on `createSession`, `createQuery`, `createStatelessRuntime` and an injected-session `InteractiveSession`. The `process.cwd()` fallback is gone: a caller that relied on it passes `process.cwd()` itself.
  - `@robota-sdk/agent-cli`: `startCliCore` takes the host as its second argument and `runPrintMode` as its second after the product runtime; `startCli` and the headless entry build it with `createNodeFrameworkHost`. `IRunEvalDeps.host` is required unless `runFn` is given.
  - `@robota-sdk/agent-subagent-runner`: `ISubagentWorkerComposition.host` is required; the worker builds its child session on it, and the product's composition supplies it.
  - `@robota-sdk/agent-ui-terminal`: `IRenderOptions` and `ITuiInteractionChannelOptions` take `host`.
  - `@robota-sdk/agent-command`, `@robota-sdk/agent-product`: their tests and scenario scripts pass a host; no published surface changes.

### Patch Changes

- Updated dependencies [bc8de21]
- Updated dependencies [51ad6a4]
- Updated dependencies [d46727b]
- Updated dependencies [bc8de21]
- Updated dependencies [bc8de21]
- Updated dependencies [bc8de21]
- Updated dependencies [bc8de21]
- Updated dependencies [bc8de21]
- Updated dependencies [eabce48]
- Updated dependencies [bc8de21]
- Updated dependencies [eabce48]
- Updated dependencies [bc8de21]
- Updated dependencies [eabce48]
- Updated dependencies [bc8de21]
- Updated dependencies [82663df]
- Updated dependencies [bc8de21]
- Updated dependencies [bc8de21]
- Updated dependencies [04c3233]
- Updated dependencies [9bc13f9]
- Updated dependencies [830d3d2]
- Updated dependencies [0a677e9]
- Updated dependencies [a8c9e25]
- Updated dependencies [5b46d43]
- Updated dependencies [fab48ad]
- Updated dependencies [a2d36ea]
- Updated dependencies [ea0e424]
- Updated dependencies [ee7f7ef]
- Updated dependencies [a2d36ea]
- Updated dependencies [0fec62f]
- Updated dependencies [7ce5e73]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [0fec62f]
- Updated dependencies [be32d9b]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [b7b6cd0]
- Updated dependencies [8069d0e]
- Updated dependencies [f5e3057]
- Updated dependencies [d8cb04f]
- Updated dependencies [42d595e]
- Updated dependencies [437ca9e]
- Updated dependencies [0a677e9]
- Updated dependencies [44e9640]
- Updated dependencies [b56b5a9]
- Updated dependencies [1c19435]
- Updated dependencies [4e4c92a]
- Updated dependencies [6ba10ef]
  - @robota-sdk/agent-core@3.1.0
  - @robota-sdk/agent-framework@3.1.0
  - @robota-sdk/agent-preset@3.1.0
  - @robota-sdk/agent-interface-transport@3.1.0
  - @robota-sdk/agent-capability-pack@3.1.0

## 3.0.7
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.7
  - @robota-sdk/agent-capability-pack@3.0.7
  - @robota-sdk/agent-preset@3.0.7
  - @robota-sdk/agent-core@3.0.7
  - @robota-sdk/agent-interface-transport@3.0.7

## 3.0.6
### Patch Changes

  - @robota-sdk/agent-framework@3.0.6
  - @robota-sdk/agent-capability-pack@3.0.6
  - @robota-sdk/agent-preset@3.0.6
  - @robota-sdk/agent-core@3.0.6
  - @robota-sdk/agent-interface-transport@3.0.6

## 3.0.5
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.5
  - @robota-sdk/agent-core@3.0.5
  - @robota-sdk/agent-framework@3.0.5
  - @robota-sdk/agent-interface-transport@3.0.5
  - @robota-sdk/agent-preset@3.0.5

## 3.0.4
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.4
  - @robota-sdk/agent-core@3.0.4
  - @robota-sdk/agent-framework@3.0.4
  - @robota-sdk/agent-interface-transport@3.0.4
  - @robota-sdk/agent-preset@3.0.4

## 3.0.3
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.3
  - @robota-sdk/agent-core@3.0.3
  - @robota-sdk/agent-framework@3.0.3
  - @robota-sdk/agent-interface-transport@3.0.3
  - @robota-sdk/agent-preset@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.2
  - @robota-sdk/agent-core@3.0.2
  - @robota-sdk/agent-framework@3.0.2
  - @robota-sdk/agent-interface-transport@3.0.2
  - @robota-sdk/agent-preset@3.0.2

## 3.0.1
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.1
  - @robota-sdk/agent-core@3.0.1
  - @robota-sdk/agent-framework@3.0.1
  - @robota-sdk/agent-interface-transport@3.0.1
  - @robota-sdk/agent-preset@3.0.1

## 3.0.0
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
  - **`@robota-sdk/pack-coding`** (new) — the configured product's coding capability as one `ICapabilityPack` (the built-in
    coding tools, the `/shell` + `/editor` command modules, and the coding subagents) — the additive-axis
    proof and the configured product's first pack.
  - **`@robota-sdk/agent-preset`** — adds `createPresetRegistry`, a per-call instance-scoped resolver that
    never mutates the module-level external-preset global (consumed by `assembleProduct`).

  `agent-framework` and `agent-core` are unchanged. The CLI is not yet wired to `assembleProduct` (that is
  Stage S2).
- 4c5148e: ARCH-005 Stage S2 — `configured CLI` is now expressed as an `IProductProfile` and assembled by `assembleProduct`;
  the hand-wired composition root in `agent-cli` is gone.

  - **`@robota-sdk/agent-product`** — provider construction returns IN-KERNEL. `assembleProduct` builds the
    provider from `providerDefinitions` + the shell's already-resolved `providerSettings` vian agent-core's
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
    `agentDefinitions` through the headless and TUI channels so every product surface carries the seam.
  - **`@robota-sdk/agent-cli`** — `configured CLI`'s identity (branding, provider surface, presets,
    `packs: [codingPack]`, base command modules, injected transports/runners/subagent factory) is declared as
    data in a product profile and folded by `assembleProduct`. The coding command modules (`/shell`,
    `/editor`) now come from `pack-coding` rather than the base set, so the pack is load-bearing. What remains
    in the CLI is product-shell only: arg parsing, settings/file IO, terminal notices, first-run/init/
    `--configure`, memory + session-resume UX, and print/serve/TUI mode dispatch.

  End-user `configured CLI` behavior is unchanged in substance — the assembled command-module set, provider surface,
  tool set, subagent roster, and preset resolution all match the pre-change assembly — with one accepted
  cosmetic delta: `/shell` and `/editor` now appear at the END of `/help` output and of the slash-command
  autocomplete popup rather than mid-list, because they arrive from `pack-coding` and both surfaces render in
  module-insertion order. Same commands, same behavior, different position.
- 37af5dc: ARCH-006 + ARCH-007 — the capability-pack TOOL axis reaches parity with the command and subagent axes,
  and `configured CLI` consumes the composition kernel's RUNTIME SEAM instead of only its materials.

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
    (as `configured CLI` does with its preset's enabled/disabled delta) keeps that selection; the assembled set is
    overlaid only when the caller left it unset — the same rule `permissionMode` already followed.
  - **`@robota-sdk/agent-cli` (ARCH-007)** — `startCli` now routes through
    `product.buildRuntimeOptions(...)`. The shell resolves its own session inputs and the kernel lays the
    product-owned materials on top: the packs' tools (`additionalTools`), the packs' subagents
    (`agentDefinitions`), and the default preset's permission posture when `--permission-mode` left it
    unset. The hand-threaded `product.subagents` path and the three per-surface
    `args.permissionMode ?? resolvedPreset.permissionMode` expressions are gone — every surface binds to
    the one kernel result.

  End-user `configured CLI` behavior is unchanged: the assembled command-module set, provider surface, tool set,
  subagent roster, preset resolution, and permission posture all match the pre-change assembly.
- d157f4b: ARCH-008 — `configured CLI` resolves presets through the composition kernel's per-call registry, so there is one
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
    `{ registry, presetId, context, options }` as one value. `createSelectedProductProfile` takes that whole value,
    so the shell cannot hand the kernel a registry, id, or override context other than the ones it actually
    resolved with. `configured CLI`'s startup path no longer reads `agent-preset`'s module-global resolver; that
    registry remains only as the in-session `/preset` DISCOVERY surface, which is executed inside the
    session and has no handle on the assembled product. Both surfaces are fed by the one
    `loadExternalPresets()` call, so they cannot disagree.

  End-user `configured CLI` behavior is unchanged: the same preset resolves to the same options, external presets
  in `the configured user data directory*.json` remain visible to both `--preset <id>` and `/preset`, and the assembled
  command-module set, provider surface, tool set, subagent roster, and permission posture are untouched.
- 2d3b2c0: ARCH-027 makes product and capability-pack composition contracts exhaustive and observable. Capability
  pack merging now preserves accepted `id`/`title`/`description` metadata, rejects later duplicate pack ids
  atomically through `rejectedPacks`, and includes the contributor `packId` on every capability collision.
  `assembleProduct` projects all three result channels losslessly.

  This is a beta-line breaking contract correction: `IProductProfile.providerOverride` is removed because
  provider-name selection belongs to the shell's settings resolution, and capability rejection values now
  require `packId`.
- 90e7a10: The default background observer warning code and exported `OBSERVER_FAILURE_WARNING_CODE` value
  change from `PRODUCT_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
  the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
  their background manager or session options. The configured CLI supplies its existing code explicitly
  across print, goal, serve, MCP, and TUI sessions.

### Patch Changes

- 57280bf: Every published package now declares `"engines": { "node": ">=22.12.0" }`. Before, 27 of the 38
  packages declared no floor (`agent-core`, `agent-tools` and every provider among them),
  `agent-session` and `agent-file-authority` declared `>=20.19.0`, and the other nine declared
  `>=22.0.0`, so a consumer on Node 20 saw at most a warning from a transitive dependency.

  Why 22.12: `agent-cli` and `agent-ui-terminal` need Node 22 through `ink` 7, and the CommonJS entries
  of `agent-tools` and its dependents, `agent-transport`/`node` and its dependents, and
  `agent-ui-terminal` `require()` ESM-only dependencies (`p-limit`, `jose`, `chalk`), which Node 22
  supports unflagged only from 22.12. `engines` is advisory unless the consumer enables `engine-strict`.

  No code changes: `tsdown` now reads `node22.12.0` as its build target from the field.
- 18c0d5c: Every published package now exports `./package.json`, so `require('<package>/package.json')` and
  `import('<package>/package.json', { with: { type: 'json' } })` work instead of failing with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and each tarball now ships the package's `CHANGELOG.md`.
- 2c612ba: Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [08a9bd6]
- Updated dependencies [37b4bd7]
- Updated dependencies [818f0c8]
- Updated dependencies [4eea54b]
- Updated dependencies [3c81769]
- Updated dependencies [724fabb]
- Updated dependencies [997f2fb]
- Updated dependencies [bfe8ed5]
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
- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [4dd45cc]
- Updated dependencies [e689c8e]
- Updated dependencies [4241fc5]
- Updated dependencies [ec5e477]
- Updated dependencies [4f49d14]
- Updated dependencies [007fd90]
- Updated dependencies [c7f9203]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [9721162]
- Updated dependencies [be0e53c]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [7d77ce4]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
- Updated dependencies [caaab20]
- Updated dependencies [f01868f]
- Updated dependencies [e8779c9]
- Updated dependencies [5a0ee96]
- Updated dependencies [9f46375]
- Updated dependencies [4e11579]
- Updated dependencies [41cca13]
- Updated dependencies [193a0bc]
- Updated dependencies [54e2848]
- Updated dependencies [3c1967f]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [5684612]
- Updated dependencies [6ee8725]
- Updated dependencies [6072e9a]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
- Updated dependencies [2e07cad]
- Updated dependencies [e8d70ac]
- Updated dependencies [2c612ba]
- Updated dependencies [66af868]
- Updated dependencies [e079992]
- Updated dependencies [7116367]
- Updated dependencies [5bb675a]
- Updated dependencies [e706b43]
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [6f41c53]
- Updated dependencies [7d9cc66]
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
- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [7d9cc66]
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
- Updated dependencies [7d9cc66]
- Updated dependencies [fe48835]
- Updated dependencies [7d9cc66]
- Updated dependencies [1e40b5b]
- Updated dependencies [7669851]
- Updated dependencies [bad976f]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [df02568]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [4b76cfa]
- Updated dependencies [d9bd9ec]
- Updated dependencies [8865acf]
- Updated dependencies [90e7a10]
- Updated dependencies [fcb0da3]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9c6a8db]
- Updated dependencies [dfb9b15]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [5134b3b]
- Updated dependencies [dd444c1]
- Updated dependencies [1f57e7f]
- Updated dependencies [7911a7d]
- Updated dependencies [833afe1]
- Updated dependencies [d6b9404]
- Updated dependencies [7863b16]
- Updated dependencies [fde558e]
- Updated dependencies [db5c439]
- Updated dependencies [7d9cc66]
- Updated dependencies [62663ae]
- Updated dependencies [4a01a87]
- Updated dependencies [cbee54e]
- Updated dependencies [23a30cd]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
- Updated dependencies [7d9cc66]
- Updated dependencies [02053ec]
- Updated dependencies [242a644]
  - @robota-sdk/agent-framework@3.0.0
  - @robota-sdk/agent-core@3.0.0
  - @robota-sdk/agent-interface-transport@3.0.0
  - @robota-sdk/agent-capability-pack@3.0.0
  - @robota-sdk/agent-preset@3.0.0

## 3.0.0-beta.106
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.106
  - @robota-sdk/agent-core@3.0.0-beta.106
  - @robota-sdk/agent-framework@3.0.0-beta.106
  - @robota-sdk/agent-interface-transport@3.0.0-beta.106
  - @robota-sdk/agent-preset@3.0.0-beta.106

## 3.0.0-beta.105
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.105
  - @robota-sdk/agent-core@3.0.0-beta.105
  - @robota-sdk/agent-framework@3.0.0-beta.105
  - @robota-sdk/agent-interface-transport@3.0.0-beta.105
  - @robota-sdk/agent-preset@3.0.0-beta.105

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.104
  - @robota-sdk/agent-core@3.0.0-beta.104
  - @robota-sdk/agent-framework@3.0.0-beta.104
  - @robota-sdk/agent-interface-transport@3.0.0-beta.104
  - @robota-sdk/agent-preset@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

- Updated dependencies [6f41c53]
  - @robota-sdk/agent-core@3.0.0-beta.103
  - @robota-sdk/agent-capability-pack@3.0.0-beta.103
  - @robota-sdk/agent-framework@3.0.0-beta.103
  - @robota-sdk/agent-interface-transport@3.0.0-beta.103
  - @robota-sdk/agent-preset@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.102
  - @robota-sdk/agent-core@3.0.0-beta.102
  - @robota-sdk/agent-framework@3.0.0-beta.102
  - @robota-sdk/agent-interface-transport@3.0.0-beta.102
  - @robota-sdk/agent-preset@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

- Updated dependencies [62663ae]
  - @robota-sdk/agent-core@3.0.0-beta.101
  - @robota-sdk/agent-framework@3.0.0-beta.101
  - @robota-sdk/agent-capability-pack@3.0.0-beta.101
  - @robota-sdk/agent-interface-transport@3.0.0-beta.101
  - @robota-sdk/agent-preset@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.100
  - @robota-sdk/agent-core@3.0.0-beta.100
  - @robota-sdk/agent-framework@3.0.0-beta.100
  - @robota-sdk/agent-interface-transport@3.0.0-beta.100
  - @robota-sdk/agent-preset@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.99
  - @robota-sdk/agent-core@3.0.0-beta.99
  - @robota-sdk/agent-framework@3.0.0-beta.99
  - @robota-sdk/agent-interface-transport@3.0.0-beta.99
  - @robota-sdk/agent-preset@3.0.0-beta.99

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.98
  - @robota-sdk/agent-core@3.0.0-beta.98
  - @robota-sdk/agent-framework@3.0.0-beta.98
  - @robota-sdk/agent-interface-transport@3.0.0-beta.98
  - @robota-sdk/agent-preset@3.0.0-beta.98

## 3.0.0-beta.97
### Patch Changes

- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [7911a7d]
- Updated dependencies [23a30cd]
  - @robota-sdk/agent-core@3.0.0-beta.97
  - @robota-sdk/agent-framework@3.0.0-beta.97
  - @robota-sdk/agent-capability-pack@3.0.0-beta.97
  - @robota-sdk/agent-interface-transport@3.0.0-beta.97
  - @robota-sdk/agent-preset@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.96
  - @robota-sdk/agent-core@3.0.0-beta.96
  - @robota-sdk/agent-framework@3.0.0-beta.96
  - @robota-sdk/agent-interface-transport@3.0.0-beta.96
  - @robota-sdk/agent-preset@3.0.0-beta.96

## 3.0.0-beta.95
### Patch Changes

- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-framework@3.0.0-beta.95
  - @robota-sdk/agent-core@3.0.0-beta.95
  - @robota-sdk/agent-capability-pack@3.0.0-beta.95
  - @robota-sdk/agent-preset@3.0.0-beta.95
  - @robota-sdk/agent-interface-transport@3.0.0-beta.95

## 3.0.0-beta.94
### Patch Changes

- Updated dependencies [e079992]
- Updated dependencies [e706b43]
  - @robota-sdk/agent-framework@3.0.0-beta.94
  - @robota-sdk/agent-capability-pack@3.0.0-beta.94
  - @robota-sdk/agent-preset@3.0.0-beta.94
  - @robota-sdk/agent-core@3.0.0-beta.94
  - @robota-sdk/agent-interface-transport@3.0.0-beta.94

## 3.0.0-beta.93
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.93
  - @robota-sdk/agent-framework@3.0.0-beta.93
  - @robota-sdk/agent-capability-pack@3.0.0-beta.93
  - @robota-sdk/agent-interface-transport@3.0.0-beta.93
  - @robota-sdk/agent-preset@3.0.0-beta.93

## 3.0.0-beta.92
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.92
  - @robota-sdk/agent-framework@3.0.0-beta.92
  - @robota-sdk/agent-capability-pack@3.0.0-beta.92
  - @robota-sdk/agent-interface-transport@3.0.0-beta.92
  - @robota-sdk/agent-preset@3.0.0-beta.92

## 3.0.0-beta.91
### Patch Changes

- Updated dependencies [bad976f]
  - @robota-sdk/agent-framework@3.0.0-beta.91
  - @robota-sdk/agent-capability-pack@3.0.0-beta.91
  - @robota-sdk/agent-preset@3.0.0-beta.91
  - @robota-sdk/agent-core@3.0.0-beta.91
  - @robota-sdk/agent-interface-transport@3.0.0-beta.91

## 3.0.0-beta.90
### Patch Changes

- Updated dependencies [7116367]
- Updated dependencies [5bb675a]
  - @robota-sdk/agent-framework@3.0.0-beta.90
  - @robota-sdk/agent-capability-pack@3.0.0-beta.90
  - @robota-sdk/agent-preset@3.0.0-beta.90
  - @robota-sdk/agent-core@3.0.0-beta.90
  - @robota-sdk/agent-interface-transport@3.0.0-beta.90

## 3.0.0-beta.89
### Patch Changes

  - @robota-sdk/agent-framework@3.0.0-beta.89
  - @robota-sdk/agent-capability-pack@3.0.0-beta.89
  - @robota-sdk/agent-core@3.0.0-beta.89
  - @robota-sdk/agent-interface-transport@3.0.0-beta.89
  - @robota-sdk/agent-preset@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- @robota-sdk/agent-framework@3.0.0-beta.88
- @robota-sdk/agent-capability-pack@3.0.0-beta.88
- @robota-sdk/agent-preset@3.0.0-beta.88
- @robota-sdk/agent-core@3.0.0-beta.88
- @robota-sdk/agent-interface-transport@3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- Updated dependencies
- Updated dependencies [66af868]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
  - @robota-sdk/agent-capability-pack@3.0.0-beta.87
  - @robota-sdk/agent-core@3.0.0-beta.87
  - @robota-sdk/agent-framework@3.0.0-beta.87
  - @robota-sdk/agent-interface-transport@3.0.0-beta.87
  - @robota-sdk/agent-preset@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-capability-pack@3.0.0-beta.86
- @robota-sdk/agent-core@3.0.0-beta.86
- @robota-sdk/agent-framework@3.0.0-beta.86
- @robota-sdk/agent-interface-transport@3.0.0-beta.86
- @robota-sdk/agent-preset@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [4e11579]
- Updated dependencies [41cca13]
- Updated dependencies [193a0bc]
- Updated dependencies [54e2848]
- Updated dependencies [3c1967f]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [5684612]
- Updated dependencies [6ee8725]
- Updated dependencies [6072e9a]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
- Updated dependencies [2e07cad]
  - @robota-sdk/agent-framework@3.0.0-beta.85
  - @robota-sdk/agent-core@3.0.0-beta.85
  - @robota-sdk/agent-preset@3.0.0-beta.85
  - @robota-sdk/agent-capability-pack@3.0.0-beta.85
  - @robota-sdk/agent-interface-transport@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- Updated dependencies [9f46375]
- Updated dependencies [e8d70ac]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-core@3.0.0-beta.84
  - @robota-sdk/agent-framework@3.0.0-beta.84
  - @robota-sdk/agent-capability-pack@3.0.0-beta.84
  - @robota-sdk/agent-interface-transport@3.0.0-beta.84
  - @robota-sdk/agent-preset@3.0.0-beta.84

## 3.0.0-beta.83

### Patch Changes

- 57280bf: Every published package now declares `"engines": { "node": ">=22.12.0" }`. Before, 27 of the 38
  packages declared no floor (`agent-core`, `agent-tools` and every provider among them),
  `agent-session` and `agent-file-authority` declared `>=20.19.0`, and the other nine declared
  `>=22.0.0`, so a consumer on Node 20 saw at most a warning from a transitive dependency.

  Why 22.12: `agent-cli` and `agent-ui-terminal` need Node 22 through `ink` 7, and the CommonJS entries
  of `agent-tools` and its dependents, `agent-transport`/`node` and its dependents, and
  `agent-ui-terminal` `require()` ESM-only dependencies (`p-limit`, `jose`, `chalk`), which Node 22
  supports unflagged only from 22.12. `engines` is advisory unless the consumer enables `engine-strict`.

  No code changes: `tsdown` now reads `node22.12.0` as its build target from the field.

- 18c0d5c: Every published package now exports `./package.json`, so `require('<package>/package.json')` and
  `import('<package>/package.json', { with: { type: 'json' } })` work instead of failing with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and each tarball now ships the package's `CHANGELOG.md`.
- Updated dependencies [3c81769]
- Updated dependencies [724fabb]
- Updated dependencies [997f2fb]
- Updated dependencies [bfe8ed5]
- Updated dependencies [e689c8e]
- Updated dependencies [4241fc5]
- Updated dependencies [4f49d14]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [9721162]
- Updated dependencies [be0e53c]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [7d77ce4]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
- Updated dependencies [caaab20]
- Updated dependencies [f01868f]
- Updated dependencies [e8779c9]
- Updated dependencies [5a0ee96]
  - @robota-sdk/agent-framework@3.0.0-beta.83
  - @robota-sdk/agent-interface-transport@3.0.0-beta.83
  - @robota-sdk/agent-core@3.0.0-beta.83
  - @robota-sdk/agent-capability-pack@3.0.0-beta.83
  - @robota-sdk/agent-preset@3.0.0-beta.83

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-framework@3.0.0-beta.82
  - @robota-sdk/agent-capability-pack@3.0.0-beta.82
  - @robota-sdk/agent-interface-transport@3.0.0-beta.82
  - @robota-sdk/agent-preset@3.0.0-beta.82

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
  - **`@robota-sdk/pack-coding`** (new) — __PRODUCT_DISPLAY_NAME__'s coding capability as one `ICapabilityPack` (the built-in
    coding tools, the `/shell` + `/editor` command modules, and the coding subagents) — the additive-axis
    proof and __PRODUCT_DISPLAY_NAME__'s first pack.
  - **`@robota-sdk/agent-preset`** — adds `createPresetRegistry`, a per-call instance-scoped resolver that
    never mutates the module-level external-preset global (consumed by `assembleProduct`).

  `agent-framework` and `agent-core` are unchanged. The CLI is not yet wired to `assembleProduct` (that is
  Stage S2).

- 4c5148e: ARCH-005 Stage S2 — `__PRODUCT_CLI_NAME__` is now expressed as an `IProductProfile` and assembled by `assembleProduct`;
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
    `agentDefinitions` through the headless and TUI channels so every __PRODUCT_DISPLAY_NAME__ surface carries the seam.
  - **`@robota-sdk/agent-cli`** — `__PRODUCT_CLI_NAME__`'s identity (branding, provider surface, presets,
    `packs: [codingPack]`, base command modules, injected transports/runners/subagent factory) is declared as
    data in a product profile and folded by `assembleProduct`. The coding command modules (`/shell`,
    `/editor`) now come from `pack-coding` rather than the base set, so the pack is load-bearing. What remains
    in the CLI is product-shell only: arg parsing, settings/file IO, terminal notices, first-run/init/
    `--configure`, memory + session-resume UX, and print/serve/TUI mode dispatch.

  End-user `__PRODUCT_CLI_NAME__` behavior is unchanged in substance — the assembled command-module set, provider surface,
  tool set, subagent roster, and preset resolution all match the pre-change assembly — with one accepted
  cosmetic delta: `/shell` and `/editor` now appear at the END of `/help` output and of the slash-command
  autocomplete popup rather than mid-list, because they arrive from `pack-coding` and both surfaces render in
  module-insertion order. Same commands, same behavior, different position.

- 37af5dc: ARCH-006 + ARCH-007 — the capability-pack TOOL axis reaches parity with the command and subagent axes,
  and `__PRODUCT_CLI_NAME__` consumes the composition kernel's RUNTIME SEAM instead of only its materials.

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
    (as `__PRODUCT_CLI_NAME__` does with its preset's enabled/disabled delta) keeps that selection; the assembled set is
    overlaid only when the caller left it unset — the same rule `permissionMode` already followed.
  - **`@robota-sdk/agent-cli` (ARCH-007)** — `startCli` now routes through
    `product.buildRuntimeOptions(...)`. The shell resolves its own session inputs and the kernel lays the
    product-owned materials on top: the packs' tools (`additionalTools`), the packs' subagents
    (`agentDefinitions`), and the default preset's permission posture when `--permission-mode` left it
    unset. The hand-threaded `product.subagents` path and the three per-surface
    `args.permissionMode ?? resolvedPreset.permissionMode` expressions are gone — every surface binds to
    the one kernel result.

  End-user `__PRODUCT_CLI_NAME__` behavior is unchanged: the assembled command-module set, provider surface, tool set,
  subagent roster, preset resolution, and permission posture all match the pre-change assembly.

- d157f4b: ARCH-008 — `__PRODUCT_CLI_NAME__` resolves presets through the composition kernel's per-call registry, so there is one
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
    `{ registry, presetId, context, options }` as one value. `createSelectedProductProfile` takes that whole value,
    so the shell cannot hand the kernel a registry, id, or override context other than the ones it actually
    resolved with. `__PRODUCT_CLI_NAME__`'s startup path no longer reads `agent-preset`'s module-global resolver; that
    registry remains only as the in-session `/preset` DISCOVERY surface, which is executed inside the
    session and has no handle on the assembled product. Both surfaces are fed by the one
    `loadExternalPresets()` call, so they cannot disagree.

  End-user `__PRODUCT_CLI_NAME__` behavior is unchanged: the same preset resolves to the same options, external presets
  in `$PRODUCT_USER_STATE_DIR/presets/*.json` remain visible to both `--preset <id>` and `/preset`, and the assembled
  command-module set, provider surface, tool set, subagent roster, and permission posture are untouched.

- 2d3b2c0: ARCH-027 makes product and capability-pack composition contracts exhaustive and observable. Capability
  pack merging now preserves accepted `id`/`title`/`description` metadata, rejects later duplicate pack ids
  atomically through `rejectedPacks`, and includes the contributor `packId` on every capability collision.
  `assembleProduct` projects all three result channels losslessly.

  This is a beta-line breaking contract correction: `IProductProfile.providerOverride` is removed because
  provider-name selection belongs to the shell's settings resolution, and capability rejection values now
  require `packId`.

- 90e7a10: The default background observer warning code and exported `OBSERVER_FAILURE_WARNING_CODE` value
  change from `PRODUCT_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
  the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
  their background manager or session options. The __PRODUCT_DISPLAY_NAME__ CLI supplies its existing code explicitly
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
