# @robota-sdk/pack-coding

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [e15e22b]
- Updated dependencies [c7f9203]
- Updated dependencies [004fe7f]
  - @robota-sdk/agent-command@3.0.0-beta.82
  - @robota-sdk/agent-framework@3.0.0-beta.82
  - @robota-sdk/agent-capability-pack@3.0.0-beta.82
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.82
  - @robota-sdk/agent-tools@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
- Updated dependencies [44fc732]
- Updated dependencies [007fd90]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
  - @robota-sdk/agent-tools@3.0.0-beta.81
  - @robota-sdk/agent-framework@3.0.0-beta.81
  - @robota-sdk/agent-command@3.0.0-beta.81
  - @robota-sdk/agent-capability-pack@3.0.0-beta.81
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.81

## 3.0.0-beta.80

### Major Changes

- 0116a29: ARCH-006 completion — robota's capability packs now OWN its tool surface, and `pack-coding` is built by a
  context-bound factory.

  - **`@robota-sdk/pack-coding` (BREAKING)** — the module-level `codingPack` constant is **removed** and
    replaced by `createCodingPack({ cwd, sandboxClient })`, with `cwd` **required**. This is a safety change,
    not a style one: `agent-tools` disarms its working-directory path guard when `cwd` is `undefined`, so a
    pack whose file tools are built with no options contributes an **unsandboxed** `Read`/`Write`/`Edit`.
    That was inert while `agent-framework` always supplied its own context-bound default tier, but ARCH-006
    lets a product hand the whole tool surface to its packs (`defaultTools: []`) — and a context-free pack in
    that position is a real hole. Keeping a zero-option export beside that seam would be a loaded gun, so it
    is gone rather than deprecated. Each call returns fresh instances bound to the supplied context, so two
    products in one process get independently-scoped file tools. Migration: replace `codingPack` with
    `createCodingPack({ cwd: process.cwd() })`.
  - **`@robota-sdk/agent-cli`** — `robota`'s packs are built from the shell's resolved `cwd`
    (`createRobotaPacks({ cwd })`) before command setup, and the runtime seam passes
    `ROBOTA_PACKS_OWN_TOOL_SURFACE` (an empty `defaultTools`) so the framework's `createDefaultTools()` tier
    is REPLACED. Every tool robota runs now arrives from a capability pack: dropping a pack drops its tools,
    exactly as it already dropped its command modules and subagents.
  - **`@robota-sdk/agent-transport` / `@robota-sdk/agent-transport-tui`** — forward the optional
    `additionalTools` and `defaultTools` through the headless and TUI channels, mirroring the existing
    `agentDefinitions` pass-through, so print, serve and TUI carry an identical tool surface.

  End-user `robota` behavior is unchanged, including the security property: the real binary still answers a
  read outside the working directory with `Access denied: "…" is outside the working directory`.

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

### Patch Changes

- 7b85767: ARCH-035 — the default tool set becomes a composition leaf.

  **New package: `@robota-sdk/agent-tool-defaults`.** It owns `createDefaultTools` and
  `ICreateDefaultToolsOptions`, including the adapter gating that adds `CodebaseRetrieval` when a
  `retrievalAdapter` is supplied and the Computer tools when a `computerDriver` is.

  **Breaking for `@robota-sdk/agent-framework`:** `createDefaultTools` and `ICreateDefaultToolsOptions`
  are no longer exported from it. Import them from `@robota-sdk/agent-tool-defaults`. The packages are
  pre-release and this repo keeps no compatibility shims, so they are moved rather than deprecated.

  **Also breaking:** the internal `createSession` assembly factory is now `async`. This does NOT affect
  `IAgentRuntime.createSession`, which stays synchronous — it does not call that factory, and a
  verification scenario now asserts that explicitly, because propagating async through it would break
  every consumer that builds a session without supplying `defaultTools`.

  **Zero-config behaviour is unchanged**, deliberately. `createQuery` and the headless runtime have no
  `defaultTools` seam, so a session built without one still receives the built-in tool tier —
  `agent-framework` reaches the new leaf through a dynamic `import()`. An earlier revision of this work
  proposed deleting the tier outright and was rejected on measurement: two published surfaces cannot
  express the alternative, and the failure mode was a silently toolless agent behind a green typecheck.

  **Why the move matters.** `agent-subagent-runner` legitimately depends on `agent-framework`, so while
  the aggregator sat on that barrel a neutral runner could compose the product's tool surface with only
  a scan in the way. It has no manifest edge to the new leaf, so that import does not resolve there at
  all — the guarantee is carried by the type system now, mirroring what `@robota-sdk/agent-provider-defaults`
  already does on the provider axis.

  `@robota-sdk/pack-coding` is a patch: it consumes the leaf instead of rebuilding the same list by
  hand. Its contributed tool surface is unchanged — verified from the published tarballs.

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- Updated dependencies [9c19c50]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [08a9bd6]
- Updated dependencies [818f0c8]
- Updated dependencies [2345c0b]
- Updated dependencies [118fe0e]
- Updated dependencies [240777e]
- Updated dependencies [718bdf5]
- Updated dependencies [9368d00]
- Updated dependencies [d4189b9]
- Updated dependencies [4078a72]
- Updated dependencies [af2f2ad]
- Updated dependencies [267af5f]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [a5cc36e]
- Updated dependencies [b70fa3d]
- Updated dependencies [2711ec6]
- Updated dependencies [4dd45cc]
- Updated dependencies [378c585]
- Updated dependencies [4c5148e]
- Updated dependencies [37af5dc]
- Updated dependencies [807d161]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [2ebff01]
- Updated dependencies [2ebff01]
- Updated dependencies [2d3b2c0]
- Updated dependencies [b078afa]
- Updated dependencies [2d3b2c0]
- Updated dependencies [baa6863]
- Updated dependencies [2d3b2c0]
- Updated dependencies [3a8876b]
- Updated dependencies [4772067]
- Updated dependencies [7b85767]
- Updated dependencies [0f98419]
- Updated dependencies [64ba748]
- Updated dependencies [d312755]
- Updated dependencies [61db70f]
- Updated dependencies [db80aba]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [b6d14ce]
- Updated dependencies [bed26ea]
- Updated dependencies [fe48835]
- Updated dependencies [1e40b5b]
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
- Updated dependencies [9814afc]
- Updated dependencies [242a644]
  - @robota-sdk/agent-framework@3.0.0-beta.80
  - @robota-sdk/agent-command@3.0.0-beta.80
  - @robota-sdk/agent-tools@3.0.0-beta.80
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.80
  - @robota-sdk/agent-capability-pack@3.0.0-beta.80
