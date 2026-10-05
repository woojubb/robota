# @robota-sdk/agent-framework

## 3.0.0-beta.89
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.89
  - @robota-sdk/agent-executor@3.0.0-beta.89
  - @robota-sdk/agent-file-authority@3.0.0-beta.89
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.89
  - @robota-sdk/agent-interface-command@3.0.0-beta.89
  - @robota-sdk/agent-interface-execution@3.0.0-beta.89
  - @robota-sdk/agent-interface-session@3.0.0-beta.89
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.89
  - @robota-sdk/agent-interface-transport@3.0.0-beta.89
  - @robota-sdk/agent-roundtable@3.0.0-beta.89
  - @robota-sdk/agent-session@3.0.0-beta.89
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.89
  - @robota-sdk/agent-tools@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- Updated dependencies [d994f60]
  - @robota-sdk/agent-tools@3.0.0-beta.88
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.88
  - @robota-sdk/agent-core@3.0.0-beta.88
  - @robota-sdk/agent-executor@3.0.0-beta.88
  - @robota-sdk/agent-file-authority@3.0.0-beta.88
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.88
  - @robota-sdk/agent-interface-command@3.0.0-beta.88
  - @robota-sdk/agent-interface-execution@3.0.0-beta.88
  - @robota-sdk/agent-interface-session@3.0.0-beta.88
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.88
  - @robota-sdk/agent-interface-transport@3.0.0-beta.88
  - @robota-sdk/agent-roundtable@3.0.0-beta.88
  - @robota-sdk/agent-session@3.0.0-beta.88

## 3.0.0-beta.87

### Minor Changes

- 7d9cc66: Keep host-declared inline human controls reachable during active turns. Plugin disable and uninstall can withdraw future dispatch without changing model invocation or host command policy.
- 7d9cc66: Expose declarative contribution descriptors for installed bundles and resolved MCP sources,
  including source generations, host capability requirements and compatibility diagnostics.
  Revalidate MCP approval, source identity and workspace trust before new dispatch, preserving
  outcomes of calls already started and refusing retained tools after shutdown.
- 7d9cc66: Preserve an explicitly supplied host tool scheduling policy through session assembly and CLI presentation modes, retaining permission admission and conservative handling of undeclared resources.

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 7d9cc66: Load declared JSON and inline bundle MCP configurations with selected-source containment, ordered whole-server replacement and file provenance. Route packaged servers through normal CLI/app MCP startup with namespaced identities, existing trust/approval/authority gates, disable overlays and value-free compatibility diagnostics.
- 7d9cc66: Load external name-only plugin manifests without inventing optional metadata. Select the recorded
  installed source instead of the lexically last cached directory, refusing invalid, missing or
  ambiguous revisions. Check the installed identity as well as the manifest name for disablement.
- 7d9cc66: Add user-only project memory topic correction and forgetting, prevent automatic restoration after restart, refresh retained startup context, and reconcile semantic recall with current durable source content.
- 7d9cc66: Allow consumer eval metrics to require a perfect outcome independently of aggregate scores, and reject interrupted runs as successful evaluations.
- 7d9cc66: Add explicit MCP Skills selection, bounded supervisor access and persistent host content consent.
  Users can inspect verified instructions, approve the exact content fingerprint and withdraw consent;
  models can discover metadata only. Consent stays separate from server admission and model-turn activation.
- 7d9cc66: Route discovered MCP Skills through the shared skill command runtime with lazy verified content, source-bound invocation names, current user consent and execution-owned activation cleanup. Keep remote shell expressions inert and defer queued user skill reads until their own turn executes.
- 7d9cc66: Restore actual interactive tool observations, identities and outcomes from persisted event history.
  Show denied calls as failed in live and restored GUI conversation views.
- 7d9cc66: Retain registered tool source attribution in observations and preserve ordered outcome receipts independently of conversation summaries.
- 7d9cc66: Expose verified skill supporting resources only within their owning turn or fork, using the current host consent and manifest.
- 7d9cc66: Retain mixed tool observations alongside structured results through live session events and history
  display. The shared app renderer previews inline raster images and keeps resource URIs inert, with
  explicit diagnostics for unsupported media instead of silently dropping it.
- 7d9cc66: Observe scheduler queue intervals separately from pre-dispatch admission, permission and tool work.
  Preserve valid duration totals when live trace detail is bounded, reporting invalid evidence explicitly
  through content-free console and OTLP traces without altering dispatch, recovery or settlement.
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
  - @robota-sdk/agent-core@3.0.0-beta.87
  - @robota-sdk/agent-executor@3.0.0-beta.87
  - @robota-sdk/agent-file-authority@3.0.0-beta.87
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.87
  - @robota-sdk/agent-interface-command@3.0.0-beta.87
  - @robota-sdk/agent-interface-execution@3.0.0-beta.87
  - @robota-sdk/agent-interface-session@3.0.0-beta.87
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.87
  - @robota-sdk/agent-interface-transport@3.0.0-beta.87
  - @robota-sdk/agent-roundtable@3.0.0-beta.87
  - @robota-sdk/agent-session@3.0.0-beta.87
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.87
  - @robota-sdk/agent-tools@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.86
- @robota-sdk/agent-executor@3.0.0-beta.86
- @robota-sdk/agent-file-authority@3.0.0-beta.86
- @robota-sdk/agent-interface-analytics@3.0.0-beta.86
- @robota-sdk/agent-interface-command@3.0.0-beta.86
- @robota-sdk/agent-interface-execution@3.0.0-beta.86
- @robota-sdk/agent-interface-session@3.0.0-beta.86
- @robota-sdk/agent-interface-session-mobility@3.0.0-beta.86
- @robota-sdk/agent-interface-transport@3.0.0-beta.86
- @robota-sdk/agent-roundtable@3.0.0-beta.86
- @robota-sdk/agent-session@3.0.0-beta.86
- @robota-sdk/agent-tool-defaults@3.0.0-beta.86
- @robota-sdk/agent-tools@3.0.0-beta.86

## 3.0.0-beta.85

### Minor Changes

- 193a0bc: `${CLAUDE_SKILL_DIR}` in a skill expands to the absolute folder its `SKILL.md` is in; it used to expand to an empty string. A skill's `` !`command` `` gets `CLAUDE_SKILL_DIR` and `CLAUDE_SESSION_ID` in its environment, so the shell expands them there too (`TShellExecFn` takes an optional `env`). Skills from host folders and a trusted project carry the folder, and bundle-plugin skills and commands record theirs. `ICommand` gains `skillDirectory`, and `IContributionSource` an optional `locate()` that names the absolute path of a root-relative one.
- 54e2848: `createQuery()` takes `model`, `allowedTools` and `deniedTools`, and the query function has `shutdown()`.

  - `model` picks the model, so a query works with any provider without a settings file; before, it always asked for Anthropic's default model.
  - `allowedTools` lets named tools (your own `additionalTools`, say) run in the `default` mode without a `permissionHandler`; `deniedTools` are never offered to the model.
  - Calls on one query function run one at a time and each resolves with its own reply. Before, concurrent calls all resolved with the first turn's reply.
  - `await query.shutdown()` ends the query's session; a call still running or waiting rejects, and so does every later one.

### Patch Changes

- 4e11579: `runGroupChat` runs on the Roundtable core.

  `runGroupChat`'s own `while` loop is replaced by a facade over `@robota-sdk/agent-roundtable`'s
  `Roundtable`: one step id becomes one participant, the caller's `selectNextStep` policy is adapted
  into a `TurnSelector`, and the core runs the only turn loop. The public contract
  (`IGroupChatOrchestrationSpec`, `SelectNextStep`, `IGroupChatOrchestratorDeps`,
  `IOrchestrationRunResult`) is unchanged, and so is the behavior it describes: the first speaker,
  threaded whole-transcript prompts, the `maxTurns` bound and its error message and check order, empty
  steps, the STARTED/STEP_STARTED/STEP_COMPLETED/COMPLETED/FAILED event sequence, per-step usage, and
  the original error object thrown on failure — including for inputs the old loop tolerated only
  because it never validated them, such as a non-finite or extremely large `maxTurns` or a step with no
  usable model id.

  A few differences are deliberate and small: the selector now receives a freshly built history array
  on every call rather than a reference into a mutated one; a duplicate step id keeps only its last
  definition and an empty step id can never be reached (both were already-unreachable edge cases in
  the old loop); and a non-integer `maxTurns` is rounded up for the core's own internal turn ceiling,
  though the selector's own bound check still compares the caller's exact value first. Reported step
  usage comes back as a plain-data copy (same values; undefined-valued keys omitted), and a reading that
  cannot be stored as finite JSON, such as one containing `NaN`, is left out of the step result instead
  of failing the run. Each call keeps a small in-memory operation log for its conversation; it is bounded
  per call and negligible at the default `maxTurns` (the step count).

- 3c1967f: Reloading plugins updates the live session's skill routing and model skill catalogue together
  with command completion. Disabled plugins stop being executable after reload, and unreadable
  settings clear the plugin skill snapshot. Hook changes require a new session.
- 5684612: A bundle plugin skill can use `${CLAUDE_PLUGIN_ROOT}`: it expands to the plugin's folder in the
  skill's body, and `` !`command` `` preprocessing gets it in the environment, as plugin hooks already
  did. Every skill's commands now get `CLAUDE_PLUGIN_ROOT` set (empty outside a plugin), so a value the
  host process carries never stands in for it. A session also loads project plugins, skills and hooks
  alike, only from a folder inside the trusted workspace; trust granted to one repository does not
  extend to a plugin folder elsewhere.
- 6ee8725: A user settings file that does not parse no longer reads as "no plugin is disabled". Plugin settings
  now refuse to read it: no plugin loads (skills, commands, hooks and themes alike), a plugin command
  such as `/plugin enable` fails instead of rewriting the whole settings file with the plugin keys
  alone, and `__PRODUCT_CLI_NAME__ doctor` reports the plugin check as failed while still inspecting each installed
  plugin. The CLI already refuses to start with such a file; this covers a session started later in
  the same process.
- 6072e9a: Bundle plugin skills and commands now run. They were listed in the command menu, but typing one
  answered "Unknown command", and the model could neither see nor activate them: the session's skill
  router and the prompt's skill list read only the host's skill roots. A session now also loads the
  skills and commands of the bundle plugins it may load, once, behind the same gates as plugin hooks
  (not in a bare session, project plugins only in a trusted workspace, disabled plugins skipped). A
  session's own skill of the same name wins, then the first plugin to name it.
- 2e07cad: A subagent and a fork-context skill now start in the permission mode their parent is in at that
  moment. The runtime used to hand them the mode it was built with, so after a switch to `plan` a
  subagent the model started, or a skill it ran in a fork, still ran in the earlier mode and could
  edit. `IInProcessSubagentRunnerDeps` gains the optional `getParentPermissionMode`, which the session
  wires to its live mode; the in-process and child-process runners read it at spawn and fall back to
  `permissionMode` when it is absent.

  In plan mode the model can no longer run `/workflows create` or `/workflows build`: both save to
  the project, and `create` also runs the workflow. The user can still run them by hand.

- Updated dependencies [190f78f]
- Updated dependencies [41cca13]
- Updated dependencies [193a0bc]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [94b2c87]
- Updated dependencies [10597b2]
- Updated dependencies [3ab2eca]
  - @robota-sdk/agent-roundtable@3.0.0-beta.85
  - @robota-sdk/agent-core@3.0.0-beta.85
  - @robota-sdk/agent-interface-command@3.0.0-beta.85
  - @robota-sdk/agent-session@3.0.0-beta.85
  - @robota-sdk/agent-executor@3.0.0-beta.85
  - @robota-sdk/agent-interface-execution@3.0.0-beta.85
  - @robota-sdk/agent-interface-session@3.0.0-beta.85
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.85
  - @robota-sdk/agent-interface-transport@3.0.0-beta.85
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.85
  - @robota-sdk/agent-tools@3.0.0-beta.85
  - @robota-sdk/agent-file-authority@3.0.0-beta.85
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.85

## 3.0.0-beta.84

### Minor Changes

- e8d70ac: A first run finds a provider, instead of a dead end. `__PRODUCT_CLI_NAME__ --serve` (and the daemon it starts) no
  longer refuses when no provider is configured: it starts in setup mode, and the GUI's conversation area
  shows a "Connect a model provider to start" panel with a "Set up provider" button in place of the
  composer. Answering it configures and swaps in the first provider live, with no restart. A startup
  failure now says why — `__PRODUCT_CLI_NAME__ daemon start --json` and the desktop app's fatal screen report the
  child's own reason instead of a generic "readiness channel closed", and the fatal screen gets a Try
  again button. `trust status --json` and the desktop trust dialog list only sources whose state trust
  would actually change, instead of naming one this platform could not determine; the dialog shows one
  sentence and a collapsed Details section. `__PRODUCT_CLI_NAME__ --serve --open` in an untrusted folder now asks at
  the terminal (trust it, start Restricted, or quit) when someone is there to ask, instead of refusing
  outright.

### Patch Changes

- Updated dependencies [c7f213c]
- Updated dependencies [9f46375]
- Updated dependencies [9f46375]
- Updated dependencies [e8d70ac]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.84
  - @robota-sdk/agent-core@3.0.0-beta.84
  - @robota-sdk/agent-session@3.0.0-beta.84
  - @robota-sdk/agent-interface-session@3.0.0-beta.84
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.84
  - @robota-sdk/agent-tools@3.0.0-beta.84
  - @robota-sdk/agent-interface-execution@3.0.0-beta.84
  - @robota-sdk/agent-interface-command@3.0.0-beta.84
  - @robota-sdk/agent-executor@3.0.0-beta.84
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.84
  - @robota-sdk/agent-interface-transport@3.0.0-beta.84
  - @robota-sdk/agent-file-authority@3.0.0-beta.84

## 3.0.0-beta.83

### Major Changes

