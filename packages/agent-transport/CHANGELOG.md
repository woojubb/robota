# @robota-sdk/agent-transport

## 3.0.0-beta.82

### Minor Changes

- c7f9203: Connected sessions can send each other files.

  - `/peers send-file <session-id> <path>` sends a copy of any file the operator can read to another
    live session on this host.
  - The model sends a file only through the `peer_send_file` tool. Every call asks the user, showing
    the path, size, hash and destination; no permission mode, rule or remembered consent answers it.
    The tool reaches only files inside the workspace whose path does not look like it holds secrets
    (`.env*`, `~/.ssh`, keys and credentials), and it does not exist in a turn a peer's message started.
  - The receiving operator approves every file. A received file is kept as an inert copy (mode 0600)
    under `~/.robota/peer-files/<sender>/`. It is never run and never placed in the model's context.
    The conversation is told only its name, size and sha256. A name that leaves that directory is
    refused, a symbolic link is never written through, and nothing is overwritten.
  - Transfers travel on a channel of their own (a separate connection on this host, a separate data
    channel between devices), in chunks the receiver paces, up to 32 MiB, and are kept only when the
    whole content matches the offered sha256. A transfer that ends early is discarded; there is no
    resume.

  **API**

  - `agent-interface-session-mobility`: the `file` capability, which asks the operator for every
    request; `ConnectionAuthority.authorizeFile`; `IFileOffer` and `IFileFrameChannel`.
  - `agent-transport/node`: `sendFileOverChannel` and `receiveFileOverChannel`, the carrier over any
    `IFileFrameChannel`; `DEFAULT_MAX_FILE_BYTES`.
  - `agent-transport-webrtc`: `IDeviceMeshLink.openFileChannel` and `onFileChannel`.
  - `agent-remote-pairing`: `file` joins `DEVICE_CAPABILITIES`. A device certificate that names it is
    refused as malformed by an earlier version.
  - `agent-core`: `IToolPermissionProfile.notInPeerTurn` withholds a tool from a turn a peer's message
    started.
  - `agent-framework`: `ICommandLocalPeersAdapter.prepareFile`.

### Patch Changes

- Updated dependencies [c7f9203]
- Updated dependencies [004fe7f]
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.82
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-interface-command@3.0.0-beta.82
  - @robota-sdk/agent-interface-execution@3.0.0-beta.82
  - @robota-sdk/agent-interface-session@3.0.0-beta.82
  - @robota-sdk/agent-interface-transport@3.0.0-beta.82
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
- Updated dependencies [b2e0afe]
- Updated dependencies [007fd90]
- Updated dependencies [18b52cc]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-interface-session@3.0.0-beta.81
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.81
  - @robota-sdk/agent-interface-command@3.0.0-beta.81
  - @robota-sdk/agent-interface-execution@3.0.0-beta.81
  - @robota-sdk/agent-interface-transport@3.0.0-beta.81
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.81

## 3.0.0-beta.80

### Major Changes

- 50d2c9f: Handoff offer refusal and inventory classification now live in session mobility. The Node transport
  entry no longer exports `buildHandoffManifest`, `IBuildManifestInput`, `ISourceRuntimeState`, or
  `TManifestResult`. Compose `assessHandoffReadiness` and `prepareHandoffOffer` from
  `@robota-sdk/agent-interface-session-mobility` with `sealHandoffRecord` from
  `@robota-sdk/agent-transport/node`; check readiness before sealing and send the returned serialized
  payload unchanged. The transport README contains the migration example.
