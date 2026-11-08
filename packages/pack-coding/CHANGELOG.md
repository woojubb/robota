# @robota-sdk/pack-coding

## 3.2.2
### Patch Changes

- 8d05c9b: Allow compatible SDK dependencies to update independently.
- Updated dependencies [8d05c9b]
  - @robota-sdk/agent-capability-pack@3.2.2
  - @robota-sdk/agent-command@3.2.2
  - @robota-sdk/agent-framework@3.2.2
  - @robota-sdk/agent-tool-defaults@3.2.2
  - @robota-sdk/agent-tools@3.2.2

## 3.2.1
### Patch Changes

  - @robota-sdk/agent-framework@3.2.1
  - @robota-sdk/agent-capability-pack@3.2.1
  - @robota-sdk/agent-command@3.2.1
  - @robota-sdk/agent-tool-defaults@3.2.1
  - @robota-sdk/agent-tools@3.2.1

## 3.2.0
### Patch Changes

- Updated dependencies [e5ce7d6]
- Updated dependencies [12ab3f5]
- Updated dependencies [ffaf7d5]
- Updated dependencies [9da9c6c]
- Updated dependencies [ad5e9fb]
  - @robota-sdk/agent-framework@3.2.0
  - @robota-sdk/agent-command@3.2.0
  - @robota-sdk/agent-capability-pack@3.2.0
  - @robota-sdk/agent-tool-defaults@3.2.0
  - @robota-sdk/agent-tools@3.2.0

## 3.1.2
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.1.2
  - @robota-sdk/agent-command@3.1.2
  - @robota-sdk/agent-framework@3.1.2
  - @robota-sdk/agent-tool-defaults@3.1.2
  - @robota-sdk/agent-tools@3.1.2

## 3.1.1
### Patch Changes

  - @robota-sdk/agent-framework@3.1.1
  - @robota-sdk/agent-tools@3.1.1
  - @robota-sdk/agent-capability-pack@3.1.1
  - @robota-sdk/agent-command@3.1.1
  - @robota-sdk/agent-tool-defaults@3.1.1

## 3.1.0
### Minor Changes