- 6ae3f28: A served runtime can list its workspace's sessions, start a new one and switch to another without the
  process or any client connection restarting. The GUI shows them in a sessions sidebar.

  - `agent-interface-session` is **`major`** for two reasons:
    - It adds `ISessionListing`, `ISessionDirectory` and `ISessionSwitchedEvent`.
    - `IInteractiveSessionEvents` gains a required `session_switched` event. An exhaustive map over the
      event names stops compiling until it classifies the new event.
  - `agent-transport` is **`major`** for the same kind of reason:
    - It adds the wire messages `list-sessions` → `sessions`/`sessions_error`, `new-session`,
      `switch-session`, and the broadcast `session_switched`.
    - It adds a `sessionDirectory` handler option. A refusal to switch comes back as a
      `protocol_error` carrying the reason.
    - An exhaustive map over message types must add the new variants.
  - `agent-transport-ws` passes a configured `sessionDirectory` to every connection.
  - `agent-framework` is **`major` because `IRuntimeHostHandle.session` is now a `SessionSlot`**, not the
    `InteractiveSession`, and `bindTransports` receives the slot.
    - The slot is an `IInteractiveSession` that forwards to the current session. Members outside that
      interface are read through `host.session.current`, which changes on a switch.
    - Adds `InteractiveSession.whenInitialized()`.
    - Exports `listUnreadableSessions`.
  - `agent-ui-web` is **`major`**:
    - `IWsSessionState` gains session listing state and actions.
    - It adds a `SessionSidebar`.
    - `/resume` opens the sidebar.
  - `agent-cli`: `__PRODUCT_CLI_NAME__ --serve` provides the session directory, and refuses a switch that would lose
    work in progress. External-event grants belong to the run: a switch reopens them on the new session,
    as the TUI already does.
  - External-event grant history (spent tokens, rate windows, revocations) belongs to the run. The new
    option `externalEventGrantHistory` (from `createExternalEventGrantHistory()`) is shared by every
    session that a served runtime or the TUI builds. A session switch therefore replays no spent token
    and resets no rate limit. The TUI previously had this gap when it switched sessions.

### Minor Changes

- 724fabb: External-event grants are given at start, carried exactly to a background session, listed without their
  principal, and revoked by the owner.

  - `agent-framework` (breaking) — `openExternalEventSource` and `ExternalEventIngress.open` take only
    `{ grant, audit? }`: the session builds each grant's verifier from `grant.verifier` with the
    `externalEventVerifierFactory` its host passed when the session was built (without one, no grant opens), and an
    open that supplies a verifier or a factory is refused. `IExternalEventSource.revoke()` stops the grant's queued and running turns,
    refuses its later events as `grant-revoked`, and keeps the label from being opened again. A submission the
    session refuses is `shutting-down` only while it shuts down, and `session-unavailable` otherwise. New command
    host adapter `externalEvents` (`ICommandExternalEventsAdapter`).
  - `agent-ui-terminal` — forwards `externalEventVerifierFactory` from the render options to the session.
  - `agent-interface-transport` — `TExternalEventRefusal` gains `session-unavailable`.
  - `agent-command` — `/events` lists the session's grants (label, principal kind, state, counts) and
    `/events revoke <grant-id>` withdraws one. User-only.
  - `agent-cli` — a grant file (`grantId`, `issuer`, `resource` ending in `/events/<grantId>`, exactly one of
    `subject` or `client`, `scopes`, optional `algorithms` and `rate`) is validated before anything starts, with a
    reason that names the grant and no configured value. `__PRODUCT_CLI_NAME__ --external-event-grant <file>` (TUI) and
    `__PRODUCT_CLI_NAME__ session start --background --external-event-grant <file>` open every grant or fail the start; a
    background session receives its grants through a private file, opens them before it reports ready, and the
    launcher refuses a readiness that names other grants. `__PRODUCT_CLI_NAME__ session events list <id> [--json]` and
    `__PRODUCT_CLI_NAME__ session events revoke <id> <grant-id>` work over the generation-bound control socket, and
    `__PRODUCT_CLI_NAME__ session list --format json` shows each grant's counts. The retired `--external-event-allow` now points
    at `--external-event-grant`.

- bfe8ed5: An external event is admitted only by a bearer access token the session verifies itself, and its sender is the
  grant that token matched, never a name in the event.

  - `agent-interface-transport` — `IExternalEventGrant` (a label, an access-token verifier configuration that pins
    exactly one subject or client, the `message` kind, optional turn-rate windows), `IExternalEventDelivery` (the
    token and the event as a carrier received them), the closed `TExternalEventRefusal` set, `TExternalEventAdmission`
    and the content-free `TExternalEventAuditRecord`.
  - `agent-framework` (breaking) — `ExternalEventIngress.open` and `InteractiveSession.openExternalEventSource` take
    `{ grant, verifier, audit? }` instead of `{ id, allowedSenders, authenticate }`, and `receive` takes
    `{ token, event }`. A delivery is refused with a stable word when the token is missing or the verifier refuses
    it, when the token was already spent on an event (`jti`), when the event is malformed or oversize, or when the
    grant is over its rate; nothing refused reaches the queue. An admitted event is attributed
    `external:<grant>:<conversation>`, a payload display name appears in the envelope only as `claimed-name`, and the
    receipt (`TExternalEventReceipt`) answers at acceptance with the turn id. Every refusal and settlement is
    reported to the `audit` sink without content, conversation, name or token. `IAuthenticatedExternalEvent` and
    `IExternalEventReceipt` are removed.
  - `agent-cli` (breaking) — `--external-event-allow` is refused with the reason: a sender name relayed by an MCP
    server does not prove who sent an event.

- 4f49d14: The device mesh can be turned on, and `/peers`, `/handoff` and `/devices` reach the user's other devices.

  - New user setting `transports.mesh.enabled` (default `false`). When it is `true`, an interactive
    session opens the device mesh at startup and closes it on exit. Only the user settings count; a
    project's settings cannot turn it on. Print and serve runs never open it, and a device without an
    identity is told to run `/devices init`. Only one session of a device opens it at a time; another
    session on the same device says so in `/devices` and links nothing.
  - By default a linked device may send messages, files and sessions. Each file and each session still
    waits for the operator's yes on this machine's terminal; with no terminal the answer is no.
    Delegating, observing and driving stay off unless `transports.mesh.options.capabilities` lists
    them.
  - A message from a linked device arrives like one from a session on this host: a peer turn with no
    authority, attributed to the device the handshake proved, under the same rate limit and
    conversation limits.
  - `/peers` lists linked devices beside the sessions on this host; `/peers send` and
    `/peers send-file` take a device id. `/handoff` lists linked devices and pushes the session to one.
    Files arrive in the usual place aside, and sessions are saved without starting.
  - `/devices` shows whether the mesh is on, how this device finds the others, and which are linked.
  - The mesh uses the relay at `transports.webrtc.options.relayUrl` when one is set. Without one it
    finds devices on the local network and over the public ways in `transports.mesh.options`.
  - `/peers`, `/handoff` and `/devices` stay user-only. Their descriptions tell the model they cover
    linked devices.
  - `agent-framework`: the `/peers` port can list linked devices (`listDevices`, `ILinkedDeviceSummary`).
  - `agent-command`: the `/devices` port can report the mesh (`meshStatus`, `IDevicesMeshStatus`).

- 7b72344: Every client can offer the session's commands and skills and show its status. The GUI uses them as a
  desktop-style composer.

  - `agent-interface-session` is **`major` because `IInteractiveSession` gains required members**:
    `ISessionCommands.listSkills()` and a `statusRead` capability, `getStatusSnapshot()`. The snapshot
    holds session, model, permission mode, effort, context and goal. An external implementation stops
    compiling until it adds both.
  - `agent-transport` is **`major` for the same reason on `IProtocolSession`**. It also gains the wire
    messages `get-commands` → `commands` and `get-status` → `session_status`. Both are reads that the
    observe role may send.
  - `agent-interface-command` gains `ICommandSkillListEntry`, moved from `agent-framework`, which
    re-exports it unchanged.
  - `agent-ui-web` is **`major` because its state changes shape**:
    - A command's outcome and a finished turn's tool calls are now conversation entries: `messages` is
      `TConversationEntry[]`.
    - The `uiIntentNotices` list, `dismissUiIntentNotice`, `applyUiIntentEvent`,
      `removeUiIntentNotice` and `IUiIntentNotice` are removed. An intent now answers with an info
      line in the conversation.
    - Session notices keep only `session-error` and `protocol-error`.
    - The state gains `commandCatalog` and `sessionStatus`.
  - `agent-command` registers `/theme` and `/keybindings` even without a terminal. They then answer
    that they belong to the __PRODUCT_DISPLAY_NAME__ terminal, instead of being unknown.
  - `agent-framework`:
    - `InteractiveSession.getStatusSnapshot()`.
    - The main-thread row previews the last chat message instead of the last record's type.
  - `agent-cli` serves the full GUI web app, renamed from `agent-cli-web` to `agent-gui-web`, on
    `__PRODUCT_CLI_NAME__ --serve --open`.

- 9721162: A trusted workspace saves its sessions on macOS and other hosts without Linux's project-write guarantee.

  - **`agent-framework`:** `supportsWorkspaceProjectMutation(platform?)` tells a host in advance whether project writes can be proven to stay under the trusted root. The project writer uses the same answer, so the two cannot disagree.
  - **`agent-cli`:**
    - Where project writes cannot be proven safe, a trusted workspace keeps its sessions in the user session store (`$PRODUCT_USER_STATE_DIR/sessions`). They are listed for that workspace by their working directory, so `/resume`, the sessions sidebar, `--continue` and `__PRODUCT_CLI_NAME__ session list` find them. Nothing is written under the project root.
    - Before this, every save in a trusted git workspace on macOS was refused, and those surfaces listed nothing.
    - Linux keeps trusted sessions in the project, as before.
    - `__PRODUCT_CLI_NAME__ session list`, `__PRODUCT_CLI_NAME__ usage` and `__PRODUCT_CLI_NAME__ session analyze` report such sessions as user sessions, never as project sessions.

- 57f57f5: A daemon keeps several sessions live, and each client is bound to its own: one client's switch moves
  only that client.

  - `agent-interface-session`: `ISessionBinder`/`ISessionBinding`, the session-change refusal codes with
    `isSessionChangeRefusal`, and listing rows that may say `live` and `clients`.
  - `agent-framework`: `SessionPool` and `SessionChangeRefusal`.
  - `agent-transport` (**major**): a new server frame, `session_change_failed`, which an exhaustive
    consumer must handle. A refused `new-session` or `switch-session` now answers with it, carrying a
    `code`, instead of `protocol_error`; both requests take an optional `requestId` that it echoes.
  - `agent-transport-ws`: the `sessionBinder` option binds each connection to its own session and
    releases the binding when the connection closes.
  - `agent-cli`: `__PRODUCT_CLI_NAME__ --serve` and the daemon keep up to four sessions live. Each WebSocket client and
    attached terminal is bound to its own session; leaving a busy session is no longer refused, and only
    the last driver of a session with a pending prompt is kept from leaving it. Grants and the supervised
    name stay on the runtime's first session, and its reported activity covers every live session.
  - `agent-ui-web`: a refused new or switch shows the host's reason as a notice (an older host's
    `protocol_error` still does); the session sidebar marks live sessions and counts the other clients
    on each; after a reconnect to a host that keeps sessions live, the GUI returns to the session it was on.
  - `agent-ui-terminal`: an attached terminal shows why a switch was refused, and the picker's switch
    stays pending until the host answers; the session picker marks live sessions and their clients.

- ba822c1: An attached client reads a workspace entry's detail, stops a waiting self-paced loop, completes
  subcommands, and sees status changes another client made.

  - `agent-interface-session` (major): `IInteractiveSession` gains the required roles
    `ISessionExecutionDetail` and `ISessionSelfPacedLoopControl` (`TWaitingLoopStopOutcome`), and the
    exhaustively mapped event map gains `status_changed`.
  - `agent-transport` (major): `IProtocolSession` gains both roles; the wire unions gain
    `read-execution-detail`, `stop-waiting-loop`, `execution_detail`, `execution_detail_error` and
    `waiting_loop_stop`; `status_changed` is pushed as `session_status`; `isObserverMessageType` is
    exported from the root and `./client`.
  - `agent-interface-command` (minor): `ICommandListEntry` gains optional `argumentHint` and
    `subcommands` (`ICommandSubcommandEntry`).
  - `agent-cli` (minor):
    - `__PRODUCT_CLI_NAME__ session attach` and an attach from `__PRODUCT_CLI_NAME__ session view` open the full terminal UI,
      the one `__PRODUCT_CLI_NAME__ --attach` opens, in drive mode or, with `--observe`, read-only. The reduced
      attached view is gone.
    - A served runtime names each of its sessions after the session's first real turn.
  - `agent-framework` (minor):
    - `InteractiveSession` gains `stopWaitingSelfPacedLoop(reason?)`: it stops the one waiting loop,
      or stops none and names `/loop stop` when several wait. `SessionSlot` forwards it and
      `readExecutionWorkspaceDetail`.
    - The session emits `status_changed` when its mode, model, effort, goal or name changes, after a
      command, a turn, a rename or a goal or plan transition.
    - A new option `autoName: true` makes the session name itself once, after its first turn, with its
      current provider; it keeps a name it already has and lets a rename made meanwhile win. Off by
      default.
    - The command catalog carries each command's `argumentHint` and `subcommands`.
  - `agent-ui-terminal` (major):
    - The full terminal UI attached to a host's session reads a workspace entry's detail, sends input
      to a background task, stops a waiting self-paced loop on Esc, and completes subcommands.
    - `renderAttachedApp` takes `mode: 'drive' | 'observe'` (default `'drive'`) and `announce`. In
      observe mode the terminal sends only what an observer may send, refuses prompts, host commands,
      abort and loop stop with a read-only notice, still runs `/exit` and its own commands, and its
      status bar says it is observing. `ITuiChannelSnapshot` gains `readOnly`.
    - The in-process terminal no longer names sessions; it builds its session with `autoName: true`.
      `ITuiInteractionChannelOptions.onAutoNamed` is removed.

- 9721162: The command catalog says who runs a command, and which surfaces can run it.

  - **`agent-interface-command` (major).**
    - Adds `TCommandRunner` (`'runtime' | 'client'`) and `TCommandSurface` (`'terminal' | 'gui'`).
    - `ICommand` gains optional `runner` and `surfaces`.
    - `ICommandListEntry` gains optional `surfaces` and a **required** `runner`. An implementation of `listCommands()`, or any code that constructs an `ICommandListEntry`, must now emit `runner`; a command that declares none gets `'runtime'`.
  - **`agent-framework` (minor).**
    - `ISystemCommand` gains optional `runner` and `surfaces`, and the command listing carries both.
    - An undeclared runner resolves to `'runtime'`.
    - `SessionTerminalHandoffGate` is exported for a terminal client that hands its own terminal to a command.
  - **`agent-command` (minor).**
    - `/shell`, `/editor`, `/theme` and `/keybindings` declare `runner: 'client'` and `surfaces: ['terminal']`.
    - `createTerminalClientCommands()` builds the same four commands, from the same execute functions, for a terminal client to run itself. The set follows the preset's module selection.
  - **`agent-ui-web` (minor).** The `/` menu marks a command that runs in the terminal with a "terminal" badge.

