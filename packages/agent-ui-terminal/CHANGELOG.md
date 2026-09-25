# @robota-sdk/agent-ui-terminal

## 3.0.0-beta.80

### Major Changes

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

- 2ebff01: Stop presenting `TuiInteractionChannel` as an `IInteractionChannel`: the TUI owns its session and
  subscribes to the full session-event surface, so its unused no-op `write()` method is removed.
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

- f3fe3db: The terminal renderer no longer reads `ROBOTA_SCREEN_READER_STARTUP_QUIET_MS` or
  `ROBOTA_SCREEN_READER_PREPARK_MS` from the process environment. SDK hosts calling `renderApp`
  directly should pass raw timing choices and diagnostic labels through the new optional
  `screenReaderPacing` render option. Without it, the renderer uses its existing 900 ms startup
  quiet period and 50 ms pre-write park when screen-reader mode is enabled. The Robota CLI still
  reads the same environment variables and preserves their validation, bounds, and warnings.
- 724d5b6: The terminal renderer no longer reads `ROBOTA_IME_CURSOR` or `ROBOTA_TURN_MARKS` from the process environment. SDK hosts calling `renderApp` directly should pass cursor and turn-mark choices through the optional `terminalCapabilities` render option. Without a host choice, the renderer keeps its terminal and TTY defaults. The Robota CLI still reads both environment variables and preserves its exact `1` and `0` overrides.

### Minor Changes

- 9c19c50: `/fork [name] [--same-dir]` copies the live conversation into a background session.

  The session writes a copy of its own record under a fresh id — messages, system prompt, tool schemas
  and full history, and deliberately not the sandbox snapshot, goal, plan or branch — then spawns a
  background job carrying only `resumeSessionId`. The child restores that record itself, so no
  conversation crosses the child-process boundary and the worker start payload's key set is unchanged.
  The background panel gains an `attach` control that switches the terminal onto the forked session; it
  is a view switch, never a merge, and a missing record or a terminal task is refused with the task's
  own status.

  **`@robota-sdk/agent-framework` is `major` for one reason: `ICommandHostSessionAccess` gains a
  required member.** `forkSession({ name? })` is not optional, so an external implementation of that
  role port stops compiling until it adds the method. Every other change in this set is additive:

  - `agent-interface-execution` — `TExecutionControl` gains `'attach'`.
  - `agent-interface-command` — `TCommandUiIntent` gains `{ type: 'switch-session'; sessionId }`.
  - `agent-subagent-runner` — `ISubagentWorkerComposition` gains the optional `openSessionStore`, and
    the worker resumes a record when the job names one. A composition that registers no store and
    receives no `resumeSessionId` behaves exactly as before.
  - `agent-framework` also gains the fork-record builder, `SessionTurnMemory`, and
    `IAgentBackgroundTaskRequest.resumeSessionId?`; `loadSessionRecord` now returns
    `restoredSystemPrompt`, which makes a record field that was written and never read take effect on
    restore.
  - `agent-executor`, `agent-command`, `agent-transport-tui`, `agent-cli` — the spawn input, the
    `/fork` module and the attach control that carry it to the surface.

- af2f2ad: `/cd <directory>` continues the conversation in another directory.

  - **A move is a new session in the target directory.** In the TUI, robota saves a copy of the
    conversation where the target's session store will find it, ends the current run through its
    normal end-of-life flow, and starts again in the target directory resuming that copy. The target's
    settings, trust decision, tools, skills and `AGENTS.md` apply, exactly as if robota had been
    launched there. The process boundary makes the move atomic, so no tool call can straddle it.
  - **The system prompt is kept as recorded**, so a provider's prompt cache survives. One appended
    `<workspace-move>` message tells the model the new directory, and which project instructions now
    apply.
  - **Refused** while a turn is running or a background task is still running, for a missing directory
    or the current one, and for a target a `Cd(...)` deny rule names.
  - **Access never widens:** a restricted session stays restricted after a move, and a trusted session
    takes the target's own trust decision.
  - New contracts: the `workspace-move` host action, `ICommandWorkspaceAdapter` /
    `IWorkspaceMoveRequest`, `InteractiveSession.moveWorkspace`, and the `workspaceMovedFrom` session
    option. The CLI's `--moved-from` and `--restricted-workspace` flags are internal.

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