- e82215f: **ARCH-011: replace the ambiguous transport lifecycle stub with executable conformance.**

  `ITransportAdapter` now requires a frozen `service | runner` lifecycle descriptor. `start()` resolves
  at the concrete transport's documented readiness boundary; start before attach and repeated active
  start reject a stable lifecycle error, repeated stop is safe, and stopped adapters can reattach and
  restart.

  Runner adapters launch separately and expose a typed terminal outcome through
  `waitForCompletion()`. The registry accepts base adapters, rejects duplicate names, keeps
  configuration as an optional capability, returns complete ordered records whose pending slots become
  registry-owned `abandoned` outcomes on stop/rollback, and exposes a real-runner-only first-failure
  wait. It serializes startup/stop, rejects active restart before mutation, and reverses partial startup
  from the currently failing adapter with typed safe rollback details. Runtime host and serve mode
  propagate real nonzero runner results without treating normal shutdown abandonment as failure.

  HTTP, MCP, both WebSocket adapters, WebRTC, and headless invoke one shared public conformance kit.
  The former `TuiTransport` export is removed because it ignored the attached session; use `renderApp`
  or `TuiInteractionChannel`, which honestly own their session lifecycle.

- 64ba748: **BREAKING — ARCH-042: project filesystem access is now an explicit, host-issued authority instead of an ambient consequence of `cwd`.**

  `@robota-sdk/agent-framework` adds `WorkspaceTrustService` and the opaque
  `IWorkspaceProjectAuthority`, plus bounded reader, settings-writer, state-storage, and mutation
  facets. Public session, settings, context, checkpoint, memory, contribution, query, and replay
  contracts consume those facets. A caller that does not supply `projectAccess` is deliberately
  restricted to user-owned host state and receives no project filesystem capability.

  The framework removes or renames ambient Node/project exports. Migrate `checkSettingsFile` to
  `checkNodeHostSettingsFile`, `readMergedProviderSettingsFromPaths` to
  `readMergedProviderSettingsFromSources`, `resolveProviderSettingsWriteTargetPath` to
  `resolveProviderSettingsWriteTarget`, `FileSystemMemoryStore` / `createFileSystemMemoryStore` to
  `WorkspaceMemoryStore` / `createWorkspaceMemoryStore`, and `PluginSettingsStore` to
  `NodeHostPluginSettingsStore`. Host-only git helpers now carry the `FromNodeHost` suffix.
  `projectPaths`, `resolveSettingsPathForScope`, and `getProviderSettingsPaths` are removed; project
  consumers must use the authority facets rather than recover absolute paths.

  `@robota-sdk/agent-session` renames the Node filesystem implementation `SessionStore` to
  `NodeSessionStore` and adds explicit session-log/external-payload source and sink ports. Session
  replay no longer resolves external payload files from an ambient directory.

  `@robota-sdk/agent-interface-transport` changes `ISkillExecutionPort.loadCommands(cwd, home?)` to
  the authority-bound `loadCommands()` and removes the optional absolute-path leak
  `IInteractiveSessionStore.getFilePath`. `@robota-sdk/agent-command` consequently replaces the
  `cwd` option of `createSkillsCommandModule` with required `contributionSources`; default command
  composition accepts explicit contribution sources and discovers no project skills when none are
  provided.

  `@robota-sdk/agent-cli`, `@robota-sdk/agent-transport`, and
  `@robota-sdk/agent-transport-tui` thread the trusted-or-restricted project decision through every
  session surface. Embedded callers that need project settings, state, context, skills, checkpoints,
  or mutation must mint access through `WorkspaceTrustService` and pass the returned
  `projectAccess` (and a separately approved mutation/settings facet where required). Omitting it is
  still type-compatible but is behaviorally breaking: the surface now fails closed instead of
  reading or writing the current directory.

### Minor Changes

- a5961c9: Access-token verification for a remote resource server.

  `agent-interface-transport` gains the contract: `IAccessTokenVerifier`, its configuration
  `IAccessTokenVerifierConfig`, and the verdict `TAccessTokenAdmission` — admitted, or refused with one
  `TAccessTokenRefusal` reason. A verdict never carries the token or a claim value.

  `agent-transport/node` gains `createAccessTokenVerifier`, built on `jose` (now a direct, pinned
  dependency). A token is admitted only when it is an `at+jwt` access token within a length bound,
  issued by exactly the configured issuer, signed with a configured RS256, ES256 or EdDSA key whose
  type, curve, `alg` and `use` agree with it, within `exp`/`nbf` with 60 s of skew, addressed to the
  configured resource, carrying the required scopes, and from an allowlisted subject or client. The
  host is single-tenant, so a configuration without an allowlist is refused at construction.

  Keys are discovered through the issuer's metadata (RFC 8414, then OpenID discovery, with an issuer
  equality check) and fetched over `https` through agent-core's egress boundary, byte-bounded, with
  private-address reach granted to the issuer's host only. The key set is cached and refetched, at a
  bounded rate, for an unknown `kid` or once it reaches a maximum age, so a key the issuer withdraws
  stops admitting; keys are trusted only up to a bounded age, and beyond that an outage refuses.

  Nothing is wired to a listener yet.

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

