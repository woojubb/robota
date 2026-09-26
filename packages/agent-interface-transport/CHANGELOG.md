# @robota-sdk/agent-interface-transport

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81

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

- 52b7346: **BREAKING — ARCH-012: three `IInteractiveSession` members become required, and the conformant test double moves.**

  `isInitialized`, `getPendingCount` and `getActiveDriverId` were OPTIONAL. A consumer reading
  `session.getActiveDriverId?.() ?? undefined` received the same `undefined` for two unrelated
  situations — the host attributes turns and none is active, and the host cannot attribute turns at all
  — with no error, no log, and nothing to tell them apart. The second loses every co-drive attribution
  silently.

  **Any implementation of `IInteractiveSession` must now provide all three.** `null` from
  `getActiveDriverId()` means exactly one thing: nobody is driving.

  ```ts
  // before — a host could simply omit these
  class MySession implements IInteractiveSession {
    submit(/* … */) {
      /* … */
    }
  }

  // after
  class MySession implements IInteractiveSession {
    readonly isInitialized = true;
    getPendingCount(): number {
      return this.queue.length;
    }
    getActiveDriverId(): TDriverId | null {
      return this.activeDriver ?? null;
    }
    submit(/* … */) {
      /* … */
    }
  }
  ```

  **`createTestInteractiveSession` moved** from `@robota-sdk/agent-framework` (its `./testing` subpath)
  to `@robota-sdk/agent-interface-transport/testing`, beside the contract it doubles. It is **not**
  re-exported from the old location: pass-through re-exports of another package's symbols are banned in
  this repo, and the old export had no in-repo consumers — every transport package sits below
  `agent-framework` and could never import it, which is why 41 hand-rolled partials existed instead.

  ```ts
  // before
  import { createTestInteractiveSession } from '@robota-sdk/agent-framework/testing';
  // after
  import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';
  ```

- 2ebff01: Remove the obsolete session-level permission and ask callback options and the stale
  `permission-resolved` display event. Prompt requests now settle exclusively through the canonical
  request events and session resolution methods, while leaf adapters fail closed when callbacks reject.
- 0f98419: ARCH-037 — published-contract hygiene.

  **Breaking for anyone importing these from `@robota-sdk/agent-interface-transport`** — hence `major`,
  matching ARCH-031's precedent for a barrel that loses names (a `minor` would file the removal under
  "Minor Changes" and a beta consumer scanning for breaking changes would meet it as a `TS2305` after
  upgrading instead). The package is
  pre-release and the repo keeps no compatibility shims, so the names are removed rather than deprecated;
  both are re-exports of types `@robota-sdk/agent-core` owns and still exports under the same names.

  - `IActionRequest` — import from `@robota-sdk/agent-core`.
  - `TBackgroundPermissionPolicy` — import from `@robota-sdk/agent-core`.

  `TActionResponse` deliberately STAYS. It is the one path by which `agent-transport-gui` and
  `agent-transport-protocol` can name the type: neither may depend on `agent-core`, and `agent-core` is
  the bottom layer, so the type cannot move down either. It is now a named exception carrying that
  reasoning in the source.

  **Added** to `@robota-sdk/agent-framework`: `ICreateDefaultToolsOptions`. `createDefaultTools` was
  exported without it, so a consumer could call the function but could not name what it must pass —
  they had to reverse-engineer the shape or cast into it. A new `barrel-parameter-types` harness floor
  now fails on that shape rather than leaving it to review.

  `@robota-sdk/agent-executor` is a patch only: it now sources `TBackgroundPermissionPolicy` from
  `@robota-sdk/agent-core` (which it already depends on) instead of through the interface package. Its
  own published surface is unchanged.

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