- 6e6b06b: A wire client can now render the whole session the way the in-process terminal UI does: the full
  history, the context window as it changes, when the history changes, and where each turn came from.

  - `agent-interface-session` is **`major`**: `ISessionConversationRead` gains a required
    `getFullHistory()`. Any implementation of it, or of `IInteractiveSession`, must add it.
  - `agent-transport` is **`major`**:
    - It adds `get-history { fromIndex? }` → `history { startIndex, total, entries }`. The history
      crosses one bounded page at a time (at most 256 KiB of entries; a single larger entry is sent
      alone), from `fromIndex` (default 0), so no reply grows with the session. The client asks for
      the next page after the previous one arrived. Entries are `IWireHistoryEntry`: a history entry
      with an ISO 8601 `timestamp`. An observer may send it.
    - `complete` and `interrupted` carry the turn's result without the session's history
      (`TWireExecutionResult`); a client reads the history with `get-history`.
    - It adds `get-prompts`: the host sends the permission and ask prompts still open as the
      `permission_request` / `ask_request` frames that asked them, for a client that attached later.
      An observer may not send it.
    - `pending` gains an optional `pendingCount`: a host sends it when it knows how many prompts are
      queued, and a client that gets none counts the prompt it shows. The host sends `pending` in
      reply to a `submit` once it has taken the prompt, so a prompt queued behind a running turn shows
      as queued.
    - `command` takes an optional `requestId`, which the host echoes on the command's
      `command_result` or `protocol_error`.
    - The session's `context_update` is pushed as the `context` frame that `get-context` answers with.
    - `compact`, `skill_activation` and `memory_event` push the new `history_changed`; the client
      reads the history again.
    - `turn_source` is pushed as the new `turn_source` frame.
    - An exhaustive map over `TClientMessage` or `TServerMessage` types must add the new variants,
      and `IProtocolSession` now requires `getFullHistory()`.
  - `agent-transport-http` is **`major`** only because `IHttpTransportSession` includes the conversation
    read role, so a session handed to it must now provide `getFullHistory()`.
  - `agent-framework`: `SessionSlot` forwards `getFullHistory()` to the current session.
  - `agent-ui-web` receives the new frames and does not render them.

- caaab20: `/rewind` works again. Every session the CLI builds for a trusted workspace captures edit
  checkpoints; before, none did, and `/rewind` failed everywhere with "Edit checkpoints require
  project authority."

  - `agent-cli` (patch): a trusted workspace composes an edit checkpoint store for the terminal UI, a
    print run, a served runtime and each session a daemon keeps live. Every session gets its own
    store, pooled or switched to in the terminal UI, since two can run turns at the same time. On a host that cannot prove a project write
    stays inside the project (every platform but Linux), none is composed: a checkpoint could be
    neither saved nor restored there.
  - `agent-command` (patch): where a session has no checkpoints, `/rewind` says why: a restricted
    workspace is told to run `__PRODUCT_CLI_NAME__ trust --yes` and restart __PRODUCT_DISPLAY_NAME__, and a host that cannot write
    the project safely says so. `/rewind list` reports this as a failed command instead of throwing.
  - `agent-framework` (minor): a checkpoint operation on a session without a store throws
    `EditCheckpointsUnavailableError`, whose `reason` is `host-cannot-write-project`,
    `restricted-workspace` or `no-checkpoint-store`. It is a `WorkspaceAuthorityRequiredError`, as
    before, named `EditCheckpointsUnavailableError`. `HeadlessInteractionChannel` takes an
    `editCheckpointStore` option.
  - `agent-ui-terminal` (minor): `renderApp` takes `createEditCheckpointStore` in place of
    `editCheckpointStore`, and builds each session its own store, since a session switch can build the
    next session before the old one's turn ends. `TuiInteractionChannel` keeps `editCheckpointStore`:
    a channel runs one session.

- f01868f: `sandbox.autoAllowBashIfSandboxed` takes effect. The CLI confined shell commands in the OS sandbox,
  but no session learned about the sandbox, so a confined command still asked for approval in the
  terminal UI, a served runtime and MCP serve, and a print run with no one to approve it refused it.

  - `agent-cli` (patch): a served session, and each session a daemon keeps live, receives the sandbox
    the shell tools run under.
  - `agent-framework` (minor): `HeadlessInteractionChannel` takes a `sandboxClient` option and hands it
    to the session.
  - `agent-ui-terminal` (minor): `renderApp` and `TuiInteractionChannel` take a `sandboxClient` option
    and hand it to each session they build.

- e8779c9: A subagent consults the sandbox its shell tools run under, as its parent does. With
  `autoAllowBashIfSandboxed` on, a confined command the subagent's gate leaves to the mode now runs
  without a prompt. Before, a `context: fork` skill asked for approval, and a print run refused it.
  An Agent-tool subagent in `auto` mode sent a command allowed by a broad rule like `Bash(npm *)` to
  its classifier instead. A background policy's ceiling is still checked first: nothing outside it
  runs.

  - `agent-framework` (minor): `createSubagentSession` takes a `commandSandbox` option. The fork and the
    in-process runner derive it from the parent's sandbox, the instance their inherited tools run
    under. `sandboxApprovalFor` is exported.
  - `agent-subagent-runner` (minor): `ISubagentWorkerComposition` takes an optional `createSandbox`. The
    worker builds that sandbox once and hands the same instance to `createTools` and to the session.
  - `agent-cli` (patch): __PRODUCT_DISPLAY_NAME__'s worker composition builds the OS sandbox through `createSandbox`, so
    a child-process subagent approves what its parent approves.

### Patch Changes

- 3c81769: A supervised session accepts attach connections on its control socket.

  - A terminal of the same user sends `{"command":"attach","id","generation","mode":"drive"|"observe","protocol":1}`.
    The session compares the generation with its own. It refuses another generation, an unknown mode or
    protocol, or a fifth concurrent attach. Otherwise it answers `{"status":"attached","driverId":"attach:<n>"}`
    and carries the ordinary session protocol as newline-delimited JSON on the same connection.
  - The driver id is assigned by the session and a client-sent one is ignored. Turns submitted from an
    attached terminal are attributed to it and counted under the new `attach` usage surface.
  - `drive` sends prompts and answers the session's questions under the usual co-drive rules. `observe`
    is read-only and never counts as a surface that can answer, so an unattended session still denies
    its prompts at once.
  - Detaching or crashing ends only that connection: a turn in progress keeps running, a prompt no other
    surface can answer is denied, and the session returns to its unattached posture. A reader that falls
    1 MiB behind is disconnected, and an oversize frame closes only its own connection. Stopping the
    session ends attached connections with it.
  - Commands from an attached terminal carry the remote origin, so pairing, revoking and reading the
    pairing link stay refused. An attached terminal is never an operator approver; supervised sessions
    keep refusing mesh connections that need one.
  - A client may send its first frames in the same write as the handshake; only the handshake line
    itself is held to the control endpoint's line limit.
  - `agent-framework`: the surface a turn was submitted on now reaches its usage observation. It was
    dropped before, so remote-control turns were counted as `unknown`.
  - The terminal client (`__PRODUCT_CLI_NAME__ session attach`) and the view keys come separately.

- 997f2fb: A revoked or closed external-event grant checks the token before it answers, so only a caller holding a valid
  token for that grant learns it was revoked; anyone else gets exactly the refusal a live grant gives. The TUI keeps
  revoked grants open-and-revoked on each session it binds so their tokens are still checked. The per-grant counters
  now also count the refusals the HTTP endpoint decides itself (a missing token, an oversize body).
- e689c8e: Follow-ups to connection approval and `/handoff`.

  - `agent-transport-webrtc-web` — the browser remote client says `Waiting for the host to approve this connection…`
    (`awaiting-approval`) after pairing, and `Connected` only once the host's session answers. A host that closes the
    channel instead is shown as `refused` and is not retried, since a retry would only ask the operator again; a
    first connection lost before the host answered is `failed`. Reconnect attempts count until the host admits a
    connection, so a link that keeps dropping while approval is pending gives up instead of asking again and again.
  - `agent-core`, `agent-session`, `agent-framework` — a turn that did not come from the operator stores its
    `turnSource` (`peer`, `external`, `agent-wakeup`) beside `driverId` on the user message and in the display
    history (`IRunOptions.turnSource`), so a session handed off keeps where each turn came from.
  - `agent-cli` — a `/handoff` resent after a lost confirmation reports what stays behind as it is now, not as it was
    at the first attempt, and after refusing to resend a session that changed, the hand-off status shows that refusal
    instead of the earlier lost confirmation.

- 4241fc5: Device mesh follow-ups.

  - A device with no identity is pointed to `/devices add` on one of the user's devices and `/devices join`
    here, as well as to `/devices init`. The message says that `init` is for the first device only,
    because it creates a separate identity that can never link to the user's other devices. The `/devices`
    description and the `init` subcommand say the same.
  - An identity created mid-session (`/devices init`, or a successful `/devices join`) opens the mesh
    without a restart when `transports.mesh.enabled` is on.
  - If a session stalls for longer than the mesh lock's stale window (for example while the machine
    sleeps), another session can take the mesh over. The stalled session now notices this on its next
    lock refresh, closes its own mesh, and says why. Two sessions no longer run it together.
    `holdExclusiveFileLock` has a new `onLost` option for this.
  - `/peers` and `/handoff` still list and reach linked mesh devices when local same-host peer discovery
    fails. `/peers` says why sessions on this host are not listed. `ICommandLocalPeersAdapter` has a new
    optional `localDiscoveryOff` field for this.
  - `agent-transport-webrtc`: when lists become newer on a node (reissued, revoked, or adopted from a
    peer), the node sends them over every admitted connection instead of waiting for the next handshake.
    Reissues, revocations and enrolments in the CLI take effect this way at once. A receiver adopts a
    pushed list only if it is newer, issued by this user's signing key, and verifies. The push does not
    depend on the peer's capabilities, and it never reaches the application's message handlers.