- 2ebff01: Emit the complete persisted checkpoint and branch lifecycle, forward plan, context-refresh, and
  branch events through protocol transports, and render deterministic bounded notices in the TUI.
  Transport-owned delivery failures now enter the owning carrier cleanup lifecycle without reversing
  an already-committed session operation.
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
- 90e7a10: The default background observer warning code and exported `OBSERVER_FAILURE_WARNING_CODE` value
  change from `ROBOTA_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
  the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
  their background manager or session options. The Robota CLI supplies its existing code explicitly
  across print, goal, serve, MCP, and TUI sessions.
- 44393be: Add the `/remote-control` enable path (REMOTE-008 Stage B4-2b) — turn on P2P remote control locally, get
  a QR + link, and a paired device co-drives the SAME live session over pairing-gated WebRTC. The command
  is a declarative trigger returning `remote-control-enable-requested`/`-stop-requested` effects (SSOT
  agent-interface-transport) and reads state via a new `ICommandHostAdapters.remoteControl.getStatus()`;
  the TUI dispatches the effects to injected callbacks; all transport construction lives at the agent-cli
  composition root (`WsSignalingClient` + pairing-gated `WebRtcTransport`, relay URL from
  `transports.webrtc.options.relayUrl`, QR/link rendered into history). Fail-closed: no relay configured ⇒
  does nothing; pairing mismatch/timeout ⇒ the session is never exposed. Consumes REMOTE-007 so a paired
  remote owner answers their own permission/ask prompts over the WebRTC channel.
- fde558e: Forward organization policy through TUI, print, and goal sessions so blocked commands are enforced consistently. Preserve print/goal preset generation, language, prompt-seed, and structured-response options through the headless channel, and guard declared session-capability projections against silent field loss.

### Patch Changes

- 9368d00: Advisor escalation: the main model can consult a second model at the decision points it chooses.

  With an advisor configured (`--advisor <profile>[:<model>]`, or the `advisorModel` setting that
  `/advisor` saves; the flag wins), the session gets an `Advisor({ question? })` tool. The advisor reads
  the whole conversation — system prompt, messages, tool calls and results — serialized into one prompt
  and sent with `toolChoice: 'none'`, truncated from the front to fit its window with the system prompt
  kept, and declines when even that does not fit. Its answer comes back framed as guidance to verify;
  an empty or refusing answer reads as declined. Calls are limited to two per turn and a fixed number
  per session, parallel calls in one round share those limits, and a repeated question in the same
  turn returns the earlier answer. A request that was sent counts even when the provider failed (the
  decline is reported by class, never by its text); only a call declined before sending gives its slot
  back.

  Advisor usage, including in-process subagents', is recorded where each turn's usage is recorded —
  the persisted session history, under the advisor's own provider and model — so `/cost`, usage reports
  and resumed sessions include it. `/cost` now totals that history and prices each part on its own
  model, showing "mixed" when more than one model was priced.

  `/advisor <model>` and `/advisor off` change only where calls go, never the tool list, so the main
  model's prompt cache is not invalidated mid-session; the tool is added only when a session starts
  with an advisor. Sending history to a destination (provider type and endpoint host) the main model
  does not already use needs a one-time consent per destination, kept in the user settings file; a
  refusal is remembered for the session. The organization's `allowedProviders` applies, and
  `ROBOTA_DISABLE_ADVISOR=1` turns it off completely. In-process subagents inherit the advisor, bound
  to their own conversation; child-process subagents do not get it.

  **`@robota-sdk/agent-framework` is `major` for one reason: `ICommandHostSessionAccess` gains a
  required member,** `getSessionUsage()`, the session's persisted usage records. An external
  implementation of that role port stops compiling until it adds the method. The rest is additive.

  - `agent-session` — `formatConversationEntries`, the one text rendering of a conversation, now used
    by compaction too. It keeps tool calls and results, marks a user message a peer session sent
    (`user [from "peer:<id>"]`), and JSON-encodes every message onto one line so no content can forge
    another entry; compaction previously flattened all of this. `Session.getProvider()` returns the
    provider the session currently uses.
  - `agent-framework` — `AdvisorController`, `createAdvisorTool`, the advisor spec helpers, provider
    destinations (`describeProviderDestination`, `rememberProviderDestination`), `getSessionUsage` and
    `ISessionUsageRecord`, the `onUsageRecorded` session option, and the optional `advisor` command
    host adapter. Session assembly binds a host-supplied Advisor tool to the session holding it.
  - `agent-command` — the `/advisor` command module; `/cost` reads the session's persisted usage.
  - `agent-cli` — the `--advisor` flag, `advisorModel` setting, per-destination consent store and kill
    switch.
  - `agent-ui-terminal` — a usage line from another source (the advisor, a background task) names that
    source and leaves out the context window it does not have.
  - `agent-session-analytics` — personal usage counts an advisor call's tokens and cost toward its
    turn without counting it as a turn.

- 2711ec6: One broken skill or agent file no longer stops the session.

  Skill, command and agent definitions are shared with other hosts through `.claude`, and those hosts
  define fields of their own. The frontmatter decoder now validates only the fields robota owns and
  ignores the rest (nested `metadata` entries included); a malformed value of an owned field is still
  refused. A refused file is skipped with a single warning and still claims its name, so a
  lower-priority definition cannot stand in for it. An empty `argument-hint` reads as no hint. When
  initialization does fail, the session reports the cause to readiness probes instead of "not
  initialized", so the terminal shows the reason at once rather than a 15-second timeout.

  The terminal also stops printing type names for message-less telemetry records, keeps its own notices
  in place across a history sync so the following answer is not skipped, and CLI diagnostics print
  their context instead of `[object Object]`, through the console so Ink renders them above the frame.

- 2ebff01: Remove the obsolete session-level permission and ask callback options and the stale
  `permission-resolved` display event. Prompt requests now settle exclusively through the canonical
  request events and session resolution methods, while leaf adapters fail closed when callbacks reject.
- 3a8876b: ARCH-029: decompose the command host into role ports

  `ICommandHostContext`, `ICommandSessionRuntime` and `IAgentJobHostContext` are now empty `extends`
  aggregates over 26 named role ports, so a command declares only the capability it uses. A role port
  is a supertype of the aggregate, so narrowing a declared parameter still satisfies
  `ISystemCommand.execute` by contravariance.

  All 79 members are preserved (46 + 18 + 15) with the declaration kind unchanged, so implementors and
  callers stay source-compatible.

  **Breaking:** every role-port member is now required except the adapter bag, whose contents are
  genuinely variational. 38 members went from optional to required. A host that previously omitted a
  member must now provide one — including `validateCurrentSessionReplayLog`, which was an override
  with a framework-computed default and no implementor. `createTestCommandHost`,
  `createTestAgentJobHost` and `createTestSessionRuntime` are published from
  `@robota-sdk/agent-framework/testing` as conformant, cast-free doubles for exactly this.

  Also removed: the `clearConversationHistory` fallback that reached past the host into
  `getSession().clearHistory()`. Those were never the same operation — the host path also broadcasts
  `history_cleared` to every attached surface, so a fallback clear left other surfaces still showing
  the transcript.

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- 07b627f: A local peer can now be answered, and what its turn may do depends on where it runs.

  - `agent-core`: the permission evaluator takes a peer turn's authority as one more input
    (`IPermissionEvaluationContext.peerTurn`), decided after the deny list and ceiling and before
    bypass and allow rules. A peer on another host uses no tool. A peer on the same host may use an
    inspect-class tool that declares `workspacePaths`, only when every named location resolves inside
    the workspace and is not a credential (`isSecretPath`); write and execute tools are refused unless
    enabled, and then every use asks. A tool declaring `repliesToPeer` exists only in a peer turn and
    asks once the turn used another tool. New: `isToolAvailableInPeerTurn`, `TPeerReach`,
    `IPeerTurnAuthority`. `IRunOptions.withholdHostedTools` leaves a provider's hosted tools out of a
    run's requests (`nativeWebTools` with `false` withholds a hosted tool for one call).
  - `agent-tools`: `Read` and `Glob` declare the arguments that say where they look. `Grep` does not:
    it reads files it was never named, so a peer turn does not get it.
  - `agent-session`: `ISessionRunOptions.peerReach` makes a run a peer turn for the permission policy;
    every ask in it needs a fresh approval, and its requests carry no provider-hosted tool. `ISessionOptions.allowPeerChanges` enables write and execute
    tools for same-host peer turns.
  - `agent-interface-session`: `ISubmitOptions.peer` (`IPeerTurnContext`) carries a peer turn's reach,
    the message it answers and the session a reply goes to.
  - `agent-interface-session-mobility`: `IPeerMessage.inReplyTo` threads a conversation;
    `peerReachOf(admission)` maps admission to a reach.
  - `agent-framework`: a peer turn is offered what its origin allows, and a new `peer_reply` tool
    answers the peer that sent the message, threaded to it. The setting `peers.allowChanges` enables
    write and execute tools for same-host peer turns.
  - `agent-ui-terminal`: a permission prompt in a peer turn names the requesting peer.
  - `agent-cli`: incoming peer turns carry their reach and reply route; a conversation is limited in
    depth and in how often this session answers it, and a reply over a limit is not sent and the
    operator is told.
  - `agent-provider-anthropic`, `agent-provider-openai-compatible` (Qwen): a request whose
    `nativeWebTools` sets a hosted tool to `false` is sent without it.

- 9665c6e: Make the permission and "ask the user" flows transport-neutral (REMOTE-007 / B4-2a). A session now
  emits `permission_request` / `ask_request` / `prompt_resolved` events and exposes
  `resolvePermission` / `resolveAsk`, so any attached surface — local TUI, a WS/WebRTC driver, or a web
  UI — can render and answer the SAME prompt (local == remote). The framework builds event-emitting
  default handlers bound to the session emitter (id-keyed parking, fail-closed on zero listeners / on
  detach / backstop, teardown drain on abort/cancelQueue/shutdown), replacing the injected
  askHandler/permissionHandler at their source. `getUserInteraction()` is gated on the `ask_request`
  listener count so the headless "no-human ⇒ proceed" contract is preserved. The WS protocol carries the
  new events + `permission-response` / `ask-response` verbs, and WebRTC gets them for free via the shared
  handler. No `/remote-control` enable path is added.
- c7fa299: REMOTE-003 + REMOTE-006 (merged — net behavior; the interim deny-by-default gate never appeared in a
  published version): commands now carry an invocation source. A `'remote'` value is added to the command
  invocation source (SSOT relocated to `@robota-sdk/agent-interface-transport`, re-exported by
  `agent-framework`) and an optional `source` is threaded into
  `IInteractiveSession.executeCommand(name, args, source?)` (defaults to `'user'`, so all local callers are
  unchanged). The shared `createWsHandler` tags transport-origin commands `'remote'`. Policy: local == remote
  (owner principle) — pairing is the sole trust boundary, so a transport-origin command runs exactly as a
  locally-typed one under the universal permission system (permission modes + PermissionEnforcer + the
  ask/approval handler); `createDefaultRemoteCommandPolicy()` allows by default. The `IRemoteCommandPolicy`
  seam remains as an OPTIONAL, user-configured restriction, and the genuinely-remote WebRTC path stays
  pairing-gated.
- 1c8fbdf: Stabilize the TUI input box bottom border during active output: hand-draw it as a `<Text>` row (mirroring the top border) instead of a Yoga-synthesized Box border, which could drop glyphs under rapid re-render at full terminal height (SCREEN-003).
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
  - @robota-sdk/agent-interface-execution@3.0.0-beta.80
  - @robota-sdk/agent-interface-command@3.0.0-beta.80
  - @robota-sdk/agent-framework@3.0.0-beta.80
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-interface-session@3.0.0-beta.80
  - @robota-sdk/agent-interface-transport@3.0.0-beta.80
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.80
  - @robota-sdk/agent-interface-tui@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79
- @robota-sdk/agent-framework@3.0.0-beta.79
- @robota-sdk/agent-interface-transport@3.0.0-beta.79
- @robota-sdk/agent-interface-tui@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78
  - @robota-sdk/agent-framework@3.0.0-beta.78
  - @robota-sdk/agent-interface-transport@3.0.0-beta.78
  - @robota-sdk/agent-interface-tui@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-framework@3.0.0-beta.77
  - @robota-sdk/agent-interface-transport@3.0.0-beta.77
  - @robota-sdk/agent-interface-tui@3.0.0-beta.77

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

- DQ-AUDIT-003 — restore agent-interface-tui to type-contracts only by removing its runtime type-guards (`isPickerInteraction`/`isConfirmInteraction`, which had zero call sites); narrow `TAnyTuiCommandInteraction` on its `onMissingArgs` discriminant instead. Documented the type-only downward references in agent-interface-transport.
- Updated dependencies
- Updated dependencies
- Updated dependencies [c0a6287]
- Updated dependencies [9df3a88]
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-interface-tui@3.0.0-beta.76
  - @robota-sdk/agent-framework@3.0.0-beta.76
  - @robota-sdk/agent-interface-transport@3.0.0-beta.76