- 9db63ee: Add named session capability roles and explicit capability-host queries while preserving the legacy
  `IInteractiveSession` interface shape. HTTP, MCP, protocol, WS, WebRTC, and headless transports now
  declare only the session roles they consume, and the direct aggregate-cast floor is zero.
- 1e3f91a: CMD-004 Phase 2 Stage E (breaking, beta line): the legacy `TCommandEffect` union and
  `ICommandResult.effects` are DELETED. Commands emit the split contract directly —
  `hostActions` (session-executed via `ICommandHostAdapters`; works headless and remote) and
  `uiIntents` (requester-routed `ui_intent` session events with UI-neutral `show-*` names).
  Final carriers for the former notification effects: `session_renamed` and the new
  `history_cleared` are BROADCAST session events (forwarded to every WS surface, folded by the
  TUI transcript/title and the GUI reducer's new `sessionName`/transcript-reset state);
  `session-execution-started` rides `result.data.sessionExecution`; the plugin-registry refresh
  rides `result.data.pluginRegistryReloaded`. A mechanical grep floor
  (`command-effect-grep-floor.test.ts`) keeps `tui-requested`/`TCommandEffect`/`effects:` out of
  every `packages/*/src` production tree.

### Patch Changes

- 2ebff01: Emit the complete persisted checkpoint and branch lifecycle, forward plan, context-refresh, and
  branch events through protocol transports, and render deterministic bounded notices in the TUI.
  Transport-owned delivery failures now enter the owning carrier cleanup lifecycle without reversing
  an already-committed session operation.
- 3244fb8: Fix a headless-run race (CI-001): the headless runner now resolves its exit code only AFTER the underlying `session.submit()` operation has fully settled, not off the terminal `complete`/`interrupted`/`error` event alone. Those events fire from inside the turn, BEFORE the turn's awaited `finally` runs session persistence / checkpoint finalize, so `run()`/`start()` previously returned while the session was still writing `.robota/` under cwd — a race a caller (or a test's cleanup) could lose (`ENOTEMPTY`). Each run now also emits exactly one terminal record. No change to exit codes or output shape.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [37b4bd7]
- Updated dependencies [4eea54b]
- Updated dependencies [50d2c9f]
- Updated dependencies [1698be4]
- Updated dependencies [a5961c9]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [af2f2ad]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [4dd45cc]
- Updated dependencies [fec722f]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [9db63ee]
- Updated dependencies [b078afa]
- Updated dependencies [2ebff01]
- Updated dependencies [9db63ee]
- Updated dependencies [2ebff01]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
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
- Updated dependencies [1e40b5b]
- Updated dependencies [7669851]
- Updated dependencies [4b76cfa]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [d6b9404]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-interface-execution@3.0.0-beta.80
  - @robota-sdk/agent-interface-command@3.0.0-beta.80
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-interface-session@3.0.0-beta.80
  - @robota-sdk/agent-interface-transport@3.0.0-beta.80
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.80
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79
- @robota-sdk/agent-framework@3.0.0-beta.79
- @robota-sdk/agent-interface-transport@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78
  - @robota-sdk/agent-framework@3.0.0-beta.78
  - @robota-sdk/agent-interface-transport@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-framework@3.0.0-beta.77
  - @robota-sdk/agent-interface-transport@3.0.0-beta.77

## 3.0.0-beta.76

### Minor Changes