- 7d77ce4: `/goal` turns no longer show the goal loop's instruction to the model as a user message. Each surface
  shows `Goal: <objective> (iteration n of max)`, and the session's auto-generated name comes from that
  line. The goal's `report_goal_status` and the self-paced loop's `report_loop_decision` are
  classified as inspections, so they neither ask for permission every turn in `default` mode nor get
  refused in `plan` mode, where a goal could never finish.
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
- 5a0ee96: Workspace trust no longer drops on its own. A grant was keyed by the repository config file and the
  volume's device number, so `git push -u`, a branch rename or delete, `git remote add`, or macOS
  renumbering a volume left a trusted workspace untrusted. Where the filesystem records a birth time
  (APFS, ext4, NTFS, …), the key is now the git directory's own inode and birth time, which hold through
  all of these while a repository recreated at the same path still does not inherit the grant; elsewhere
  the stricter config-based key stays. Granting or revoking also retires a trusted record left for the
  same worktree under an earlier key, so it no longer counts as a second trusted repository; it is
  marked revoked rather than deleted, so a repository that returns to that path never regains a
  generation an approval (such as a project MCP server's) was recorded against.

  Grants made before this change are keyed the old way: run `__PRODUCT_CLI_NAME__ trust --yes` once more in each
  workspace. A workspace revoked before shows as untrusted until it is trusted or revoked again.

- Updated dependencies [3c81769]
- Updated dependencies [724fabb]
- Updated dependencies [bfe8ed5]
- Updated dependencies [e689c8e]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [be0e53c]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
- Updated dependencies [0368058]
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.83
  - @robota-sdk/agent-interface-transport@3.0.0-beta.83
  - @robota-sdk/agent-core@3.0.0-beta.83
  - @robota-sdk/agent-session@3.0.0-beta.83
  - @robota-sdk/agent-interface-session@3.0.0-beta.83
  - @robota-sdk/agent-interface-command@3.0.0-beta.83
  - @robota-sdk/agent-executor@3.0.0-beta.83
  - @robota-sdk/agent-file-authority@3.0.0-beta.83
  - @robota-sdk/agent-interface-execution@3.0.0-beta.83
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.83
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.83
  - @robota-sdk/agent-tools@3.0.0-beta.83

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
    under `$PRODUCT_USER_STATE_DIR/peer-files/<sender>/`. It is never run and never placed in the model's context.
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
  - @robota-sdk/agent-session@3.0.0-beta.82
  - @robota-sdk/agent-executor@3.0.0-beta.82
  - @robota-sdk/agent-interface-command@3.0.0-beta.82
  - @robota-sdk/agent-interface-execution@3.0.0-beta.82
  - @robota-sdk/agent-interface-session@3.0.0-beta.82
  - @robota-sdk/agent-interface-transport@3.0.0-beta.82
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.82
  - @robota-sdk/agent-tools@3.0.0-beta.82
  - @robota-sdk/agent-file-authority@3.0.0-beta.82
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.82

## 3.0.0-beta.81

### Major Changes

- 9843fe6: Sign in to a remote MCP server from inside a session, and use its tools without restarting.

  - **`/mcp login <server> [--no-browser]`** runs the same per-server OAuth sign-in as
    `__PRODUCT_CLI_NAME__ mcp login` (discovery checks, PKCE, `state`, RFC 9207 `iss`, RFC 8707 resource, the
    loopback listener, the lock-guarded store). It opens the browser through the argv opener; with
    `--no-browser`, or when no browser can be opened, it shows the authorization URL and asks for the
    redirect URL in the session's own prompt (masked), held to the same rules as a pasted redirect in
    the terminal. A failed, refused, timed-out or cancelled sign-in changes nothing and is reported by
    a fixed reason only. `/mcp login <server> --client-secret` is refused: a secret is never typed into
    a session, and `__PRODUCT_CLI_NAME__ mcp login <server> --client-secret` is named instead (also after a failed
    token exchange for a pre-registered client). `/mcp` stays user-only (`modelInvocable: false`).
  - **Connected in the same session:** after a sign-in, a server that could not connect for want of
    one goes through the normal admission (approval, fingerprint, trust) and connects, and its tools
    are offered from the next message; a server that was already connected is admitted again and
    reconnects, and its authenticator drops what it held and reads the new credential. A tool left out
    because the session already has its name is reported, and only tools actually added get
    provenance. In browser mode the authorization URL is shown in the session prompt before the
    browser opens, where the user can also choose to paste the redirect instead or cancel.
  - **`runMCPOAuthLogin`** takes `readRedirectWhenBrowserFails`: when `openBrowser` rejects, the
    loopback listener stops and the pasted redirect is read instead, for the same redirect URI. The
    loopback listener's time limit now runs from its first `wait()` — once the authorization page is
    handed over — so time spent at a prompt before the browser opens does not count against it.
  - **`Session.addTools`** (and `ICommandSessionTools.addTools`) offers tools that became usable
    mid-session, through the same permission gate and — via `ISessionOptions.wrapAddedTools`, which
    `createSession` sets — the same edit-checkpoint and reversible-execution wraps as the assembled
    tools. A name the session already has is left out, never replaced. Calls are serialized, and tools
    added while a turn runs are applied when the next turn starts, so a turn's rounds all see one
    tool list and the prompt cache misses once, at that boundary.
  - **Breaking (`agent-framework`, major):** `addTools` is a new required member of the
    `ICommandSessionTools` role port (and so of `ICommandSessionRuntime`). A host that implements the
    port itself must add it; one that passes an `agent-session` `Session` already has it.
  - **`ICommandMCPActivationAdapter.oauthLogin`** (`ICommandMCPOAuthLoginRequest`,
    `ICommandMCPOAuthLoginResult`, `ICommandMCPOAuthRedirectPrompt`) is the port behind it.
  - The sign-in notice and `/mcp status` now suggest `/mcp login <server>` in a session and
    `__PRODUCT_CLI_NAME__ mcp login <server>` in a terminal; the server's name is shown only when it is safe to paste
    into any shell, otherwise `<server>`.

### Minor Changes

- 3038eb7: A message from another session is instant messaging: text from an untrusted third party that
  carries no authority. What the model does with it is decided by the session's ordinary permissions —
  rules, permission mode and remembered consent — exactly like the session's own work. The per-origin
  peer policy is gone.

  **BREAKING**

  - `agent-core`: `IPermissionEvaluationContext.peerTurn` is now a boolean. It decides only whether a
    `repliesToPeer` tool exists; every other call in a peer turn is decided as in any turn. Removed:
    `isToolAvailableInPeerTurn`, `isSecretPath`, `IPeerTurnAuthority`, `TPeerReach` (now exported by
    `agent-interface-session-mobility`) and `IToolPermissionProfile.workspacePaths`.
  - `agent-tools`: `Read` and `Glob` no longer declare `workspacePaths`.
  - `agent-session`: `ISessionRunOptions.peerReach` is replaced by `peerTurn?: boolean`, and
    `ISessionOptions.allowPeerChanges` is removed. An ask in a peer turn is answered like any other:
    a consent the operator remembered answers it, and an "always allow" given there is remembered.
  - `agent-interface-session`: `IPeerTurnContext` no longer has `reach`; it carries only the reply
    route.
  - `agent-interface-session-mobility`: `peerReachOf` is removed; `TPeerReach` moves here. A delegated
    turn carries no reach.
  - `agent-framework`: the `peers.allowChanges` setting is removed (an existing value is ignored). A
    peer turn is offered the ordinary tools, plus `peer_reply`.

  **Changes**

  - `agent-framework`: the per-turn statement tells the model the message is an opinion from an
    untrusted third party, not its owner's instruction, and that it decides for itself whether and how
    to act. A message still expands no `@path` and attaches no context reference, and its requests
    still carry no provider-hosted tool, since no permission step can decide one. The session takes
    at most 6 messages a minute and 30 an hour from each sender for a turn; a message over the limit
    is refused with a reason the sender receives. A prompt answer given in the name of a `peer:` or `external:`
    driver is ignored. External-event turns keep their tool-less baseline.
  - `agent-cli`: incoming peer turns carry only their reply route.

- 02b7452: A reply to a peer session is decided by the permission system like any call that sends something
  off this machine, and it goes only to the sender that was admitted.

  - `agent-core` — a tool declaring `repliesToPeer` is still refused outside a peer turn; inside one it
    is decided by the ordinary steps: deny, ask and allow rules, then the mode. It declares no risk
    class, so it asks by default, is refused in plan mode and proceeds under bypass. `IPeerTurnAuthority`
    no longer has `toolUsed`.
  - `agent-session` — an "always allow" answer to the reply is remembered and answers later replies,
    as for any tool; other asks in a peer turn still need a fresh approval each time.
  - `agent-framework` — `peer_reply` asks the operator by default, showing the full text and the peer
    it goes to; `permissions.allow`/`deny` rules naming `peer_reply` apply. `PeerMessageIngress`
    refuses a message whose origin names a sender other than the admitted one, or whose admission names
    no sender, and submits the turn with the admitted identity.
  - `agent-cli` — a local peer message is taken as coming from the session it names only when that
    session confirms, at its own socket, that it is sending exactly that message to this receiver.
    The reply target, the driver id and the operator's notices come from the confirmed sender. A
    session on an earlier version cannot confirm, so its messages are refused; both sessions need this
    version to message each other.

- ec5e477: Add a credential store port (`ICredentialStore` in `agent-core`) and keep the CLI's secrets behind it: the OS keychain through the optional `@napi-rs/keyring` binding (macOS Keychain, Windows Credential Manager, Linux Secret Service), else an owner-only file under `$PRODUCT_USER_STATE_DIR/credentials`. The backend is chosen at first use, recorded, and named by `/remote-control status`; a recorded keychain that stops working fails closed instead of degrading to the file.

  The remote-control host identity key moves into the store. The old `$PRODUCT_USER_STATE_DIR/remote-host-identity.json` may have been copied by backups or dotfile sync, so it is not carried over: on the first run after upgrading a new host key is generated, the old file is removed, and the operator is told once that trusted devices must pair again.

- 18b52cc: Built-in commands are offered to the model deliberately, each described for the model, and never
  with a trust, credential or permission-widening action.

  - `agent-interface-command` — `ICommand` gains `modelDescription?` (what the model is told, beside the
    short `/help` line), and `modelInvocable` on a subcommand entry now narrows what the model may run.
  - `agent-framework` — `ISystemCommand` gains `modelDescription?` and `modelRequiresPermission?`.
    Once any subcommand of a model-invocable command declares `modelInvocable`, the model may run only
    the bare command and the subcommands declared `true`; everything else, including an alias or an
    undeclared subcommand, is refused before the command runs. The model-facing descriptor lists only
    that subset. A model-requested monitor's command is now decided by the shell tool's gate (its
    Bash/Shell rules, the mode and the prompt) and a refusal rejects with the new
    `MonitorCommandRefusedError`. The `scriptedSession` test harness accepts `permissions` patterns.
  - `agent-session` — `Session.checkToolPermission(toolName, toolArgs)` decides an action that has a
    tool's effect by another route: that tool's PreToolUse hooks, then the gate's rules, mode,
    remembered consent and prompt — never the command sandbox's auto-approval, since the action does
    not run inside the sandbox.
  - `agent-framework` also: `ICommandMCPActivationAdapter.userActionSurface?` tells `/mcp` whether the
    user can type a session command, so the model's status names the terminal sign-in otherwise.
  - `agent-command` — `/context` (bare and `list`), `/cost` (the report, not `budget`) and `/mcp`
    (`status` only, without a prompt) are now model-invocable; `/memory approve` and `/memory reject`
    are now user-only; the model's `/monitor` is decided by the shell gate rather than by consent to
    the command's name. Every model-invocable command carries a model-facing description. The model's
    `/mcp status` shows only safe names, states and the command to suggest, and a caller that does not
    identify itself gets that view. `/context list` accounts only for turns still in context. New
    `mcpUserActionNotice`, `mcpUserActionCommand` and `mcpUnavailableServersNotice` build the fixed
    notices.
  - `agent-command-workflows` — `/workflows` carries a model-facing description.
  - `agent-mcp` — `createDiscoveredTool` accepts `authFailureNotice`: a call the server refuses for
    authentication returns that host text instead of the generic failure.
  - `agent-cli` — an MCP server that did not start because the user must approve it, trust the
    workspace or sign in is named to the model at the start of an interactive session with the
    command to suggest, and a
    signed-in OAuth server that refuses a call tells the model to suggest `/mcp login <server>` — or, in print and serve runs, the terminal
    `__PRODUCT_CLI_NAME__ mcp login <server>`.

  A command whose bare form is a complete action declares `runsBare`, so choosing `/cost` or `/mcp`
  from the autocomplete menu still runs it even though they now declare subcommands.

### Patch Changes

- 007fd90: Authority per connection: pairing stays with the local operator, and driving needs the operator's yes.

  - `agent-interface-session-mobility` — `ConnectionAuthority` decides what one connection may do.
    `presence` and `message` are allowed; `delegate` and `handoff` ask the receiving operator for every
    request; `observe` and `drive` ask once per connection. With no `IOperatorApprover` the answer is
    no. `authorizeDelegation` turns an approved task into a peer turn from where admission placed the
    peer, ignoring anything else on the request, so the receiver's policy decides what it may do.
  - `agent-transport-webrtc` — `connectionApproval` asks the operator before a connection reaches the
    session, after every proof has run. Frames the peer sends meanwhile are held (bounded) and delivered
    only after a yes. A channel that closes first withdraws the question (the approval context carries
    an `AbortSignal`), and a later answer admits nothing. A first-pairing device is pinned for
    reconnect only once it is admitted.
  - `agent-command` — `/remote-control enable` and `revoke` from a connected surface are refused, and
    `status` never shows a connected surface the pairing link.
  - `agent-framework` — the `remote-control-enable` host action runs only for the operator's own
    command, whichever command asked for it.
  - `agent-cli` — every remote-control connection, a returning trusted device included, is put to the
    operator on the host terminal; without an interactive terminal it is refused.

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
- Updated dependencies [b2e0afe]
- Updated dependencies [007fd90]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-tools@3.0.0-beta.81
  - @robota-sdk/agent-session@3.0.0-beta.81
  - @robota-sdk/agent-interface-session@3.0.0-beta.81
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.81
  - @robota-sdk/agent-interface-command@3.0.0-beta.81
  - @robota-sdk/agent-executor@3.0.0-beta.81
  - @robota-sdk/agent-interface-execution@3.0.0-beta.81
  - @robota-sdk/agent-interface-transport@3.0.0-beta.81
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.81
  - @robota-sdk/agent-file-authority@3.0.0-beta.81
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.81

## 3.0.0-beta.80

### Major Changes

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

- 818f0c8: `createSession` and `ICreateSessionResult` are no longer exported from the package root.

  **Migration — `createSession`.** Use `InteractiveSession`, or `createAgentRuntime().createSession(IHeadlessSessionOptions)`, or `createQuery()`. It was the low-level assembly seam, not the intended session entry point; the session-creation route is unchanged for consumers already using one of those three.

  **Migration — `ICreateSessionResult`: there is none, and that is stated rather than glossed.** The package's `exports` map exposes only `.` and `./testing`, so the assembly barrel that still declares the type is unreachable from outside the package. A released consumer importing this type has no replacement path and must stop referring to it. What it _named_ is largely still reachable — its `session` field is a `Session`, which `@robota-sdk/agent-session` exports and which `InteractiveSession.getSession()` returns — so the loss is the aggregate type itself, not the things it described. This is the break the `major` bump declares.

  **Impact on published consumers differs between the two symbols, and the earlier draft of this note got it wrong.** Resolved against the published `3.0.0-beta.79` `dist/node/index.d.ts` (466 exported names), not against the source barrel:

  - `createSession` is **absent** from the published surface. It was root-exported on 2026-08-16, after the 2026-07-06 release, so no released consumer can be calling it.
  - `ICreateSessionResult` **is published** — root-exported since 2026-06-14 and present at the release commit. Removing it is a genuine break to the published type surface, which is what the `major` bump declares.

  Neither fact is the reason for the removal. `.agents/project-structure.md` § Forward-Provisioned Surface Rule bans consumer-count reasoning about a public surface at any count. The reason is that the surface does not fit the design — `ICreateSessionOptions` is a 60-field internal projection target, and the 2026-03-26 SDK scope redesign already decided this factory is internal. The published-surface facts are recorded so a consumer can tell which removal can affect them, not to justify either.

  `ICreateSessionOptions` remains exported: four packages read indexed-access types off it as the option SSOT, and it is this package's own type.

  Closes issue #2270's export half. Its no-opt-out half stays open against issue #2238 — this change does **not** make the unconditional executor seeding safe, and the SPEC deliberately declines to reinstate that argument even though the un-export makes it literally true again.

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
  `PRODUCT_DISABLE_ADVISOR=1` turns it off completely. In-process subagents inherit the advisor, bound
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

- f336838: One permission evaluation order for every caller. The interactive session, background tasks and
  subagents used to run two different resolvers, so the same call could be decided differently
  depending on who made it. They now share `evaluatePermission`, and a background policy only adds a
  ceiling, an ask-everything flag and the task's own lists to it:

  deny → caller ceiling → unevaluable deny (ask) → never-auto-approve set (ask) → ask-everything →
  bypassPermissions → allow → mode.

  - **`ask` rules.** `permissions.ask` patterns always ask, in every mode including
    `bypassPermissions`. They are matched per command like a deny rule, and are validated at
    construction alongside `allow` and `deny`.
  - **Never auto-approved, bypass included:** removing a critical path with `rm`/`rmdir` (the root, a
    top-level directory, home, the working directory or a parent), and a modify-class write into
    `.git`, `.__PRODUCT_DISPLAY_NAME__`, `.claude`, `.agents`, `.mcp.json`, `.gitconfig`, `.npmrc` or a shell rc file.
    Files inside an isolated worktree (`$PRODUCT_PROJECT_STATE_DIR/worktrees/<name>/…`) are ordinary files. With no
    approver attached, an ask is a denial.
  - **A ceiling is checked before bypass and before any ask.** A subagent's `inherit-allowlist` ceiling
    is now the parent's _effective_ rules, read live at spawn: settings, preset lists and command
    auto-allows. It used to be the raw settings file. An unevaluable deny under a policy now asks,
    like everywhere else, where it used to deny outright; with no approver it is still a denial.
  - **Settings layers union `permissions.allow`**, as they already did `deny`. A checked-in project
    file no longer silently discards the user's allow list.
  - **Print mode, `createQuery()` and headless sessions default to `default` mode**, not
    `bypassPermissions`. They have no approver, so a call that would ask is denied. Pass
    `--permission-mode` / `permissionMode: 'bypassPermissions'` explicitly for unattended runs.

  **Breaking:**
  - `@robota-sdk/agent-core` removes `resolvePermissionByPolicy` and `TPermissionPolicyDecision` in
    favour of `projectPermissionPolicy` plus `evaluatePermission`'s new `context` argument.
  - `@robota-sdk/agent-framework` changes the settings merge rule for `permissions.allow`, and the
    default permission mode of `createQuery()` and headless sessions.

- 807d161: **BREAKING — ARCH-010: the execution root is a required contract field, and the containment guard now fails closed.**

  The file-tool containment guard was fail-open: with no root configured it answered "allowed". A tool
  built with no `cwd` therefore had no boundary — measured, a `Read` constructed that way returned the
  contents of `/etc/hostname` — and the child-process subagent worker called `createDefaultTools()` with
  no argument at all, so subagents got exactly that. Three independent auditors found three different
  symptoms of this one missing field.

  **Removed — seven context-free tool singletons.** `readTool`, `writeTool`, `editTool`, `globTool`,
  `grepTool`, `shellTool`, `bashTool` are gone from `@robota-sdk/agent-tools`. A module-level instance is
  bound at import time and can carry no containment root, so after the guard was inverted they could only
  refuse everything.

  Migrate to the factory of the same name, passing the directory the tool is allowed to work in:

  ```ts
  // before
  import { readTool, globTool } from '@robota-sdk/agent-tools';
  const tools = [readTool, globTool];

  // after
  import { createReadTool, createGlobTool } from '@robota-sdk/agent-tools';
  const cwd = process.cwd(); // or the workspace this agent is scoped to
  const tools = [createReadTool({ cwd }), createGlobTool({ cwd })];
  ```

  `webFetchTool`, `webSearchTool` and `askUserQuestionTool` are unchanged — they touch no filesystem, so
  there is no root to contain them by.

  **`cwd` is now REQUIRED** on `ISandboxToolOptions`, `IContainedBuiltinToolOptions` (and everything
  extending them), `ICreateDefaultToolsOptions`, `ISessionOptions` and `ISubagentOptions`. The `= {}`
  default parameter was removed from every builtin factory — that default was the mechanism by which
  "forgot the root" was legal. `new Session({...})` without `cwd` no longer compiles, and also throws at
  construction, because a required field is only required to a TypeScript caller.

  **`Session` no longer reads `process.cwd()`.** It uses the root it was given, and `getCwd()` exposes it
  so a fork or subagent asks the session instead of re-deriving a root that can disagree with it.

  **Behavioural change even for callers that already passed a root**: a tool that somehow reaches the
  guard with no root now REFUSES with an explicit error ("no containment root is configured … this is an
  assembly bug, not a path problem") instead of allowing the access.

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
- 2d3b2c0: Remove pass-through exports for agent-core environment-reference helpers and agent-session session-id
  guards. Import `formatEnvReference`, `hasUsableSecretReference`, `isEnvReference`, and
  `resolveEnvReference` from `@robota-sdk/agent-core`, and import `assertSafeSessionId` and
  `isSafeSessionId` from `@robota-sdk/agent-session`.
- 2d3b2c0: ARCH-024 replaces framework knowledge of command-owner ids with optional, owner-declared semantic
  roles. `ISystemCommand` can declare `skillActivation`, `contextReduction`, or `subagentSpawn`;
  `SystemCommandExecutor` exposes the selected role projection and rejects duplicate owners with the
  typed `DuplicateSystemCommandSemanticRoleError`, atomically across construction, registration, and
  replacement.

  This is a beta-line breaking contract correction: unannotated commands named `skills`, `compact`, or
  `agent` no longer receive special framework behavior. `@robota-sdk/agent-command` now declares the
  roles on its shipped skills, compact, and agent commands.

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

- fe48835: Honor skill model selection in forked child sessions. Skill metadata that specifies a model now requires `context: fork` instead of silently ignoring the model during ordinary execution. Startup errors for configured hooks without executors now identify their settings and enabled plugin sources.
- 1e40b5b: Move handoff source/destination orchestration and its contract from agent-framework to the session-mobility owner. Import `HandoffSource`, `HandoffDestination`, and their option types from `@robota-sdk/agent-interface-session-mobility`. Mobility now applies offer and authority decisions directly, while the CLI supplies wire effects and the session-record decoder. A successful offer no longer returns a mutable authority transaction.
- 8865acf: The framework now defaults to neutral model-facing identifiers: projected command tools use
  `command_` and attached file content uses `<file_references>`. This changes the default output of
  `MODEL_COMMAND_TOOL_PREFIX`, `createProviderSafeModelCommandToolName`,
  `createModelCommandToolProjection`, and `buildPromptWithFileReferences` for SDK consumers.

  To preserve the previous identifiers, pass `modelCommandToolPrefix: '__PRODUCT_MODEL_TOOL_PREFIX__'` and
  `promptFileReferenceTag: 'PRODUCT_file_references'` in session options, or pass those values to
  the projection and prompt-format helpers. The __PRODUCT_DISPLAY_NAME__ product profile supplies both values, so
  the __PRODUCT_DISPLAY_NAME__ CLI keeps its existing model tool names and prompt enclosure.

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

- 1f57e7f: **BREAKING — RUNTIME-006: align the exported concrete `InteractiveSession.submit` options with the
  transport-owned `IInteractiveSession` contract.**

  The concrete class no longer exposes framework-internal turn metadata through its fourth argument;
  public callers may pass only `ISubmitOptions` (`driverId`). New public and internal submissions
  always mint a fresh turn identity. An already accepted queued submission now resumes through a
  private required-identity path instead of re-entering public `submit`, so runtime extra properties
  cannot select or reuse another turn's identity.

  Queued entries, execution, and every settle/fail/refuse operation now require `turnId`. The former
  undefined no-op guards and the alternate settler lookup seam are removed, preserving the contract
  that every accepted handle settles for its own turn or typed refusal.

- db5c439: Framework query, runtime, interactive, and headless session creation now pass through one validated `SessionRecipe` constructor seam. Standard interactive options require provider and working directory; wrapping a host-owned session remains an explicit recipe mode, and test doubles use the package's `/testing` entry.
- 4a01a87: Use the shared strict frontmatter decoder for skill, command, bundle plugin, and agent discovery. Reject malformed authority metadata with source diagnostics, preserve plugin invocation restrictions, and reject invalid agent limits before registration.

  Remove the permissive public `parseFrontmatter` export as a breaking API change. Discovery sources now own validation; no compatibility parser is retained. The test-session harness accepts explicit project authority for trusted contribution fixtures.

- 242a644: Require versioned, event-decoded session replay logs. Reject unknown, malformed, and unsupported
  entries instead of dropping them or inventing message fields. Replay-only session loads and lists
  report damaged logs explicitly. Legacy unversioned JSONL is not accepted; snapshot encoding remains
  unchanged. Persisted logs now use schema version 1, and all replay entry points share the session-owned
  decoder and preserve sidecar integrity failures.

### Minor Changes

- d4189b9: The rest of the per-server MCP OAuth lifecycle: signing in to a server without a local browser,
  signing out of it with token revocation, and each server's sign-in state in `/mcp`.

  - **`__PRODUCT_CLI_NAME__ mcp login <name> --no-browser`** prints the authorization URL and reads the redirect URL
    the user pastes back (not echoed). `runMCPOAuthLogin` takes `readRedirect` for this; nothing
    listens on the redirect URI then. The pasted URL is held to the loopback listener's rules through
    `createPastedRedirectAcceptor`: it must be the registered redirect URI (same origin and path, no
    user info), carry the sign-in's `state` (compared in constant time), and is accepted once; an
    error redirect is `authorization-denied` without its `error_description`, and the RFC 9207 `iss`
    check applies as before. `openBrowser` now also receives the redirect URI. `readRedirect` gets a
    signal that aborts on cancel or at `callbackTimeoutMs` (5 minutes by default, as for the loopback
    listener); a paste longer than the prompt accepts fails as `redirect-too-long`.
  - **Signing out** (`runMCPOAuthLogout`; `__PRODUCT_CLI_NAME__ mcp logout <name>`; `/mcp logout <serverId>`):
    deletes the stored credential under the refresh lock, then revokes the refresh token and the
    access token (RFC 7009) when the stored issuer advertises `revocation_endpoint`. Revocation is a
    POST through the egress policy that never follows a redirect and is byte-bounded; it authenticates
    the client by `revocation_endpoint_auth_methods_supported` when advertised, otherwise the way its
    refresh does. The local delete always happens. Each token's outcome is reported in `tokens`, and
    overall as `revoked`, `partial`, `unsupported`, `failed` or `not-attempted`, with fixed reasons
    only (new: `revocation-failed`, and `token-type-not-revocable` for RFC 7009
    `unsupported_token_type`). `/mcp logout` also makes the session's authenticator drop the token it
    holds (`IMCPOAuthAuthenticator.forget`).
  - **Sign-in state:** `readMCPOAuthCredentialState` answers `signed-in`, `expired-refreshable`,
    `sign-in-required` or `signed-out` — never anything token-derived. `/mcp` shows it for every
    OAuth server; a server this session was told needs a sign-in reads `sign-in-required`.
    `ICommandMCPActivationAdapter` gains optional `oauthStatus` and `oauthLogout`
    (`ICommandMCPOAuthStatus`, `ICommandMCPOAuthLogoutResult`).
  - **No in-session sign-in:** signing in stays `__PRODUCT_CLI_NAME__ mcp login <server>` in a terminal, since it
    needs the terminal (browser, pasted redirect, hidden secret prompt) a running session owns. `/mcp`
    names that command for a server that needs a sign-in, as does the session's sign-in notice; the
    server name is shown there only when it is safe to paste into any shell — a plain token not
    starting with `-` or `=` — and is otherwise replaced by `<server>` (`shellArgumentForDisplay` in
    `agent-core`; nothing is quoted, since quoting rules differ between shells). Server names in OAuth
    notices have control and format characters escaped.
  - **Refresh hardening:** on `invalid_grant`, the store is read again under the lock; a refresh token
    another holder rotated in meanwhile is kept (and used when still valid) instead of being deleted.
    The expiry skew is capped at half the token's lifetime, so a short-lived token is not refreshed on
    every request; credentials now record `issuedAt` for this.

- 4078a72: Model fallback chain. `--fallback-model a,b` (or the `fallbackModel` settings array; the flag wins) names up to three models a turn moves to when its model is overloaded, unavailable or failing on the server. An entry is a provider profile, `profile:model`, a bare model on the primary's provider, or `default`. The move happens only before any output has streamed, lasts for the current turn, and is shown as a system note; entries that cannot be built are passed over and entries outside the organization's `allowedProviders` are dropped with a notice. `FallbackProvider` in agent-framework implements it over the session's provider; `IChatOptions` gains `executionId`, `onModelFallback` and `preserveContextWindow`, `IAIProvider` gains optional `resolveModelRoute`, and the execution loop emits a `provider_fallback` event and attributes requests, call observations, committed replies, the response cache and usage to the model that answered. A turn that ran on more than one model records per-model `modelShares` on its usage observation, which personal usage reports split by model and provider. A `/provider` switch keeps the chain, read again for the new primary.
- af2f2ad: `/cd <directory>` continues the conversation in another directory.

  - **A move is a new session in the target directory.** In the TUI, __PRODUCT_DISPLAY_NAME__ saves a copy of the
    conversation where the target's session store will find it, ends the current run through its
    normal end-of-life flow, and starts again in the target directory resuming that copy. The target's
    settings, trust decision, tools, skills and `AGENTS.md` apply, exactly as if __PRODUCT_DISPLAY_NAME__ had been
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

- 34e50f0: A new permission mode, `auto`, lets a model classifier approve or block what would otherwise prompt.

  - **What it decides:**
    - Reads and in-workspace edits run as in `acceptEdits`.
    - Commands and other calls the mode leaves open go to the classifier, a side call to the
      session's own model. It sees the call, the working directory and the git remotes, never the
      conversation.
    - A block reaches the model with its reason, so it can take another route.
  - **What still reaches a person, or is refused:**
    - Deny rules and background ceilings apply first.
    - `ask` rules, critical removals and protected paths ask a person.
    - After 3 refusals in a row (blocks, or no usable verdict), or 20 blocks in the session, the
      mode asks a person until one approves.
      With no one to ask, the call is denied.
  - **Allow rules:** in `auto` mode, allow rules that approve any command are set aside while the
    mode is on. Examples are `Bash(*)`, an interpreter (`Bash(python *)`), a package runner
    (`Bash(npm run *)`, `Bash(pnpm exec *)`), `Agent`, `ExecuteCommand` or `Computer`. Narrow
    rules still apply.
  - **Retry:** `/permissions` lists classifier blocks. `/permissions retry <n>` lets that exact call
    run once, unjudged, when the model tries it again.
  - **Turning it on and off:**
    - `--permission-mode auto`, `/mode auto` or `/permissions auto`.
    - An organization turns it off with `disableAutoMode` in the org policy.
  - **New contracts:**
    - `TPermissionMode` gains `'auto'`.
    - `allowRulesForAutoMode` and `isBroadExecutionAllowRule`.
    - `IPermissionClassifier` and `AutoModeGate`.
    - The `permissionClassifier` session option.
    - `Session.retryPermissionDenial`, and `retryDenial` on the permission-mode adapter.
    - The `'classifier'` denial reason.
    - `createModelPermissionClassifier`.
    - The `disableAutoMode` option on `createSession` and `IOrgPolicy`.

- 722e88a: Shell commands can run in an OS-level sandbox: bubblewrap on Linux and WSL2, Seatbelt on macOS.

  - **Confinement:** covers the command and every process it starts.
    - Writes are limited to the working directory, the temporary directories and
      `sandbox.filesystem.allowWrite`.
    - Agent, git-hook, MCP and shell configuration inside the workspace stays read-only.
    - `sandbox.filesystem.denyRead` hides paths from the command.
    - The network is on or off (`sandbox.network.enabled`).
  - **Modes:** `/sandbox` switches between `auto-allow`, `regular` and `off` for the next command and
    saves the choice.
    - In `auto-allow` (`sandbox.autoAllowBashIfSandboxed`), a confined command runs without a prompt
      in `default` and `acceptEdits`.
    - Deny rules, ask rules, critical removals and plan mode still apply first.
  - **Exclusions:** `sandbox.excludedCommands` run unconfined, through the ordinary permission path.
  - **When the sandbox cannot run:** a missing or unusable backend is reported at startup, in
    `__PRODUCT_CLI_NAME__ doctor` and in `/sandbox`, and commands then run unconfined.
    `sandbox.failIfUnavailable` refuses to start instead.
  - **New contracts:**
    - `OsSandboxClient`, `detectOsSandbox`, `bubblewrapArguments`, `seatbeltProfile`.
    - `ISandboxClient.wrapCommand` and `autoApproves`.
    - `IPermissionEvaluationContext.sandboxAutoApproved`.
    - The `commandSandbox` session option.
    - The `sandbox` settings key and the `sandbox` command host adapter.

- a5cc36e: `/permissions` shows the rules the session enforces and the calls it refused.

  - **Rules by source:** each allow, deny and ask rule the gate reads is listed under the settings file
    that declares it. Rules added by a CLI flag, a preset or a command are listed under "this session".
    A rule a settings file declares but the session does not enforce is not shown.
  - **Recent denials:** the latest refused calls, most recent first, with the reason: a rule or the
    mode, the user declining, or no one available to approve.
  - New contracts: `Session.getRecentPermissionDenials()`, `PermissionEnforcer.getRecentDenials()`,
    `IPermissionDenial`, the `permissionRules` host adapter (`createSettingsPermissionRulesAdapter`),
    and `getPermissionRules` / `listRecentDenials` on `ICommandPermissionModeAdapter`. Settings
    provenance now covers `permissions.ask`.

- b70fa3d: `__PRODUCT_CLI_NAME__ --safe-mode` starts a session with every customization off, to rule one out in one run.

  - **Off:** project and user instruction files, skills, custom commands, agent definitions, output
    styles, external presets, plugins, hooks from every settings layer, and MCP servers.
  - **Unchanged:** provider, model, built-in tools and permissions work as usual. Nothing on disk
    changes.
  - **Project access:** the project starts Restricted whatever its trust decision, so safe mode also
    runs in print and serve mode.
  - **Notice:** a line at startup says that safe mode is on.
  - **Embedders:** `startCli({ safeMode: true })` does the same as the flag.
  - **New framework option:** `skipConfiguredHooks` on interactive and headless sessions, also
    carried by the TUI and serve session options.

- 2711ec6: One broken skill or agent file no longer stops the session.

  Skill, command and agent definitions are shared with other hosts through `.claude`, and those hosts
  define fields of their own. The frontmatter decoder now validates only the fields __PRODUCT_DISPLAY_NAME__ owns and
  ignores the rest (nested `metadata` entries included); a malformed value of an owned field is still
  refused. A refused file is skipped with a single warning and still claims its name, so a
  lower-priority definition cannot stand in for it. An empty `argument-hint` reads as no hint. When
  initialization does fail, the session reports the cause to readiness probes instead of "not
  initialized", so the terminal shows the reason at once rather than a 15-second timeout.

  The terminal also stops printing type names for message-less telemetry records, keeps its own notices
  in place across a history sync so the following answer is not skipped, and CLI diagnostics print
  their context instead of `[object Object]`, through the console so Ink renders them above the frame.

- 4dd45cc: `/peers` shows how each other local session's workspace relates to this one's: `same worktree`,
  `same repo`, `different repo`, or `workspace unknown`.

  A session now publishes a workspace claim with its rendezvous entry — the root commits reachable
  from HEAD, a SHA-256 of its normalized `origin` URL (never the URL itself), and the real path of its
  worktree — and re-reads it as it runs, so a first commit or a checkout does not leave it stale. The
  reader does not take the claim as written: it reads git at the claimed path itself, and a claim whose
  contents disagree is shown as `workspace claim mismatched, not believed` and relates to nothing. Those
  git reads are local-only and asynchronous, run only for the view that shows the relation (and for
  the sender of an incoming peer message), and are cached per announcement. The relation also reaches
  the peer-turn origin, computed by the receiver; a relation the sender put on the wire is discarded,
  and the admission never carries it.

  The relation is display and routing information only and is never an authorization input.

  Additive: `agent-interface-session-mobility` exports `TWorkspaceRelation` and gains the optional
  `IPeerOrigin.workspaceRelation`; `agent-framework`'s `ILocalPeerSummary` gains the optional
  `workspaceRelation` and `workspaceClaim`, and `ICommandLocalPeersAdapter` the optional
  `listWithWorkspace()`.

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

- 2ebff01: Emit the complete persisted checkpoint and branch lifecycle, forward plan, context-refresh, and
  branch events through protocol transports, and render deterministic bounded notices in the TUI.
  Transport-owned delivery failures now enter the owning carrier cleanup lifecycle without reversing
  an already-committed session operation.
- b078afa: Forward the runtime-owned session store into headless sessions by default while preserving explicit
  per-session override and disable semantics.
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
- 4b76cfa: NEUT-005 (wave 2): restore an actionable context-capacity hint at the surface tier, neutrally. The zero-dependency `agent-core` layer emits a product-neutral hard-capacity notice and exposes the `IAgentConfig.contextCapacityHint` seam (wave 1). This wave wires that seam end-to-end without baking product vocabulary into a neutral library:

  - `agent-session`: `ISessionOptions.contextCapacityHint` is forwarded into the agent configuration factory, making the core seam reachable from the consuming layer.
  - `agent-framework`: new `deriveContextCapacityHint(commandModules)` derives the concrete remediation wording from the surface's OWN registered command set (names a registered `compact` command → `"Run /compact and retry."`; `undefined` when none, leaving the neutral core default). It is applied automatically in interactive session assembly across the TUI, print, and `--serve` surfaces.
  - `agent-cli`: the default command set registers `/compact`, so end users regain the actionable hint.
  - `agent-interface-transport`: reworded the `'allow-project'` permission comment so it no longer hardcodes a storage path (the location is owned by the consuming layer), matching the `agent-session` twin.

- d9bd9ec: Framework neutrality batch (NEUT-001/003/004/007): `planSelfHostingVerification` now requires injected
  command templates (repo-process literals evicted from the library); built-in agent set, subagent prompt
  suffix, and self-verification content are injectable; `claudeMd` renamed to `projectNotesMd` (breaking,
  beta line); `.agents/tasks` context injection is now opt-in via `taskContext` settings and the unused
  `updateTaskFileStatus` write API was removed; memory candidate-extractor trigger/vocabulary policy is
  constructor-injectable with the previous bilingual/dev set as the documented default; session-name
  sanitizer is Unicode-aware (non-Latin titles preserved).
- 90e7a10: The default background observer warning code and exported `OBSERVER_FAILURE_WARNING_CODE` value
  change from `PRODUCT_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
  the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
  their background manager or session options. The __PRODUCT_DISPLAY_NAME__ CLI supplies its existing code explicitly
  across print, goal, serve, MCP, and TUI sessions.
- fcb0da3: PAYLOAD-2153: make external-payload replay stable across Linux, macOS, and Windows.

  - Add the domain-free `@robota-sdk/agent-file-authority` leaf with bounded, root-relative reads over retained native handles and a typed, path-safe refusal taxonomy.
  - Route session replay and framework project reads through the shared authority while preserving their existing domain-specific budgets, integrity checks, and error mappings.
  - Expose the canonical safe session-id predicate through the framework facade so CLI exact-session lookup stays within the SDK package boundary.
  - Package the pinned native bridge in clean-installed Node CLI archives and exact-host standalone Bun binaries, refusing unsupported or mismatched targets before artifact mutation.

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
- fde558e: Forward organization policy through TUI, print, and goal sessions so blocked commands are enforced consistently. Preserve print/goal preset generation, language, prompt-seed, and structured-response options through the headless channel, and guard declared session-capability projections against silent field loss.
- cbee54e: Surface unmatched preset command-module names instead of silently dropping them (INFRA-032). A preset `enabledCommandModules`/`disabledCommandModules` entry that matches no built command module — a short form like `"editor"` instead of `agent-command-editor`, or a typo — is now reported as a non-fatal notice on both the startup `--preset` path (CLI terminal) and the in-session `/preset` path (command result). Detection lives once in agent-framework's new pure `findUnknownModuleNames`, and agent-command's duplicate module filter now delegates to the framework's `selectCommandModules`; `createDefaultCommandModules` returns `{ modules, unknownModuleNames }`.

### Patch Changes

- 5307f8a: Discriminate `IBackgroundTaskResult` by kind, the same way `TBackgroundTaskRequest` already is:
  `exitCode`/`signalCode` exist only on the `process` member and `usage` only on the `agent` member,
  instead of being optional-and-unreachable on every kind. `IBackgroundTaskResult<K>` narrows to the
  kind-specific member; called with no type argument it is still the full union, which is what
  `IBackgroundTaskState.result` continues to hold (that field stays undiscriminated — a later change).
  `ISubagentJobResult` is now derived as `Omit<IBackgroundTaskResult<'agent'>, 'kind'>` rather than a
  hand-maintained `Omit<IBackgroundTaskResult, 'kind' | 'exitCode' | 'signalCode'>`.

  `IBackgroundTaskHandle` gains the same kind parameter as `IBackgroundTaskStart`: a runner declared
  for kind `K` resolves its handle's `result` to `IBackgroundTaskResult<K>`, so a caller that starts a
  known-kind runner gets a correctly-narrowed result with no cast, and reading a cross-kind field on it
  is a compile error. Consumers reading `state.result` through the generic (kind-erased) manager or
  task-state path are unaffected in behavior, but a `.exitCode`/`.signalCode`/`.usage` read there must
  now narrow on the result's own `kind` first, since the fallback default keeps `IBackgroundTaskResult`
  as the full union rather than the previously flat, always-present shape.

  `agent-session`'s session-record decoder now rejects a persisted result carrying a field outside its
  own kind (e.g. an `'agent'` result with `exitCode`) as corrupt, reported at that field's own path —
  the same corruption-reporting style the taskId/kind identity check already uses.

  **Breaking for `@robota-sdk/agent-interface-execution` and `@robota-sdk/agent-executor`**: code that
  read `exitCode`/`signalCode`/`usage` off an unnarrowed `IBackgroundTaskResult`, or that implemented
  `IBackgroundTaskHandle`/a custom runner without specifying its kind parameter, needs to narrow on
  `result.kind` (or specify the kind parameter) before those fields are visible again.

- b462ee7: Discriminate `IBackgroundTaskState` by kind, the same way `TBackgroundTaskRequest` and (as of the
  prior change) `TBackgroundTaskResult` already are. Fields only one runner ever produces now live
  only on that kind's member instead of being optional-and-cross-kind-reachable on every kind:

  - `agent`-only: `agentType`, `isolation`, `resumeSessionId`, `promptPreview`, and the
    worktree-isolation fields (`worktreePath`, `branchName`, `worktreeStatus`, `worktreeNextAction`,
    `worktreeBaseRevision`, `parentWorktreeStatus`).
  - `scheduled`-only: `schedule`, `nextFireAt`.
  - Every kind except `agent`: `commandPreview` (a process command, an MCP tool-invocation summary, or
    a schedule's shell command / wake instruction).
  - `state.result` is now `IBackgroundTaskResult<K>` — correlated with `state.kind`, not the free
    full-result union.

  `pid`, `logPath`, and `transcriptPath` stay on the shared base rather than becoming agent- or
  process-exclusive: the runner handle SPI already reports them for whichever runner's process
  happens to produce them, and a subagent run via the worktree/child-process runner carries a `pid`
  exactly as a `process`-kind task does. `timeoutReason` also stays base — session restore sets
  `'stale_worker'` on any non-terminal, non-rearmable task regardless of kind, not only agent ones.

  `IBackgroundTaskState<K>` narrows to the kind-specific member; called with no type argument it is
  still the full union. The session-record decoder (`agent-session`) now rejects a persisted task
  state carrying a field outside its own kind as corrupt, reported at that field's own path, the same
  way it already rejects a `state.result` whose kind disagrees with `state.kind`.

  **Breaking for `@robota-sdk/agent-interface-execution` and `@robota-sdk/agent-executor`**: code that
  read a kind-specific field (e.g. `state.agentType`, `state.schedule`, `state.commandPreview`) off an
  unnarrowed `IBackgroundTaskState` needs to narrow on `state.kind` first, since the fallback default
  no longer carries every field on every kind. `agent-session`, `agent-framework`, and `agent-command`
  land the corresponding narrowing at every read site the type change touched; no runtime behavior
  changes there beyond the state decoder's new corruption checks.

- 08a9bd6: The CLI update-check cache is now written owner-only (`0600`) into an owner-only directory (`0700`), instead of inheriting the process umask.

  SEC-020 made every writer into the CLI's own store owner-only and scoped this one file out as "not a session record", which left it the only file the product created there at `0644` under a permissive umask. The store directory is the confidentiality boundary and the file modes are the layer beneath it — an exception in that layer is only invisible while the layer above it holds.

  The write now goes through `writeOwnerOnlyFile`, which creates the parent owner-only and sets the mode at creation rather than tightening afterwards, so the file never exists readable. A cache an older version left at `0644` is repaired at its next write.

  `getUserUpdateCheckCachePath`, `readUpdateCheckCache`, `writeUpdateCheckCache` and `IUpdateCheckCache` moved to an internal `update-check-cache` module. **They are exported from the package root under the same names, so no import changes.**

- 267af5f: The execution containment seam states where tools run.

  - **`ISandboxClient.filesystem`** (`'shared' | 'separate'`, absent means `separate`).
    - With a **separate** filesystem (E2B, in-memory), every file tool goes through the sandbox, and
      `Glob`/`Grep`, which can only read the host, are withheld. Previously a remote sandbox still
      offered host-reading search tools beside sandbox-writing edit tools.
    - With a **shared** filesystem (OS-level confinement over the host's files), file tools stay on
      the host under the path guard, and only commands go through the sandbox.
  - **`describeExecutionContainment` / `routesFilesThroughSandbox`** name the containment (`host`,
    `sandbox-shared`, `sandbox-separate`) instead of inferring it from an absent value.
  - **`__PRODUCT_CLI_NAME__ doctor` reports `execution.containment`.** __PRODUCT_DISPLAY_NAME__ composes no sandbox today, so the
    doctor says shell commands run unconfined on the host and the permission rules are the only
    boundary. The CLI composition and the doctor read the same value.
  - **The `Agent` and `BackgroundProcess` tools no longer fall back to `process.cwd()`** when they
    were built without an execution root. They report an assembly error instead, as the file tools
    already did (ARCH-010).

- baa6863: **ARCH-025: `SubagentManager.wait()` carries `usage`, and `IScheduleEditPatch` becomes nameable.**

  Two declared contract fields were unreachable by the projections meant to carry them.

  `wait()` returned `{ jobId, output, metadata }` and dropped `usage`, though `ISubagentJobResult.usage` is
  declared (ANALYTICS-001) and populated end to end. The field was born dropped: the commit that added
  `usage` to `toBackgroundResult` never touched `wait()` two hundred lines above. It now uses the same
  conditional spread, so the two directions of the hop read identically.

  This is a **contract repair, not a user-visible one** — worth stating because an earlier draft of this work
  claimed otherwise. `/cost` is fed by the `background_task_completed` event path and already worked;
  `wait()` feeds `IOrchestrationStepResult.usage`, which nothing currently reads. Forward-provisioned
  surfaces carry the same quality bar, which is why it is fixed rather than deferred.

  `IScheduleEditPatch` is the parameter type of the public `IBackgroundTaskManager.editScheduledTask` and
  `IBackgroundTaskHandle.editSchedule`, but it was on neither barrel, so a consumer of those methods could
  not name its own parameter type. It is now exported (**new export → minor**), and both structural
  re-declarations in `agent-framework` are gone — `IAgentJobHostContext.editSchedule`, the interface every
  command module programs against, and the class method implementing it.

  ```ts
  // before — the caller could not name the type it had to pass
  editSchedule(
    taskId: string,
    patch: { cronExpression?: string; agentInstruction?: string; command?: string },
  ): Promise<void>;

  // after
  import type { IScheduleEditPatch } from '@robota-sdk/agent-executor';
  editSchedule(taskId: string, patch: IScheduleEditPatch): Promise<void>;
  ```

  Not a surface change for `agent-framework`: TypeScript is structural, so every existing implementer and
  caller satisfies the named type unchanged.

  **Deliberately not in this change.** `providerProfile` is a dead contract field whose disposition belongs
  with the seam, and the seam itself — one field family declared three times and carried by hand-written
  literals nothing checks for totality — is filed as **ARCH-031** (issue #1747) after a `FOUNDATIONAL`
  finding-depth verdict. ARCH-031's derivation will subsume the `wait()` repair rather than undo it.

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- bed26ea: Fix: an in-flight autonomous `goal` is no longer lost on session resume. `fromSessionRecord` was a hand-enumerated field whitelist that omitted `goal` (while the write path persisted it), so the goal silently vanished on load. The read path is now a structural mirror of the write path (`{ ...session }`), so every persisted field — including `goal` — round-trips, and a future field cannot be dropped by omission (ARL-08 / DATA-006). `ISessionRecord` gains an opaque `goal?: unknown` for contract honesty.
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

- d0de5b2: A peer session's message now reaches the model as a peer's, and a peer turn runs on the external
  baseline.

  - `agent-core` marks every user message whose driver id starts with `peer:` as
    `<peer_message from="…">…</peer_message>` in the outgoing request — both the round and the forced
    summary — while the stored history keeps the text as sent. Wrapper-shaped text in user and tool
    messages is escaped, and an id that is not a plain identifier is printed as `peer:unverified`.
    New exports: `peerDriverOf`, `printablePeerDriver`.
  - `agent-session`'s conversation transcript (compaction, advisor) labels a peer message with the same
    printable id, so no rendering echoes a sender-chosen id that is not a plain identifier.
  - `agent-framework` runs a `peer` turn like an `external` one — no tools (`toolChoice: 'none'`), no
    `@path` expansion, no context references — and adds a per-turn system statement that the message
    came from another session and carries no authority. A `peer` turn must carry a `peer:` driver id.

- dd444c1: Bind interactive prompt, fork-skill, and foreground-command execution cleanup to an opaque
  controller-owned claim so stale cleanup cannot release another active operation or drain its queued
  input.
- 833afe1: Remove the remaining polynomial-ReDoS backtracking (SEC-003, CodeQL `js/polynomial-redos`) and stop the DTLS fingerprint binding to SDP free text.

  **`extractDtlsFingerprint` (agent-remote-pairing) — remote-reachable, pre-authentication.** Unlike the rest of this class, the SDP it parses arrives over the signaling relay, which the pairing design treats as untrusted, and it is parsed _before_ the channel-binding confirmation — on the browser peer, before `setRemoteDescription` too. Unanchored, `a=fingerprint:\S+\s+…` restarted from every offset in a non-space run: 5.0 s on a 400 KB SDP. It is now anchored to the start of an SDP line (`/^…/m`), which is linear and also stops the extractor from returning a value smuggled into another line's free text (`s=`, `i=`, an unrelated attribute) — text no DTLS stack reads, and which a relay controls. **Behaviour change:** a mid-line `a=fingerprint:` is no longer recognised. Every SDP a WebRTC stack emits puts the attribute at the start of its own line, so no real SDP is affected. A session-level line can still shadow a media-level one; that residual is recorded in the SEC-003 backlog.

  **Trailing-run trims (agent-framework, agent-cli, agent-tools).** `replace(/-+$/, '')`-shaped regexes have no start anchor, so the engine retried the run from every offset inside it and each retry rescanned to the end — 3.0 s at 100 K characters, ~50 s at 400 K. The memory topic sanitiser, the provider profile-name sanitiser, the model-command tool-name projection, the npm registry URL builder, the git-worktree path-segment sanitiser and the sandbox-root normaliser now use linear index scans (`trimEdgeChars` / `trimTrailingChars` in agent-framework, local helpers elsewhere), proven equivalent to the regexes they replace over every string of the relevant alphabet up to 12 characters.

  **Whitespace-ambiguity parsers (agent-framework).** The skill and agent-definition frontmatter list splitters used `/\s*,\s*/`, whose whitespace run overlapped nothing after it on a failed comma — 12.6 s on a 200 K run. They now split on `','`; the padding was already removed by the `.trim()` that follows, so the parsed lists are unchanged. The `.git` `gitdir:` pointer and the task-file open-item matcher used `\s*(.+)$` / `\s+(.+)$`, where `\s` and `.` both match a space; the capture is now pinned to start non-space, which accepts exactly the same inputs (verified exhaustively) and removes 14.5 s and 15.4 s worst cases.

  **`WebFetch` HTML-to-text (agent-tools) — carried no CodeQL alert.** Found by sweeping for the same shapes rather than the flagged lines, and the only quadratic here whose input is a live response body from an arbitrary URL. `<[^>]+>`, `<script[\s\S]*?</script>` and `<style…>` each restarted from every opener that had no terminator: 12.6 s on 200 KB of `<`, and the 5 MB the fetch allows would have taken hours. All three are now single-pass scans, verified character-for-character identical to the regexes over ~800 K generated inputs.

  Apart from the `extractDtlsFingerprint` anchoring noted above, no behaviour changes: every fix accepts the same inputs and produces the same values, and each ships an equivalence test pinning that.

- 7863b16: Create settings files owner-only (SEC-003, CodeQL `js/insecure-temporary-file`).

  `writeSettings` persists `provider.apiKey` verbatim when a profile is configured without
  `--api-key-env` — the CLI even warns that the key is "stored as plain text in settings" — but the
  file was created with the process umask (measured `0644`/`0664`), leaving that credential readable
  by every user on the host. It is now created `0600`.

  This is a permissions change only — file locations, names, formats, and APIs are unchanged. `mode`
  applies at creation, so a settings file that already exists keeps whatever mode it has; only newly
  created settings files are affected.

- 9814afc: Type-SSOT convergence (TYPE-003; re-audit CONTRACT-002/003/011/012 + RUNTIME-47 + STRUCT-04). Behavior is unchanged — this is a type-level refactor. `ITokenUsage` (agent-core) is confirmed as the usage-triple SSOT: `ISessionUsageTotals` and `IBackgroundTaskUsage` become aliases, and every inline `{ promptTokens; completionTokens; totalTokens }` copy (service/orchestration/executor/remote-client shapes) now references the SSOT (structurally identical → patch). The subagent-job contracts derive from the background-task SSOT — `TSubagentJobStatus = Exclude<TBackgroundTaskStatus, 'paused'>`, mode alias, and a `Pick`-projection `ISubagentJobState` — with a compile-enforced parity test so a drifting hand copy can no longer exist. `@robota-sdk/agent-session` is minor because the public `ISessionRecord` type is now the typed `IInteractiveSessionRecord` alias (previously a relaxed `unknown[]` mirror): runtime behavior of `SessionStore` is identical, but downstream code that assigned loose payloads to the record's fields may need explicit casts at its own trust boundary (the framework store facade's `as unknown as` cast bridge is deleted). agent-session's duplicate `@robota-sdk/agent-core` deps/devDeps declaration is also removed (STRUCT-04).
- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [37b4bd7]
- Updated dependencies [4eea54b]
- Updated dependencies [30e5e50]
- Updated dependencies [bb4696a]
- Updated dependencies [2345c0b]
- Updated dependencies [118fe0e]
- Updated dependencies [240777e]
- Updated dependencies [718bdf5]
- Updated dependencies [50d2c9f]
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
- Updated dependencies [4dd45cc]
- Updated dependencies [807d161]
- Updated dependencies [fec722f]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [9db63ee]
- Updated dependencies [b078afa]
- Updated dependencies [b078afa]
- Updated dependencies [2ebff01]
- Updated dependencies [2ebff01]
- Updated dependencies [9db63ee]
- Updated dependencies [2ebff01]
- Updated dependencies [baa6863]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [7b85767]
- Updated dependencies [0f98419]
- Updated dependencies [64ba748]
- Updated dependencies [9fbab1b]
- Updated dependencies [d312755]
- Updated dependencies [a009f5b]
- Updated dependencies [61db70f]
- Updated dependencies [db80aba]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [6085cad]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [bed26ea]
- Updated dependencies [1e40b5b]
- Updated dependencies [7669851]
- Updated dependencies [c6c56a6]
- Updated dependencies [4b76cfa]
- Updated dependencies [90e7a10]
- Updated dependencies [fcb0da3]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [ebd40a0]
- Updated dependencies [833afe1]
- Updated dependencies [d6b9404]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
- Updated dependencies [242a644]
  - @robota-sdk/agent-interface-execution@3.0.0-beta.80
  - @robota-sdk/agent-interface-command@3.0.0-beta.80
  - @robota-sdk/agent-executor@3.0.0-beta.80
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-session@3.0.0-beta.80
  - @robota-sdk/agent-interface-session@3.0.0-beta.80
  - @robota-sdk/agent-interface-transport@3.0.0-beta.80
  - @robota-sdk/agent-tools@3.0.0-beta.80
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.80
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.80
  - @robota-sdk/agent-tool-defaults@3.0.0-beta.80
  - @robota-sdk/agent-file-authority@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79
- @robota-sdk/agent-executor@3.0.0-beta.79
- @robota-sdk/agent-interface-transport@3.0.0-beta.79
- @robota-sdk/agent-session@3.0.0-beta.79
- @robota-sdk/agent-tools@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78
  - @robota-sdk/agent-executor@3.0.0-beta.78
  - @robota-sdk/agent-interface-transport@3.0.0-beta.78
  - @robota-sdk/agent-session@3.0.0-beta.78
  - @robota-sdk/agent-tools@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-executor@3.0.0-beta.77
  - @robota-sdk/agent-interface-transport@3.0.0-beta.77
  - @robota-sdk/agent-session@3.0.0-beta.77
  - @robota-sdk/agent-tools@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- c0a6287: Relocate session feature logic out of the CLI shell and the transport (DQ-AUDIT-004):

  - Extract session-log timing analysis into the new `@robota-sdk/agent-session-analytics` package (pure analysis over canonical session records — no duplicate types, no file I/O). `agent-cli`'s `session analyze` command shrinks to thin wiring and loads records via the new `createUserSessionStore()` / existing `createProjectSessionStore()` framework facades.
  - Move LLM-based session auto-naming (`generateSessionName`) from `agent-transport/tui` into `agent-framework` (session-lifecycle owner); the TUI transport now invokes it through the framework.

- 9df3a88: Split the consolidated `@robota-sdk/agent-transport` package into per-concern transport packages (DQ-AUDIT-005) so unrelated heavy dependencies (React/Ink, ws, Hono, MCP SDK) no longer share one publishable unit and are not dragged into non-TUI consumers' graphs:

  - `@robota-sdk/agent-transport` — lean core: headless adapter + `TransportRegistry` + scripted-provider testing fixtures (no external runtime deps).
  - `@robota-sdk/agent-transport-tui` — React + Ink terminal UI.
  - `@robota-sdk/agent-transport-ws` — WebSocket transport + protocol (`agent-web-ui` now depends only on this for WS types).
  - `@robota-sdk/agent-transport-http` — Hono HTTP transport.
  - `@robota-sdk/agent-transport-mcp` — MCP server transport.

  The default transport-registry wiring (pre-registering `WsTransport`) moves to the CLI composition root, removing the core→ws edge.

- 576af62: Fix `ConfigurationError: Agent must be fully initialized before changing model configuration` when running `/preset` (or any live model re-apply) on a fresh interactive session before the first message. The __PRODUCT_DISPLAY_NAME__ agent initialized lazily on the first `run()`, but `setModel` requires full initialization. `Session.applyModelOptions` now awaits the new idempotent `__PRODUCT_DISPLAY_NAME__.ensureReady()` before `setModel`, and the preset live-switch path (`applyPresetToSession` → `executePresetCommand`) is async end-to-end. Adds a real cold-session regression test (no mocked __PRODUCT_DISPLAY_NAME__).
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-session@3.0.0-beta.76
  - @robota-sdk/agent-executor@3.0.0-beta.76
  - @robota-sdk/agent-interface-transport@3.0.0-beta.76
  - @robota-sdk/agent-tools@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Agent preset system + live preset switching + context/history correctness fixes.

  - **Preset system (PRESET-001~017):** new `@robota-sdk/agent-preset` package layering framework
    assembly options into named, selectable profiles (`default`, `autonomous-builder`, `careful-reviewer`,
    `neutral-executor`) plus user-authored external presets loaded from `$PRODUCT_USER_STATE_DIR/presets/*.json`.
  - **Live preset switching:** `/preset` command (list + active marker + switch) and a TUI active-preset
    display. Switching live re-applies permission posture, model/effort, persona, command-module
    selection, parallel-subagents gating, and a self-verification system-prompt section via the single
    `applyPresetToSession` engine.
  - **CTX-001:** the TUI Context display + session auto-compact now use the accurate provider-based token
    estimate (system prompt + tool schemas included) instead of a crude history-only char heuristic.
  - **HIST-001:** conversation history is now append-only — removed the silent 100-message count cap that
    could drop early context; context size is managed solely by size-based compaction.

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.75
  - @robota-sdk/agent-session@3.0.0-beta.75
  - @robota-sdk/agent-executor@3.0.0-beta.75
  - @robota-sdk/agent-interface-transport@3.0.0-beta.75
  - @robota-sdk/agent-tools@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- Architecture conformance release: doc-vs-code audit (INFRA-002), conformance skill system + GATE-CONFORMANCE blocking scan (INFRA-003), canonical-doc drift cleanup (INFRA-004~~011, BEHAVIOR-004), and the interface-type SSOT extraction to `@robota-sdk/agent-interface-transport` with a mechanically-enforced interface-import rule across packages and apps (DATA-001, INFRA-012~~014). Harness process lessons baked into skills (INFRA-015).
  - @robota-sdk/agent-core@3.0.0-beta.74
  - @robota-sdk/agent-executor@3.0.0-beta.74
  - @robota-sdk/agent-interface-transport@3.0.0-beta.74
  - @robota-sdk/agent-session@3.0.0-beta.74
  - @robota-sdk/agent-tools@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73
- @robota-sdk/agent-executor@3.0.0-beta.73
- @robota-sdk/agent-interface-transport@3.0.0-beta.73
- @robota-sdk/agent-session@3.0.0-beta.73
- @robota-sdk/agent-tools@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- Emit context_update event after session restore so TUI status bar reflects correct context usage immediately on /resume.
  - @robota-sdk/agent-core@3.0.0-beta.72
  - @robota-sdk/agent-executor@3.0.0-beta.72
  - @robota-sdk/agent-interface-transport@3.0.0-beta.72
  - @robota-sdk/agent-session@3.0.0-beta.72
  - @robota-sdk/agent-tools@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71
  - @robota-sdk/agent-executor@3.0.0-beta.71
  - @robota-sdk/agent-interface-transport@3.0.0-beta.71
  - @robota-sdk/agent-session@3.0.0-beta.71
  - @robota-sdk/agent-tools@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- CLI UX fixes: /context list full LLM context breakdown (CLI-B10), logo resize fix (CLI-B03), token estimates in context list (CLI-B04)
  - @robota-sdk/agent-core@3.0.0-beta.70
  - @robota-sdk/agent-executor@3.0.0-beta.70
  - @robota-sdk/agent-interface-transport@3.0.0-beta.70
  - @robota-sdk/agent-session@3.0.0-beta.70
  - @robota-sdk/agent-tools@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- Fix /context list showing empty despite non-zero context percentage. System context files (AGENTS.md, CLAUDE.md) loaded at session startup now appear in the list with [system, active] label. Prompt execution no longer re-adds them as manual duplicates.
  - @robota-sdk/agent-core@3.0.0-beta.69
  - @robota-sdk/agent-executor@3.0.0-beta.69
  - @robota-sdk/agent-interface-transport@3.0.0-beta.69
  - @robota-sdk/agent-session@3.0.0-beta.69
  - @robota-sdk/agent-tools@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68
- @robota-sdk/agent-executor@3.0.0-beta.68
- @robota-sdk/agent-interface-transport@3.0.0-beta.68
- @robota-sdk/agent-session@3.0.0-beta.68
- @robota-sdk/agent-tools@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- CLIR: agent-cli layer separation, agent-framework interactive session improvements, subagent runner fix, TUI interface README
  - @robota-sdk/agent-core@3.0.0-beta.67
  - @robota-sdk/agent-executor@3.0.0-beta.67
  - @robota-sdk/agent-interface-transport@3.0.0-beta.67
  - @robota-sdk/agent-session@3.0.0-beta.67
  - @robota-sdk/agent-tools@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- refactor: CLI-001/002 — agent-cli layer separation and monorepo-wide readability lint rules
  - CLI-001: Extract startup phases into focused modules; enforce agent-cli layer separation
  - CLI-002: Apply import/order, consistent-type-imports, explicit-function-return-type, prefer-const, object-shorthand across all packages
  - Fix stale child-process-subagent-worker entry in agent-cli tsdown.config.ts (build fix)
  - @robota-sdk/agent-core@3.0.0-beta.66
  - @robota-sdk/agent-executor@3.0.0-beta.66
  - @robota-sdk/agent-interface-transport@3.0.0-beta.66
  - @robota-sdk/agent-session@3.0.0-beta.66
  - @robota-sdk/agent-tools@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65
- @robota-sdk/agent-executor@3.0.0-beta.65
- @robota-sdk/agent-interface-transport@3.0.0-beta.65
- @robota-sdk/agent-session@3.0.0-beta.65
- @robota-sdk/agent-tools@3.0.0-beta.65

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

- @robota-sdk/agent-core@3.0.0-beta.64
- @robota-sdk/agent-executor@3.0.0-beta.64
- @robota-sdk/agent-interface-transport@3.0.0-beta.64
- @robota-sdk/agent-session@3.0.0-beta.64
- @robota-sdk/agent-tools@3.0.0-beta.64

## 3.0.0-beta.63

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.63
- @robota-sdk/agent-session@3.0.0-beta.63
- @robota-sdk/agent-tools@3.0.0-beta.63
- @robota-sdk/agent-interface-transport@3.0.0-beta.63
- @robota-sdk/agent-executor@3.0.0-beta.63

## 3.0.0-beta.62

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.62
  - @robota-sdk/agent-executor@3.0.0-beta.62
  - @robota-sdk/agent-session@3.0.0-beta.62
  - @robota-sdk/agent-tools@3.0.0-beta.62

## 3.0.0-beta.61

### Minor Changes

- e243fb0: Add provider-neutral sandbox execution ports, E2B-compatible sandbox adapter, and SDK sandbox injection for Bash and core file tools.
- 18fcc5b: Add provider-neutral sandbox snapshot hydration for interactive sessions. Snapshot-capable sandbox clients now persist `sandboxSnapshotId` on shutdown and restore it before saved message replay on non-fork resume, while the E2B structural adapter supports both `createSnapshot()`-style checkpoints and pause/resume sandbox references.
- 3bde012: Add provider-neutral sandbox workspace manifests and wire `InteractiveSession` to apply them before session creation.

### Patch Changes

- 36eb7a9: Add provider-owned native replay payload hooks, replay validation coverage, and a session log validation command.
- cc0223d: Add SDK-owned provider profile name suggestions, create model-derived profile keys during interactive setup, and show the active provider profile identity in the CLI status area.
- d97bdf2: Add provider-owned model catalog metadata, route `/model` suggestions through the active provider, and make `cli:dev` resolve the CLI workspace dependency closure through source export conditions.
- Updated dependencies [e243fb0]
- Updated dependencies [1c0d44c]
- Updated dependencies [36eb7a9]
- Updated dependencies [18fcc5b]
- Updated dependencies [d97bdf2]
- Updated dependencies [3bde012]
  - @robota-sdk/agent-tools@3.0.0-beta.61
  - @robota-sdk/agent-core@3.0.0-beta.61
  - @robota-sdk/agent-session@3.0.0-beta.61
  - @robota-sdk/agent-executor@3.0.0-beta.61

## 3.0.0-beta.60

### Minor Changes

- 7439391: Add provider-neutral native web search/fetch capability contracts, explicit unsupported handling for OpenAI-compatible/LM Studio profiles, and local WebFetch/WebSearch permission/documentation alignment.

### Patch Changes

- 41ae788: Restore the CLI thinking indicator and add structured Agent tool batch provenance/count metadata.
- Updated dependencies [7439391]
  - @robota-sdk/agent-core@3.0.0-beta.60
  - @robota-sdk/agent-session@3.0.0-beta.60
  - @robota-sdk/agent-executor@3.0.0-beta.60
  - @robota-sdk/agent-tools@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- Updated dependencies [95721ff]
  - @robota-sdk/agent-tools@3.0.0-beta.59
  - @robota-sdk/agent-core@3.0.0-beta.59
  - @robota-sdk/agent-session@3.0.0-beta.59
  - @robota-sdk/agent-executor@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Refresh package docs and __PRODUCT_DISPLAY_NAME__.io content for the beta 57 feature set.
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.58
  - @robota-sdk/agent-executor@3.0.0-beta.58
  - @robota-sdk/agent-session@3.0.0-beta.58
  - @robota-sdk/agent-tools@3.0.0-beta.58

## 3.0.0-beta.57

### Minor Changes

- b80e51e: Add SDK-owned automatic project memory capture, approval review, bounded retrieval, and session-log provenance.
- 1cfdce9: Add SDK-owned edit checkpointing for Write/Edit tool mutations with `/rewind` list and code restore commands.
- f61e2cb: Add Qwen provider-owned Responses API support for built-in web search/fetch tools and pass provider-owned profile options through generic CLI/runtime configuration.
- 822a78b: Add self-hosting verification planning and atomic UTF-8 writes for built-in file mutation tools.
- 9817f99: Add active task context loading, formatting, and status update helpers for `.agents/tasks/*.md`.

### Patch Changes

- 16c3b6f: Persist and render provider-neutral per-turn usage summaries with pre-send context updates in CLI sessions.
- 4eca470: Render command tool output as bounded transcript previews and persist tool result metadata in SDK tool summaries.
- 90a2802: Render Edit tool summaries as context-aware diff hunks with structured truncation metadata.
- 26a1718: Preserve and render Edit tool diff metadata in persisted CLI tool summaries.
- e504d30: Route project memory through the model-visible `/memory` command descriptor instead of hidden automatic prompt injection.
- 0e0e533: Remove obsolete automatic memory policy configuration and top-level automatic memory orchestration exports from the SDK public surface.
- Updated dependencies [16c3b6f]
- Updated dependencies [b80e51e]
- Updated dependencies [26a1718]
- Updated dependencies [f61e2cb]
- Updated dependencies [822a78b]
  - @robota-sdk/agent-core@3.0.0-beta.57
  - @robota-sdk/agent-session@3.0.0-beta.57
  - @robota-sdk/agent-executor@3.0.0-beta.57
  - @robota-sdk/agent-tools@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.56
  - @robota-sdk/agent-executor@3.0.0-beta.56
  - @robota-sdk/agent-session@3.0.0-beta.56
  - @robota-sdk/agent-tools@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/agent-core@3.0.0-beta.55
  - @robota-sdk/agent-session@3.0.0-beta.55
  - @robota-sdk/agent-tools@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- fix: resolve all typecheck errors across packages
- Updated dependencies
  - @robota-sdk/agent-session@3.0.0-beta.54
  - @robota-sdk/agent-core@3.0.0-beta.54
  - @robota-sdk/agent-tools@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- refactor: monolith decomposition — all agent-\* files under 300 lines
- fix: PR #69 code review — session resume tool messages, type SSOT, fork isolation, settings crash, Notification removal, chat validation
- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.53
  - @robota-sdk/agent-session@3.0.0-beta.53
  - @robota-sdk/agent-tools@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.52
- @robota-sdk/agent-session@3.0.0-beta.52
- @robota-sdk/agent-tools@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.51
- @robota-sdk/agent-session@3.0.0-beta.51
- @robota-sdk/agent-tools@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- fix: reinsert repository/homepage/bugs in correct field order
- Updated dependencies
  - @robota-sdk/agent-tools@3.0.0-beta.50
  - @robota-sdk/agent-core@3.0.0-beta.50
  - @robota-sdk/agent-session@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- fix: add repository, homepage, bugs metadata to all publishable packages
- Updated dependencies
  - @robota-sdk/agent-tools@3.0.0-beta.49
  - @robota-sdk/agent-core@3.0.0-beta.49
  - @robota-sdk/agent-session@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- fix: record individual tool-start/tool-end in history + fix streaming tool display
  - Individual tool-start/tool-end events recorded as IHistoryEntry for persistence
  - TuiStateManager.onToolEnd uses findIndex (first match only, not all with same name)
  - MessageList hides tool-start/tool-end entries (not rendered as System:)
  - @robota-sdk/agent-core@3.0.0-beta.48
  - @robota-sdk/agent-session@3.0.0-beta.48
  - @robota-sdk/agent-tools@3.0.0-beta.48

## 3.0.0-beta.47

### Minor Changes

- feat: ITransportAdapter unified interface + headless transport + CLI adapter pattern
  - ITransportAdapter interface in agent-sdk (name, attach, start, stop)
  - InteractiveSession.attachTransport(transport) method
  - createHttpTransport, createWsTransport, createMcpTransport, createHeadlessTransport factories
  - CLI print mode uses adapter pattern: session.attachTransport(transport)
  - agent-transport-headless: text/json/stream-json output, stdin pipe, exit codes
  - --output-format, --system-prompt, --append-system-prompt CLI flags

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.47
- @robota-sdk/agent-session@3.0.0-beta.47
- @robota-sdk/agent-tools@3.0.0-beta.47

## 3.0.0-beta.46

### Minor Changes

- feat: session continue/resume — persist, restore, and switch sessions
  - ISessionRecord.history field (required) for UI timeline restoration
  - Session.injectMessage() for AI context restoration on resume
  - InteractiveSession: sessionStore, resumeSessionId, forkSession, getName/setName
  - CLI: --continue, --resume, --fork-session, --name flags
  - TUI: /resume (session picker), /rename (session naming)
  - ListPicker generic component with viewport scrolling
  - Session name display: input border title, terminal title, StatusBar
  - Session picker: cwd filtering, date+time, response preview
  - React key remount for instant session switching

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-session@3.0.0-beta.46
  - @robota-sdk/agent-core@3.0.0-beta.46
  - @robota-sdk/agent-tools@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- refactor: transports consume InteractiveSession only — commandExecutor param removed
  - Add InteractiveSession.listCommands() for transport tool discovery
  - All transports use session.executeCommand() instead of separate commandExecutor
  - Simplified factory signatures: only InteractiveSession required
  - @robota-sdk/agent-core@3.0.0-beta.45
  - @robota-sdk/agent-session@3.0.0-beta.45
  - @robota-sdk/agent-tools@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- feat: IHistoryEntry universal history architecture + test quality cleanup
  - IHistoryEntry as universal history type across all 4 packages (core → sessions → sdk → cli)
  - Tool summary stored as event entry in history (category: 'event', type: 'tool-summary')
  - TuiStateManager pure TypeScript class for CLI rendering state
  - MessageList renders IHistoryEntry[] with Tool:/System:/You:/__PRODUCT_DISPLAY_NAME__: labels
  - Display order fixed: Tool → __PRODUCT_DISPLAY_NAME__ (both streaming and abort)
  - Remove 25 tautological, duplicate, and hardcoded tests

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.44
  - @robota-sdk/agent-session@3.0.0-beta.44
  - @robota-sdk/agent-tools@3.0.0-beta.44