- a2d36ea: Move what touches a host out of the main entries of `@robota-sdk/agent-command` and `@robota-sdk/agent-preset` into new Node-only `./node` subpaths (`"browser": null`), so neither main entry names a Node module of its own. Both stay Node-only until the packages they import go neutral.

  - `@robota-sdk/agent-command/node` (new) holds `/shell` and `/editor` (`createShellCommandModule`, `createEditorCommandModule` and their sources, entries, `execute*`, `resolveShell`, `resolveEditor` and `spawnInherited`), `createTerminalClientCommands` (an attached terminal runs `/shell` and `/editor` itself), `createNodeDoctorDeps` and `resolveCommandOnPath`, and the new `openFileInEditor`. Import these from `/node`.
  - `createDefaultCommandModules` no longer builds `/shell` and `/editor`, and its `editorTemporaryDirectoryPrefix` option is gone: a Node product adds the two modules beside the default set, as `@robota-sdk/pack-coding` already does. The CLI's command list is unchanged.
  - `/doctor` takes its probes and writers by injection. `createDoctorCommandModule(inputs, deps, display)` has no default for `deps` (pass `createNodeDoctorDeps` from `/node`), `IDoctorDeps` gains `ensureOwnerOnlyDirectory` and `writeSettings` for the confirmed repairs and a required `files: IFileSystem` that the plugin and skill probes read installed extensions through, and `createDefaultCommandModules` takes `doctorDeps`. Absent, `/doctor` is still listed and answers that it is unavailable on this host; nothing is probed or written.
  - `/git` runs through an injected process. `createGitCommandModule({ port })` has no default `createGitProcess()` any more and `createDefaultCommandModules` takes `gitProcess`; absent, `/git` is still listed and answers that it is unavailable on this host, and no process starts. `@robota-sdk/agent-command` no longer re-exports `createGitProcess`, `gitEnvironment`, `ICreateGitProcessOptions`, `IGitProcessPort`, `IGitProcessRunOptions`, `TGitProcessFailureReason` or `TGitProcessOutcome`: import `createGitProcess`, `gitEnvironment` and `ICreateGitProcessOptions` from `@robota-sdk/agent-framework/node`, and the port and outcome types (`IGitProcessPort`, `IGitProcessRunOptions`, `TGitProcessFailureReason`, `TGitProcessOutcome`) from `@robota-sdk/agent-framework`, which owns them. `@robota-sdk/agent-cli` and `@robota-sdk/pack-coding` pass `createGitProcess()`.
  - `/keybindings` opens its file through an injected `TOpenFileInEditor`: `createKeybindingsCommandModule(file, openInEditor)` and the new `keybindingsEditor` option of `createDefaultCommandModules` (pass `openFileInEditor` from `/node`). Absent, `/keybindings` answers that the editor is unavailable here and creates no file.
  - `/provider` and `/model` read a `$ENV:` credential reference from the host's `env` snapshot only. Absent, the reference reads as unset (the setup says so and asks again); the live process environment is no longer consulted by the command itself.
  - `/loop` takes its ids and per-loop offset from `randomId` and `sha256Hex` in `@robota-sdk/agent-core`; both read exactly as before.
  - The `/doctor` check ids (`settings.<scope>.<family>`) read a project-relative path a Windows host joined with `\` as they read one joined with `/`.
  - `@robota-sdk/agent-preset/node` (new) holds `loadExternalPresetsFromDir`. The main entry gains `loadExternalPresetsFromFiles` (`IExternalPresetFile` list of `{ fileName, read }`), which has the same per-file error rules over files a host hands it; only `*.json` names are read. Output-style file ids are read from the file name without `node:path`.
  - `@robota-sdk/agent-cli` passes `createNodeDoctorDeps` and `openFileInEditor`, and reads the preset directory and runs the attached terminal's commands through the `/node` entries, so every command behaves as before. `@robota-sdk/pack-coding` and `@robota-sdk/agent-ui-terminal` (tests) import `/shell` and `/editor` from `@robota-sdk/agent-command/node`; `@robota-sdk/agent-ui-web` only has a test comment updated.

### Patch Changes

- 0a677e9: Remove the built-in `WebSearch` tool, its `IWebSearchProvider` port and the Brave adapter (`webSearchTool`, `createWebSearchTool`, `createBraveSearchProvider`). Web search now comes from model-native provider search and from MCP servers. `createDefaultTools` holds only tools that need no external service or adapter: its `retrievalAdapter` and `computerDriver` options are gone, as is the framework's `retrievalAdapter` session option; a composition root that has such an adapter builds `createRetrievalTool` / `createComputerTool` itself.
- Updated dependencies [51ad6a4]
- Updated dependencies [d46727b]
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
- Updated dependencies [45c11a2]
- Updated dependencies [830d3d2]
- Updated dependencies [0a677e9]
- Updated dependencies [a8c9e25]
- Updated dependencies [fab48ad]
- Updated dependencies [a2d36ea]
- Updated dependencies [ea0e424]
- Updated dependencies [ee7f7ef]
- Updated dependencies [a2d36ea]
- Updated dependencies [7ce5e73]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [0fec62f]
- Updated dependencies [be32d9b]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [42d595e]
- Updated dependencies [0a677e9]
- Updated dependencies [44e9640]
- Updated dependencies [b56b5a9]
- Updated dependencies [4e4c92a]
- Updated dependencies [6ba10ef]
  - @robota-sdk/agent-framework@3.1.0
  - @robota-sdk/agent-tools@3.1.0
  - @robota-sdk/agent-command@3.1.0
  - @robota-sdk/agent-tool-defaults@3.1.0
  - @robota-sdk/agent-capability-pack@3.1.0

## 3.0.7
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.7
  - @robota-sdk/agent-capability-pack@3.0.7
  - @robota-sdk/agent-command@3.0.7
  - @robota-sdk/agent-tool-defaults@3.0.7
  - @robota-sdk/agent-tools@3.0.7

## 3.0.6
### Patch Changes

  - @robota-sdk/agent-framework@3.0.6
  - @robota-sdk/agent-tools@3.0.6
  - @robota-sdk/agent-capability-pack@3.0.6
  - @robota-sdk/agent-command@3.0.6
  - @robota-sdk/agent-tool-defaults@3.0.6

## 3.0.5
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.5
  - @robota-sdk/agent-command@3.0.5
  - @robota-sdk/agent-framework@3.0.5
  - @robota-sdk/agent-tool-defaults@3.0.5
  - @robota-sdk/agent-tools@3.0.5

## 3.0.4
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.4
  - @robota-sdk/agent-command@3.0.4
  - @robota-sdk/agent-framework@3.0.4
  - @robota-sdk/agent-tool-defaults@3.0.4
  - @robota-sdk/agent-tools@3.0.4

## 3.0.3
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.3
  - @robota-sdk/agent-command@3.0.3
  - @robota-sdk/agent-framework@3.0.3
  - @robota-sdk/agent-tool-defaults@3.0.3
  - @robota-sdk/agent-tools@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.2
  - @robota-sdk/agent-command@3.0.2
  - @robota-sdk/agent-framework@3.0.2
  - @robota-sdk/agent-tool-defaults@3.0.2
  - @robota-sdk/agent-tools@3.0.2

## 3.0.1
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.1
  - @robota-sdk/agent-command@3.0.1
  - @robota-sdk/agent-framework@3.0.1
  - @robota-sdk/agent-tool-defaults@3.0.1
  - @robota-sdk/agent-tools@3.0.1

## 3.0.0
### Major Changes

- 0116a29: ARCH-006 completion — the configured product's capability packs now OWN its tool surface, and `pack-coding` is built by a
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
  - **`@robota-sdk/agent-cli`** — `configured CLI`'s packs are built from the shell's resolved `cwd`
    (`createProductCapabilityPacks({ cwd })`) before command setup, and the runtime seam passes
    `PRODUCT_PACKS_OWN_TOOL_SURFACE` (an empty `defaultTools`) so the framework's `createDefaultTools()` tier
    is REPLACED. Every tool the configured CLI runs now arrives from a capability pack: dropping a pack drops its tools,
    exactly as it already dropped its command modules and subagents.
  - **`@robota-sdk/agent-transport` / `@robota-sdk/agent-transport-tui`** — forward the optional
    `additionalTools` and `defaultTools` through the headless and TUI channels, mirroring the existing
    `agentDefinitions` pass-through, so print, serve and TUI carry an identical tool surface.

  End-user `configured CLI` behavior is unchanged, including the security property: the real binary still answers a
  read outside the working directory with `Access denied: "…" is outside the working directory`.

### Minor Changes

- e5a4254: **An editor that offers its file system carries the file tools' reads and writes.**

  `Read`, `Write` and `Edit` take an optional `editorFiles` port (`IEditorFileAccess`), asked at each
  call. On the host, after the tool's containment check (the permission gate has already decided),
  `Read` returns the editor's text, unsaved changes included, and `Write` hands the content to the
  editor; `Edit` reads where `Read` reads and writes where `Write` writes. The editor's text keeps
  `Read`'s byte budget, binary refusal, formatting and cancellation, and an editor failure becomes the
  tool's error result. `Glob` and `Grep` still search the disk and end their result with a note saying
  so while an editor is attached. A sandbox with its own filesystem still carries every file tool, and
  commands never use the editor. `createDefaultTools` and `createCodingPack` pass `editorFiles` through
  to those tools only.

  The ACP agent transport records the editor's `clientCapabilities.fs` and, once `session/new` binds the
  session, hands the host an access through the new `onEditorFileAccess` option that sends
  `fs/read_text_file` and `fs/write_text_file` for that session, for what the editor offered; stopping
  the transport withdraws it. `robota acp` connects the two, so Read, Write and Edit go through the
  editor in an editor that offers `fs`; `terminal/*` is not used.
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
- Updated dependencies [3c81769]
- Updated dependencies [724fabb]
- Updated dependencies [997f2fb]
- Updated dependencies [bfe8ed5]
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
- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [4dd45cc]
- Updated dependencies [e689c8e]
- Updated dependencies [4241fc5]
- Updated dependencies [ec5e477]
- Updated dependencies [e15e22b]
- Updated dependencies [28fa8a7]
- Updated dependencies [44fc732]
- Updated dependencies [4f49d14]
- Updated dependencies [007fd90]
- Updated dependencies [c7f9203]
- Updated dependencies [004fe7f]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [9721162]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [7d77ce4]
- Updated dependencies [57280bf]
- Updated dependencies [18c0d5c]
- Updated dependencies [caaab20]
- Updated dependencies [f01868f]
- Updated dependencies [e8779c9]
- Updated dependencies [0368058]
- Updated dependencies [5a0ee96]
- Updated dependencies [c7f213c]
- Updated dependencies [4e11579]
- Updated dependencies [193a0bc]
- Updated dependencies [54e2848]
- Updated dependencies [3c1967f]
- Updated dependencies [db35dcd]
- Updated dependencies [4cee6fb]
- Updated dependencies [043fd27]
- Updated dependencies [5684612]
- Updated dependencies [6ee8725]
- Updated dependencies [6072e9a]
- Updated dependencies [2e07cad]
- Updated dependencies [e8d70ac]
- Updated dependencies [2c612ba]
- Updated dependencies [e079992]
- Updated dependencies [d994f60]
- Updated dependencies [7116367]
- Updated dependencies [5bb675a]
- Updated dependencies [8fdd44c]
- Updated dependencies [e706b43]
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [e5a4254]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [7d9cc66]
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
- Updated dependencies [7d9cc66]
- Updated dependencies [61db70f]
- Updated dependencies [43df9c0]
- Updated dependencies [db80aba]
- Updated dependencies [1e3f91a]
- Updated dependencies [b330269]
- Updated dependencies [4f3c075]
- Updated dependencies [7d9cc66]
- Updated dependencies [b6d14ce]
- Updated dependencies [bed26ea]
- Updated dependencies [7d9cc66]
- Updated dependencies [fe48835]
- Updated dependencies [7d9cc66]
- Updated dependencies [1e40b5b]
- Updated dependencies [bad976f]
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
- Updated dependencies [dfb9b15]
- Updated dependencies [9c6a8db]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [5134b3b]
- Updated dependencies [dd444c1]
- Updated dependencies [1f57e7f]
- Updated dependencies [7911a7d]
- Updated dependencies [833afe1]
- Updated dependencies [d6b9404]
- Updated dependencies [7863b16]
- Updated dependencies [5783499]
- Updated dependencies [fde558e]
- Updated dependencies [db5c439]
- Updated dependencies [7d9cc66]
- Updated dependencies [62663ae]
- Updated dependencies [4a01a87]
- Updated dependencies [cbee54e]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [9814afc]
- Updated dependencies [02053ec]
- Updated dependencies [242a644]
  - @robota-sdk/agent-framework@3.0.0
  - @robota-sdk/agent-command@3.0.0
  - @robota-sdk/agent-tools@3.0.0
  - @robota-sdk/agent-tool-defaults@3.0.0
  - @robota-sdk/agent-capability-pack@3.0.0

## 3.0.0-beta.106
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.106
  - @robota-sdk/agent-command@3.0.0-beta.106
  - @robota-sdk/agent-framework@3.0.0-beta.106
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.106
  - @robota-sdk/agent-tools@3.0.0-beta.106

## 3.0.0-beta.105
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.105
  - @robota-sdk/agent-command@3.0.0-beta.105
  - @robota-sdk/agent-framework@3.0.0-beta.105
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.105
  - @robota-sdk/agent-tools@3.0.0-beta.105

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.104
  - @robota-sdk/agent-command@3.0.0-beta.104
  - @robota-sdk/agent-framework@3.0.0-beta.104
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.104
  - @robota-sdk/agent-tools@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.103
  - @robota-sdk/agent-command@3.0.0-beta.103
  - @robota-sdk/agent-framework@3.0.0-beta.103
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.103
  - @robota-sdk/agent-tools@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.102
  - @robota-sdk/agent-command@3.0.0-beta.102
  - @robota-sdk/agent-framework@3.0.0-beta.102
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.102
  - @robota-sdk/agent-tools@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

- Updated dependencies [5783499]
- Updated dependencies [62663ae]
  - @robota-sdk/agent-tools@3.0.0-beta.101
  - @robota-sdk/agent-framework@3.0.0-beta.101
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.101
  - @robota-sdk/agent-capability-pack@3.0.0-beta.101
  - @robota-sdk/agent-command@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.100
  - @robota-sdk/agent-command@3.0.0-beta.100
  - @robota-sdk/agent-framework@3.0.0-beta.100
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.100
  - @robota-sdk/agent-tools@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.99
  - @robota-sdk/agent-command@3.0.0-beta.99
  - @robota-sdk/agent-framework@3.0.0-beta.99
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.99
  - @robota-sdk/agent-tools@3.0.0-beta.99

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.98
  - @robota-sdk/agent-command@3.0.0-beta.98
  - @robota-sdk/agent-framework@3.0.0-beta.98
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.98
  - @robota-sdk/agent-tools@3.0.0-beta.98

## 3.0.0-beta.97
### Minor Changes

- e5a4254: **An editor that offers its file system carries the file tools' reads and writes.**

  `Read`, `Write` and `Edit` take an optional `editorFiles` port (`IEditorFileAccess`), asked at each
  call. On the host, after the tool's containment check (the permission gate has already decided),
  `Read` returns the editor's text, unsaved changes included, and `Write` hands the content to the
  editor; `Edit` reads where `Read` reads and writes where `Write` writes. The editor's text keeps
  `Read`'s byte budget, binary refusal, formatting and cancellation, and an editor failure becomes the
  tool's error result. `Glob` and `Grep` still search the disk and end their result with a note saying
  so while an editor is attached. A sandbox with its own filesystem still carries every file tool, and
  commands never use the editor. `createDefaultTools` and `createCodingPack` pass `editorFiles` through
  to those tools only.

  The ACP agent transport records the editor's `clientCapabilities.fs` and, once `session/new` binds the
  session, hands the host an access through the new `onEditorFileAccess` option that sends
  `fs/read_text_file` and `fs/write_text_file` for that session, for what the editor offered; stopping
  the transport withdraws it. `robota acp` connects the two, so Read, Write and Edit go through the
  editor in an editor that offers `fs`; `terminal/*` is not used.

### Patch Changes

- Updated dependencies [e5a4254]
- Updated dependencies [43df9c0]
- Updated dependencies
- Updated dependencies [7911a7d]
  - @robota-sdk/agent-tools@3.0.0-beta.97
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.97
  - @robota-sdk/agent-command@3.0.0-beta.97
  - @robota-sdk/agent-framework@3.0.0-beta.97
  - @robota-sdk/agent-capability-pack@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-capability-pack@3.0.0-beta.96
  - @robota-sdk/agent-command@3.0.0-beta.96
  - @robota-sdk/agent-framework@3.0.0-beta.96
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.96
  - @robota-sdk/agent-tools@3.0.0-beta.96

## 3.0.0-beta.95
### Patch Changes

- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-framework@3.0.0-beta.95
  - @robota-sdk/agent-command@3.0.0-beta.95
  - @robota-sdk/agent-capability-pack@3.0.0-beta.95
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.95
  - @robota-sdk/agent-tools@3.0.0-beta.95

## 3.0.0-beta.94
### Patch Changes

- Updated dependencies [e079992]
- Updated dependencies [8fdd44c]
- Updated dependencies [e706b43]
  - @robota-sdk/agent-framework@3.0.0-beta.94
  - @robota-sdk/agent-tools@3.0.0-beta.94
  - @robota-sdk/agent-capability-pack@3.0.0-beta.94
  - @robota-sdk/agent-command@3.0.0-beta.94
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.94

## 3.0.0-beta.93
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-command@3.0.0-beta.93
  - @robota-sdk/agent-framework@3.0.0-beta.93
  - @robota-sdk/agent-capability-pack@3.0.0-beta.93
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.93
  - @robota-sdk/agent-tools@3.0.0-beta.93

## 3.0.0-beta.92
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-command@3.0.0-beta.92
  - @robota-sdk/agent-framework@3.0.0-beta.92
  - @robota-sdk/agent-capability-pack@3.0.0-beta.92
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.92
  - @robota-sdk/agent-tools@3.0.0-beta.92

## 3.0.0-beta.91
### Patch Changes

- Updated dependencies [bad976f]
  - @robota-sdk/agent-framework@3.0.0-beta.91
  - @robota-sdk/agent-tools@3.0.0-beta.91
  - @robota-sdk/agent-capability-pack@3.0.0-beta.91
  - @robota-sdk/agent-command@3.0.0-beta.91
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.91

## 3.0.0-beta.90
### Patch Changes

- Updated dependencies [7116367]
- Updated dependencies [5bb675a]
  - @robota-sdk/agent-framework@3.0.0-beta.90
  - @robota-sdk/agent-command@3.0.0-beta.90
  - @robota-sdk/agent-tools@3.0.0-beta.90
  - @robota-sdk/agent-capability-pack@3.0.0-beta.90
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.90

## 3.0.0-beta.89
### Patch Changes

  - @robota-sdk/agent-framework@3.0.0-beta.89
  - @robota-sdk/agent-capability-pack@3.0.0-beta.89
  - @robota-sdk/agent-command@3.0.0-beta.89
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.89
  - @robota-sdk/agent-tools@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- Updated dependencies [d994f60]
  - @robota-sdk/agent-tools@3.0.0-beta.88
  - @robota-sdk/agent-framework@3.0.0-beta.88
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.88
  - @robota-sdk/agent-capability-pack@3.0.0-beta.88
  - @robota-sdk/agent-command@3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- Updated dependencies
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
  - @robota-sdk/agent-command@3.0.0-beta.87
  - @robota-sdk/agent-framework@3.0.0-beta.87
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.87
  - @robota-sdk/agent-tools@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-capability-pack@3.0.0-beta.86
- @robota-sdk/agent-command@3.0.0-beta.86
- @robota-sdk/agent-framework@3.0.0-beta.86
- @robota-sdk/agent-tool-defaults@3.0.0-beta.86
- @robota-sdk/agent-tools@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [4e11579]
- Updated dependencies [193a0bc]
- Updated dependencies [54e2848]
- Updated dependencies [3c1967f]
- Updated dependencies [db35dcd]
- Updated dependencies [4cee6fb]
- Updated dependencies [043fd27]
- Updated dependencies [5684612]
- Updated dependencies [6ee8725]
- Updated dependencies [6072e9a]
- Updated dependencies [2e07cad]
  - @robota-sdk/agent-framework@3.0.0-beta.85
  - @robota-sdk/agent-command@3.0.0-beta.85
  - @robota-sdk/agent-capability-pack@3.0.0-beta.85
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.85
  - @robota-sdk/agent-tools@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- Updated dependencies [c7f213c]
- Updated dependencies [e8d70ac]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.84
  - @robota-sdk/agent-framework@3.0.0-beta.84
  - @robota-sdk/agent-command@3.0.0-beta.84
  - @robota-sdk/agent-tools@3.0.0-beta.84
  - @robota-sdk/agent-capability-pack@3.0.0-beta.84

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
- Updated dependencies [28fa8a7]
- Updated dependencies [4f49d14]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [9721162]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [7d77ce4]
- Updated dependencies [57280bf]
- Updated dependencies [18c0d5c]
- Updated dependencies [caaab20]
- Updated dependencies [f01868f]
- Updated dependencies [e8779c9]
- Updated dependencies [0368058]
- Updated dependencies [5a0ee96]
  - @robota-sdk/agent-framework@3.0.0-beta.83
  - @robota-sdk/agent-command@3.0.0-beta.83
  - @robota-sdk/agent-capability-pack@3.0.0-beta.83
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.83
  - @robota-sdk/agent-tools@3.0.0-beta.83

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

- 0116a29: ARCH-006 completion — __PRODUCT_DISPLAY_NAME__'s capability packs now OWN its tool surface, and `pack-coding` is built by a
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
  - **`@robota-sdk/agent-cli`** — `__PRODUCT_CLI_NAME__`'s packs are built from the shell's resolved `cwd`
    (`createProductCapabilityPacks({ cwd })`) before command setup, and the runtime seam passes
    `PRODUCT_PACKS_OWN_TOOL_SURFACE` (an empty `defaultTools`) so the framework's `createDefaultTools()` tier
    is REPLACED. Every tool __PRODUCT_DISPLAY_NAME__ runs now arrives from a capability pack: dropping a pack drops its tools,
    exactly as it already dropped its command modules and subagents.
  - **`@robota-sdk/agent-transport` / `@robota-sdk/agent-transport-tui`** — forward the optional
    `additionalTools` and `defaultTools` through the headless and TUI channels, mirroring the existing
    `agentDefinitions` pass-through, so print, serve and TUI carry an identical tool surface.

  End-user `__PRODUCT_CLI_NAME__` behavior is unchanged, including the security property: the real binary still answers a
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
  - **`@robota-sdk/pack-coding`** (new) — __PRODUCT_DISPLAY_NAME__'s coding capability as one `ICapabilityPack` (the built-in
    coding tools, the `/shell` + `/editor` command modules, and the coding subagents) — the additive-axis
    proof and __PRODUCT_DISPLAY_NAME__'s first pack.
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