- 9df3a88: Split the consolidated `@robota-sdk/agent-transport` package into per-concern transport packages (DQ-AUDIT-005) so unrelated heavy dependencies (React/Ink, ws, Hono, MCP SDK) no longer share one publishable unit and are not dragged into non-TUI consumers' graphs:

  - `@robota-sdk/agent-transport` — lean core: headless adapter + `TransportRegistry` + scripted-provider testing fixtures (no external runtime deps).
  - `@robota-sdk/agent-transport-tui` — React + Ink terminal UI.
  - `@robota-sdk/agent-transport-ws` — WebSocket transport + protocol (`agent-web-ui` now depends only on this for WS types).
  - `@robota-sdk/agent-transport-http` — Hono HTTP transport.
  - `@robota-sdk/agent-transport-mcp` — MCP server transport.

  The default transport-registry wiring (pre-registering `WsTransport`) moves to the CLI composition root, removing the core→ws edge.

### Patch Changes

- DQ-AUDIT-002 — consolidate duplicated domain data onto single owners: one model-pricing SSOT in agent-core (`MODEL_PRICES`/`lookupModelPrice`/`calculateModelCost`/`estimateBlendedCostPer1000`) consumed by agent-command and agent-plugin (drops two embedded/stale price tables); the `len/4` token estimator replaced by core `CONTEXT_ESTIMATE_CHARS_PER_TOKEN`; TUI `TContextState` derived from core `IContextWindowState`; dead pass-through re-exports removed from agent-session.
- c0a6287: Relocate session feature logic out of the CLI shell and the transport (DQ-AUDIT-004):

  - Extract session-log timing analysis into the new `@robota-sdk/agent-session-analytics` package (pure analysis over canonical session records — no duplicate types, no file I/O). `agent-cli`'s `session analyze` command shrinks to thin wiring and loads records via the new `createUserSessionStore()` / existing `createProjectSessionStore()` framework facades.
  - Move LLM-based session auto-naming (`generateSessionName`) from `agent-transport/tui` into `agent-framework` (session-lifecycle owner); the TUI transport now invokes it through the framework.