- 5134b3b: **BREAKING — RUNTIME-003 P2: `submit` hands back the submission's identity, so an answer belongs to
  the caller who asked for it.**

  `submit` returned nothing, so a caller that needed to know when ITS turn ended had only the
  session-global `complete` / `interrupted` / `error` events — which say that A turn ended and never
  which one. The MCP adapter did exactly that, and the result was measurable: a session runs one turn
  at a time and queues the rest, so two concurrent `submit` calls did not run concurrently. The second
  waited and then took the RUNNING turn's response as its own answer. Both callers were told about one
  turn; neither was told which.

  `submit` now returns an `ITurnHandle` — `{ turnId, completed }`. The id is minted when the submission
  is ACCEPTED and kept if it waits in the queue, so one submission is one identity from end to end.

  `completed` always settles, and that is the part that took the work. A queued submission is not
  promised a turn: the co-drive queue coalesces a same-driver input into the one behind it, drops at
  capacity, and discards everything when cleared. A handle that settled only for submissions that ran
  would leave the rest waiting forever — a worse failure than the ambiguity it replaces — so each of
  those rejects with a typed `TurnNotRunError` naming which happened (`coalesced`, `dropped`,
  `cancelled` — shutdown clears the queue through the same path, so it reports as cancelled).

  **Migration.** A caller that ignores the return value is unaffected: `await session.submit(...)`
  still means what it did, and the direct path still resolves only when the turn is over. An
  IMPLEMENTER of `IInteractiveSession` must now return a handle:

  ```ts
  // before
  async submit(input: string): Promise<void> {
    await runTurn(input);
  }

  // after
  async submit(input: string): Promise<ITurnHandle> {
    const turnId = crypto.randomUUID();
    return { turnId, completed: runTurn(input) };
  }
  ```

  `createTestInteractiveSession` already returns a conforming handle, so a double built on it needs no
  change.

  One thing this deliberately does NOT do: DAG run advancement (P3) stays with DAG-001.

  An earlier draft of this note claimed the HTTP route's documented TOCTOU had been measured and was
  not reachable. That was wrong, and it is corrected here rather than left for a reader to trip over.
  The probe behind it used a `submit` stub with no suspension point, so it could not exhibit the race
  it was written to rule out; the real `submit` opens with `await ensureInitialized()`. The race is
  real and is fixed in its own change (#1656), where the route CLAIMS the turn instead of asking
  whether one is running.

### Minor Changes

- 37b4bd7: `readAssistantReplies`, `readErrors`, `readLastAssistantText` and `readToolCalls` are exported from
  `@robota-sdk/agent-interface-session`, which is now published alongside
  `@robota-sdk/agent-interface-transport` (issue #2260).

  The four helpers shipped from `agent-interface-transport@3.0.0-beta.79` and moved to the session
  package on `develop` (ARCH-103..108), which was not yet on the registry. A consumer importing them
  from the transport package migrates the import to `@robota-sdk/agent-interface-session`; the session
  package is in the changeset fixed group, so it versions and publishes with the transport package.

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

- 9db63ee: Add named session capability roles and explicit capability-host queries while preserving the legacy
  `IInteractiveSession` interface shape. HTTP, MCP, protocol, WS, WebRTC, and headless transports now
  declare only the session roles they consume, and the direct aggregate-cast floor is zero.
- b078afa: Preserve complete resumable session records when the raw Session writer re-saves them.

  `IInteractiveSessionStore` is now the canonical persistence port, including its optional file-backed
  record-path capability. `agent-session` consumes the canonical record and store contracts directly and
  keeps its former type names only as compatibility re-exports.

- 2ebff01: Emit the complete persisted checkpoint and branch lifecycle, forward plan, context-refresh, and
  branch events through protocol transports, and render deterministic bounded notices in the TUI.
  Transport-owned delivery failures now enter the owning carrier cleanup lifecycle without reversing
  an already-committed session operation.
- 4772067: **BREAKING — ARCH-031: the subagent seam is derived from its transport SSOT instead of copied.**

  One field family — what a subagent job IS — was declared three times as independent shapes and carried
  between them by six hand-written object literals that nothing checked for totality. A field added to
  either side had to be hand-copied at every hop, and a miss compiled clean as a silent no-op. TYPE-003
  named this cause and derived one hop; the next two changes each dropped a field at a hop it had skipped
  (CORE-025's permission policy, and ANALYTICS-001's `usage`, dropped in the very commit that added it).

  ```ts
  // now, in @robota-sdk/agent-interface-transport
  export type ISubagentSpawnRequest = Omit<IAgentBackgroundTaskRequest, 'kind'>;
  export type ISubagentJobResult = Omit<IBackgroundTaskResult, 'kind' | 'exitCode' | 'signalCode'>;
  ```

  All four projections collapse to spreads. `parentTaskId` and `providerProfile` now reach the runner
  because they exist on the source, not because someone remembered them.

  **Per package, classified against each barrel:**

  - **`agent-executor` (major)** — the barrel loses `ISubagentSpawnRequest` and `ISubagentJobResult` (they
    moved to their owner; re-publishing them here would be a pass-through re-export). `ISubagentJobStart`
    and `ISubagentJobHandle` rename `jobId` → `taskId`, `ISubagentJobStart` gains `worktree?`, and
    `ISubagentWorktreePrepareRequest` renames `jobId` → `taskId`.
  - **`agent-framework` (major)** — the barrel loses eleven type-only re-exports of `agent-executor`-owned
    types. They carried zero runtime values, so they bought none of the assembly convenience a runtime
    facade exists for, while making one field family look like it had three owners. Separately,
    `ISpawnAgentTaskRequest.permissionPolicy` goes optional → **required**.
  - **`agent-subagent-runner` (major)** — `ISubagentWorkerStartPayload` renames `jobId` → `taskId` and gains
    `worktree?`. This package is not in the item's declared `area:`; the audit that caught it is the reason
    it is here.
  - **`agent-interface-transport` (minor)** — two new barrel exports; nothing removed or renamed.
  - **`agent-core` (minor)** — **two** new barrel exports. `DEFAULT_BACKGROUND_PERMISSION_POLICY` is the
    intended one; collapsing the hand-listed permissions block to `export *` also surfaced
    `clearRegisteredToolArgumentKeys`, which the old list had omitted. It is documented as public rather
    than re-narrowed — a barrel that cannot fall out of step with its owner is the point of the collapse.
    Nothing was removed: all nine previously-listed permission types remain on the barrel.
  - **`agent-cli` (patch)** — migrated as the only in-repo implementer of `ISubagentWorktreeAdapter`; no
    barrel change.

  **`permissionPolicy` is now required at the spawn boundary**, and its default is one exported constant
  owned by the permission SSOT. It was previously applied as `?? 'inherit-allowlist'` in the middle of a
  projection, in **two** packages independently, with nothing keeping them equal — a security-relevant value
  whose default was declared twice. Every spawn site now states its own policy.

  **The worktree identity moved to the runner envelope.** It is runner-produced — the worktree does not
  exist when a caller builds a request — so it rides on `ISubagentJobStart.worktree` and crosses the IPC
  boundary there. The runner no longer also rewrites `request.cwd`, which had given ARCH-010's execution-root
  rule two carriers that could disagree. `branchName` **relocated rather than being deleted**: it has no
  reader in this repository today, and for a library that is not a reason to drop a legitimate contract.

  **Renames are consistent across the SPI** (`type` → `agentType`, `jobId` → `taskId`) rather than applied to
  one shape, which would have left two names for one identifier in a single file. The IPC validator's
  string-literal keys are now typed against the contract, so the next rename is a compile error instead of a
  runtime rejection of every start payload.

- d312755: Provider DIP Stage D (ARCH-PROVIDER-005): invert the skill node's dependency on the
  agent-framework assembly. New `ISkillExecutionPort` contract in
  `@robota-sdk/agent-interface-transport`; `@robota-sdk/agent-framework` exports
  `createSkillExecutionPort()`; `@robota-sdk/dag-node-skill` now requires an injected
  `skillPort` (via `ISkillNodeDefinitionOptions.skillPort`) and no longer depends on
  `agent-framework`. The concrete port is injected at the `dag-nodes-default` composition
  root. Closes ARL-11 (skill-half).

  BREAKING (@robota-sdk/dag-node-skill): `SkillNodeDefinition`/`SkillResolverRuntime` now
  require an injected `skillPort`; the no-arg `createSkillNodeDefinition()` factory is removed.

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
- 44393be: Add the `/remote-control` enable path (REMOTE-008 Stage B4-2b) — turn on P2P remote control locally, get
  a QR + link, and a paired device co-drives the SAME live session over pairing-gated WebRTC. The command
  is a declarative trigger returning `remote-control-enable-requested`/`-stop-requested` effects (SSOT
  agent-interface-transport) and reads state via a new `ICommandHostAdapters.remoteControl.getStatus()`;
  the TUI dispatches the effects to injected callbacks; all transport construction lives at the agent-cli
  composition root (`WsSignalingClient` + pairing-gated `WebRtcTransport`, relay URL from
  `transports.webrtc.options.relayUrl`, QR/link rendered into history). Fail-closed: no relay configured ⇒
  does nothing; pairing mismatch/timeout ⇒ the session is never exposed. Consumes REMOTE-007 so a paired
  remote owner answers their own permission/ask prompts over the WebRTC channel.
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
- 5c5ff23: TRANS-001: payload-agnostic transport — opaque binary frames + consumer-declared event types

  The WS transport now carries **arbitrary payloads** alongside the text-agent protocol on one
  connection, instead of forcing every app-level payload through the `text_delta`/`submit` wire
  protocol.

  - `agent-interface-transport` adds the channel contracts (`IBinaryFrame`, `IChannelEventFrame`,
    `IChannelDescriptor`, `IPayloadChannel`, `IPayloadChannelHost`, `TChannelEventMap`,
    `TChannelFrame`, `TChannelReceiveResult`). Content-neutral carrier mechanics — no payload domain.
  - `agent-transport-protocol` adds the pure channel frame codec (`encodeBinaryFrame`,
    `encodeChannelEventFrame`, `decodeChannelFrame`, `isChannelFrame`). `TClientMessage` /
    `TServerMessage` are unchanged.
  - `agent-transport-ws` becomes a carrier that routes by WebSocket frame opcode — TEXT to the
    text-agent protocol profile, BINARY to consumer-declared channels — and `WsTransport` now
    implements `IPayloadChannelHost` (`registerChannel`). `PayloadChannelRegistry` is exported.

  Additive only: existing transports, consumers, and the agent wire protocol are untouched.

### Patch Changes

- 9db63ee: Fix the published test session factory so each default submission receives a deterministic identity
  derived from its session id and per-session submission sequence. The testing fixture now models
  multiple correlated turns without changing production contracts or public TypeScript signatures.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- 7669851: Remove `createSessionCapabilityHost` and `readSessionCapability` from the package entry
  (HARNESS-103). They are the runtime mechanism `.agents/project-structure.md` forbids an
  `agent-interface-*` package from containing, and they have no production consumer — the only callers
  were this package's own unit test and its `testing` subpath. They now live under `testing/`, per the
  repository's placement rule (`contracts→agent-interface-*, doubles→owner /testing`), and are still
  reachable as `createTestSessionCapabilityHost` from `@robota-sdk/agent-interface-transport/testing`.

  The contracts they satisfy — `ISessionCapabilityHost`, `TSessionCapabilityHost`,
  `TSessionCapabilityReadResult` — remain on the entry unchanged.

- 4b76cfa: NEUT-005 (wave 2): restore an actionable context-capacity hint at the surface tier, neutrally. The zero-dependency `agent-core` layer emits a product-neutral hard-capacity notice and exposes the `IAgentConfig.contextCapacityHint` seam (wave 1). This wave wires that seam end-to-end without baking product vocabulary into a neutral library:

  - `agent-session`: `ISessionOptions.contextCapacityHint` is forwarded into the Robota agent config (`buildRobota`), making the core seam reachable from the consuming layer.
  - `agent-framework`: new `deriveContextCapacityHint(commandModules)` derives the concrete remediation wording from the surface's OWN registered command set (names a registered `compact` command → `"Run /compact and retry."`; `undefined` when none, leaving the neutral core default). It is applied automatically in interactive session assembly across the TUI, print, and `--serve` surfaces.
  - `agent-cli`: the default command set registers `/compact`, so end users regain the actionable hint.
  - `agent-interface-transport`: reworded the `'allow-project'` permission comment so it no longer hardcodes a storage path (the location is owned by the consuming layer), matching the `agent-session` twin.

- 9814afc: Type-SSOT convergence (TYPE-003; re-audit CONTRACT-002/003/011/012 + RUNTIME-47 + STRUCT-04). Behavior is unchanged — this is a type-level refactor. `ITokenUsage` (agent-core) is confirmed as the usage-triple SSOT: `ISessionUsageTotals` and `IBackgroundTaskUsage` become aliases, and every inline `{ promptTokens; completionTokens; totalTokens }` copy (service/orchestration/executor/remote-client shapes) now references the SSOT (structurally identical → patch). The subagent-job contracts derive from the background-task SSOT — `TSubagentJobStatus = Exclude<TBackgroundTaskStatus, 'paused'>`, mode alias, and a `Pick`-projection `ISubagentJobState` — with a compile-enforced parity test so a drifting hand copy can no longer exist. `@robota-sdk/agent-session` is minor because the public `ISessionRecord` type is now the typed `IInteractiveSessionRecord` alias (previously a relaxed `unknown[]` mirror): runtime behavior of `SessionStore` is identical, but downstream code that assigned loose payloads to the record's fields may need explicit casts at its own trust boundary (the framework store facade's `as unknown as` cast bridge is deleted). agent-session's duplicate `@robota-sdk/agent-core` deps/devDeps declaration is also removed (STRUCT-04).
- Updated dependencies [7b6234c]
- Updated dependencies [4eea54b]
- Updated dependencies [1698be4]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [fec722f]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
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
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [d6b9404]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-session@3.0.0-beta.76
  - @robota-sdk/agent-executor@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.75
  - @robota-sdk/agent-session@3.0.0-beta.75
  - @robota-sdk/agent-executor@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.74
- @robota-sdk/agent-executor@3.0.0-beta.74
- @robota-sdk/agent-session@3.0.0-beta.74

## 3.0.0-beta.73

## 3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate

## 3.0.0-beta.70

## 3.0.0-beta.69

## 3.0.0-beta.68

## 3.0.0-beta.67

## 3.0.0-beta.66

## 3.0.0-beta.65

## 3.0.0-beta.64

## 3.0.0-beta.63

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.63