- Updated dependencies
- Updated dependencies [c0a6287]
- Updated dependencies [9df3a88]
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-framework@3.0.0-beta.76
  - @robota-sdk/agent-interface-transport@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Agent preset system + live preset switching + context/history correctness fixes.

  - **Preset system (PRESET-001~017):** new `@robota-sdk/agent-preset` package layering framework
    assembly options into named, selectable profiles (`default`, `autonomous-builder`, `careful-reviewer`,
    `neutral-executor`) plus user-authored external presets loaded from `~/.robota/presets/*.json`.
  - **Live preset switching:** `/preset` command (list + active marker + switch) and a TUI active-preset
    display. Switching live re-applies permission posture, model/effort, persona, command-module
    selection, parallel-subagents gating, and a self-verification system-prompt section via the single
    `applyPresetToSession` engine.
  - **CTX-001:** the TUI Context display + session auto-compact now use the accurate provider-based token
    estimate (system prompt + tool schemas included) instead of a crude history-only char heuristic.
  - **HIST-001:** conversation history is now append-only — removed the silent 100-message count cap that
    could drop early context; context size is managed solely by size-based compaction.

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.75
  - @robota-sdk/agent-core@3.0.0-beta.75
  - @robota-sdk/agent-interface-transport@3.0.0-beta.75
  - @robota-sdk/agent-interface-tui@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.74
  - @robota-sdk/agent-core@3.0.0-beta.74
  - @robota-sdk/agent-interface-transport@3.0.0-beta.74
  - @robota-sdk/agent-interface-tui@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- d4fd33f: TUI input area UX: remove side borders and status bar box (SCREEN-001), move status bar below input area (SCREEN-002), fix top border corner characters.
  - @robota-sdk/agent-core@3.0.0-beta.73
  - @robota-sdk/agent-framework@3.0.0-beta.73
  - @robota-sdk/agent-interface-transport@3.0.0-beta.73
  - @robota-sdk/agent-interface-tui@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- Revert Korean IME blank line to normal flow so it persists after session switch (AppInner remount).
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.72
  - @robota-sdk/agent-core@3.0.0-beta.72
  - @robota-sdk/agent-interface-transport@3.0.0-beta.72
  - @robota-sdk/agent-interface-tui@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71
  - @robota-sdk/agent-framework@3.0.0-beta.71
  - @robota-sdk/agent-interface-transport@3.0.0-beta.71
  - @robota-sdk/agent-interface-tui@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- CLI UX fixes: /context list full LLM context breakdown (CLI-B10), logo resize fix (CLI-B03), token estimates in context list (CLI-B04)
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.70
  - @robota-sdk/agent-core@3.0.0-beta.70
  - @robota-sdk/agent-interface-transport@3.0.0-beta.70
  - @robota-sdk/agent-interface-tui@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.69
  - @robota-sdk/agent-core@3.0.0-beta.69
  - @robota-sdk/agent-interface-transport@3.0.0-beta.69
  - @robota-sdk/agent-interface-tui@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- Wrap Korean IME spacer in Box position=absolute to reduce terminal cursor offset by 1 row, moving the IME candidate window closer to the input area.
  - @robota-sdk/agent-core@3.0.0-beta.68
  - @robota-sdk/agent-framework@3.0.0-beta.68
  - @robota-sdk/agent-interface-transport@3.0.0-beta.68
  - @robota-sdk/agent-interface-tui@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.67
  - @robota-sdk/agent-interface-tui@3.0.0-beta.67
  - @robota-sdk/agent-core@3.0.0-beta.67
  - @robota-sdk/agent-interface-transport@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- refactor: CLI-001/002 — agent-cli layer separation and monorepo-wide readability lint rules
  - CLI-001: Extract startup phases into focused modules; enforce agent-cli layer separation
  - CLI-002: Apply import/order, consistent-type-imports, explicit-function-return-type, prefer-const, object-shorthand across all packages
  - Fix stale child-process-subagent-worker entry in agent-cli tsdown.config.ts (build fix)

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.66
  - @robota-sdk/agent-core@3.0.0-beta.66
  - @robota-sdk/agent-interface-transport@3.0.0-beta.66

## 3.0.0-beta.65

### Minor Changes

- feat(CMD-003): TUI command interaction — picker/confirm overlay on missing args
  - Add `command-interaction.ts` with `ITuiPickerInteraction`, `ITuiConfirmInteraction`, `TAnyTuiCommandInteraction` types
  - Add `CommandPicker` and `CommandConfirm` Ink overlay components
  - Extend `TCommandSelectionResult` with `open-interaction` variant in input-area-flow
  - `resolveEnterCommandSelection` opens interaction overlay when command has `onMissingArgs` and no args typed
  - `InputArea` accepts `resolveInteraction` prop; renders picker/confirm overlay when active
  - Add `resolveInteraction` to `IRenderOptions` / `App` / `render`
  - Add `TUI_COMMAND_INTERACTIONS` registry in `agent-cli` with mode/language/provider/exit/clear interactions
  - Fix `SlashAutocomplete` to show technical command name (`cmd.name`) instead of `displayName`

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65
- @robota-sdk/agent-framework@3.0.0-beta.65
- @robota-sdk/agent-interface-transport@3.0.0-beta.65

## 3.0.0-beta.64

### Minor Changes

- feat: add displayName and requiresPermission to command interfaces
  - `ICommand`, `ISystemCommand`, `ICommandListEntry`: add optional `displayName` field for user-friendly labels
  - `ISystemCommand`: add optional `requiresPermission` field for per-command permission policy declaration
  - `SystemCommandExecutor`: add `resolveRequiresPermission()` — derives from `safety` when field is undefined
  - All 24 built-in commands declare explicit `displayName` and `requiresPermission`
  - TUI autocomplete renders `displayName ?? name`; Tab completion still inserts the technical command ID
  - `/help` output shows `Display Name (/command-id)` format

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.64
  - @robota-sdk/agent-core@3.0.0-beta.64
  - @robota-sdk/agent-interface-transport@3.0.0-beta.64
