# @robota-sdk/agent-interface-session

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.104
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.104
  - @robota-sdk/agent-interface-command@3.0.0-beta.104
  - @robota-sdk/agent-interface-execution@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

- Updated dependencies [6f41c53]
  - @robota-sdk/agent-core@3.0.0-beta.103
  - @robota-sdk/agent-interface-command@3.0.0-beta.103
  - @robota-sdk/agent-interface-execution@3.0.0-beta.103
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.102
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.102
  - @robota-sdk/agent-interface-command@3.0.0-beta.102
  - @robota-sdk/agent-interface-execution@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

- Updated dependencies [62663ae]
  - @robota-sdk/agent-core@3.0.0-beta.101
  - @robota-sdk/agent-interface-command@3.0.0-beta.101
  - @robota-sdk/agent-interface-execution@3.0.0-beta.101
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.100
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.100
  - @robota-sdk/agent-interface-command@3.0.0-beta.100
  - @robota-sdk/agent-interface-execution@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.99
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.99
  - @robota-sdk/agent-interface-command@3.0.0-beta.99
  - @robota-sdk/agent-interface-execution@3.0.0-beta.99

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.98
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.98
  - @robota-sdk/agent-interface-command@3.0.0-beta.98
  - @robota-sdk/agent-interface-execution@3.0.0-beta.98

## 3.0.0-beta.97
### Patch Changes

- 7911a7d: Preserve pending execution discovery and input admission in atomic Session conversation snapshots.
  Strict synchronous checkpoints now gate waiting, settlement and abandonment acknowledgment; failed saves
  require checkpoint repair without repeating execution. Restore before framework queue and autonomous
  input admission, and refuse unresolved conversation copies. Read v1/v2 session envelopes and write v2;
  older readers preserve v2 as unsupported, so coordinate reader versions when rolling back.
- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [23a30cd]
  - @robota-sdk/agent-core@3.0.0-beta.97
  - @robota-sdk/agent-interface-command@3.0.0-beta.97
  - @robota-sdk/agent-interface-execution@3.0.0-beta.97
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.96
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.96
  - @robota-sdk/agent-interface-command@3.0.0-beta.96
  - @robota-sdk/agent-interface-execution@3.0.0-beta.96

## 3.0.0-beta.95
### Major Changes

- 04a6de4: **Reasoning text a provider streams now reaches the editor as an ACP `agent_thought_chunk`, through a new `thinking_delta` session event.**

  `IChatOptions.onThinkingDelta`, `IRunOptions.onThinkingDelta` and `IResumeExecutionOptions.onThinkingDelta`
  (typed `TThinkingDeltaCallback`) carry reasoning text from a provider through the run, and the session
  options (`ISessionOptions.onThinkingDelta`, `ICreateSessionOptions.onThinkingDelta`) hand it to the
  session's owner. `InteractiveSession` emits it as `thinking_delta(delta)`, beside `text_delta`. The
  text is never part of the reply: it is not appended to the conversation, not streamed through
  `onTextDelta`, and the core adds no record of its own for it (no text-delta log entry, no
  `provider_stream_raw_delta`); a provider's own native payload capture and response metadata keep
  what the provider sent, as before. A reasoning delta counts as provider activity for the idle
  timeout whether or not anyone listens to it, so a model that is only thinking is not cut off. The
  existing `thinking(isThinking)` event is unchanged and remains the busy indicator. Where a provider
  sends no reasoning text, nothing is emitted and nothing new is switched on.

  `@robota-sdk/agent-interface-session` is a major change because a new session event name makes an
  exhaustive map over the event names stop compiling until it classifies the event.

  `@robota-sdk/agent-transport-acp` sends each non-empty `thinking_delta` to the editor as an
  `agent_thought_chunk`, in order with the message chunks, so `robota acp` shows the model's reasoning
  in the editor. A turn that streamed only thoughts still shows its result text, because only reply
  text marks a turn as streamed. The WebSocket wire, the HTTP stream, headless stream-json, `query()`
  and the terminal UI do not carry the new event in this change (`@robota-sdk/agent-transport` and
  `@robota-sdk/agent-ui-terminal` classify it as non-surface). A forked skill and an in-process subagent
  pass their reply text up but not their reasoning.

  Two providers already receive reasoning text and now report it. `@robota-sdk/agent-provider-openai`
  passes `response.reasoning_summary_text.delta` events of a streamed Responses call to
  `onThinkingDelta`; the API sends them only when the provider profile asks for a reasoning summary, and
  no request option changed; a summary streamed in several parts, and the summary of a later reasoning
  item, each start on a new paragraph (`\n\n`) so the parts do not run together.
  `@robota-sdk/agent-provider-openai-compatible` reports the text of Gemma's thought channel, which the
  provider already removed from the reply, as it streams across chunk boundaries, with each later
  channel of one reply on a new paragraph; the reply text is unchanged. No other provider reports
  reasoning, and Anthropic thinking is not enabled. A model fallback chain still moves to the next model when only reasoning had streamed.

  The scripted test provider (`@robota-sdk/agent-core/testing`) accepts an optional `thinking` string on
  a turn and delivers it through `onThinkingDelta` before the turn's text; the scripted session harness
  collects `thinking_delta` and now keeps a scripted tool-call turn's `usage`, which it used to drop.
- 0ba247b: A tool result can now carry a view its source declared (an MCP app), and a surface can invoke a
  runtime tool through the session's permission gate with a prompt. This is the contract and wiring
  layer: nothing produces a view yet, and the GUI does not yet host one.

  - `agent-core` — `IToolResult.view` carries an `IToolAppView` (source, `ui://` resource, mime type,
    HTML, structured content, callable tools, the call's input). `view` is now a typed key of
    `IToolResult`, so an extension that already used a `view` key with another type must rename it.
    The view is display data: it never enters model context or the size that decides a spill, and a
    result replaced by its reference keeps it.
  - `agent-interface-session` — `invokeRuntimeTool` takes `permissionInteraction` (`'interactive'` or
    the default `'deny'`), a `driverId` (a host that attributes prompts names it as the requester) and
    an `executionId` its events carry. A finished model call's `tool_end` names its view with
    `IToolState.appView` (`viewId`, source, resource), and the new
    `ISessionToolAppViews.readToolAppView(viewId)` reads the document. A permission handler may take
    `{ signal }`, and aborting it withdraws the prompt.
  - `agent-session` — a direct call asks a person only when its caller says so, and the handler is
    given the call's own signal; the tool end event carries the view, never in the logged result data.
  - `agent-framework` — the view of a model's call is kept under a `viewId` the session mints, in a
    bounded per-session store (16 views, 4 MiB each, 16 MiB in all, measured on the whole serialized
    view), and read on demand, so the document never rides `tool_end` to every surface, never enters
    the recorded history, and a repeated provider tool-call id cannot overwrite another turn's view.
    A malformed view is dropped. A direct call keeps and names no view, recognised by the id it was
    started with. A submission or agent wakeup that arrives while a direct call holds the session is
    queued behind it, as during a turn, instead of refused. A direct call acting for a driver
    attributes its permission prompt and tool events to that driver, and aborting its signal withdraws
    an open prompt from every surface.
  - `agent-transport` — a driving connection sends `call-app-tool` (answered by `app_tool_result`) and
    `read-app-view` (answered by `app_view`). A call names its view and reaches only the tools that
    view's source declared; a call or read that decodes but cannot be served answers `protocol_error`
    echoing the `requestId`, while an observer's attempt is refused like any non-read. A call still
    waiting on its prompt is cancelled when its connection goes away (for the resume bridge, when the
    bridge is disposed). `maxFrameBytes` bounds an app answer to what a carrier's channel carries;
    the WebRTC carrier uses a history page's worth. `IProtocolSession` now includes the runtime-tool
    and app-view roles.
  - `agent-ui-web` — the two new server messages are recorded as not rendered until the app-view host
    consumes them.

  An implementation of `IInteractiveSession` or `IProtocolSession` outside this repository must add
  `readToolAppView` (and, for `IProtocolSession`, `listRuntimeTools` and `invokeRuntimeTool`); the
  members are required so a host cannot silently lack them.

### Minor Changes

- 115e104: **A command's caller can cancel what a skill command starts, including while the skill is prepared.**

  `ISessionCommands.executeCommand` takes an optional trailing `{ signal }`. For a skill command it
  reaches the turn the skill submits or the fork it runs, and the work before them: a cancel stops the
  skill's activation before or after its shell expressions (once they start, all of them run to the
  end), refuses a turn not yet started and interrupts one that is, and stops a fork. A command cancelled this way
  rejects with the signal's reason whichever step the cancel reached, and a cancelled fork is not
  recorded as an error. Before, a cancel that landed before the skill submitted its turn found nothing
  for `abort()` to stop, and the turn then ran; a fork skill run as a command ignored the cancel. A
  command that starts neither a turn nor a fork ignores the signal; every existing call keeps its shape.

  A fork skill now receives the signal of whatever runs it, so a fork the model starts inside a turn
  stops when that turn is aborted instead of running on.

  `robota acp` hands each `/command` prompt's signal to the command, so `session/cancel` stops a skill
  command's turn or fork even when it lands before the turn has started.
- 04719a9: **A permission request names the tool call it is about.**

  `IPermissionRequestEvent` gains an optional `executionId`: the same id the call's `tool_start` and
  `tool_end` carry, so a surface can hold one row from the request to the call's end. The session's
  permission path carries the call's id from the tool wrapper to the prompt (`IPermissionAskContext.executionId`)
  and the framework's prompt registry stamps it on the event, so it reaches every client that receives
  the event, the WebSocket and HTTP `permission_request` frames included. It is present whenever the
  session reports that call (its own, or an in-process background agent's) and absent for a
  child-process agent's forwarded request.

  The ACP agent transport keys its permission rows by that id: the request's `toolCallId` is the
  call's execution id, its start and end address the same row, a denial the session decides on its
  own while the editor's dialog is open closes that one row, and two same-named calls each follow
  their own row whatever order the editor answers in. A request that names no call gets a row that
  closes with the answer, and is closed at the end of the turn if no answer came. The name-ordered
  matching is gone.

### Patch Changes

- 60f3965: **`robota mcp serve --ask-client` puts a caller's permission and ask prompts to the calling MCP client through elicitation instead of failing them.**

  `@robota-sdk/agent-transport-mcp`: `createMcpTransport`, `createMcpHttpHost`,
  `createMcpRemoteHttpHost` and `createAgentMcpServer` take `askClient`. Off by default, every prompt
  is a tool error as before. On, and when the client declared form-mode elicitation, a permission or
  ask prompt raised by that client's own call is put to it: a permission offers allow once or deny
  only, never a remembered grant; an ask becomes a form (choice, multiple choice, free text); a masked
  ask is never sent; deny, decline, cancel, a client error or an answer naming nothing offered keeps
  today's outcome. stdio asks during the call. The HTTP hosts keep no session state, so they ask only
  a client on the 2026-07-28 revision, through input-required rounds whose `requestState` is a
  single-use random token naming one parked call; a 2025-era HTTP client keeps the tool error.
  A call listens for prompts only while its own work drives the session, so a submission waiting
  in the queue never holds another caller's prompt that it cannot answer.
  Breaking for hand-written sessions: `IMcpTransportSession` now also requires `ISessionEvents`
  (`on`/`off`), `ISessionPromptResolution` (`resolvePermission`/`resolveAsk`) and
  `ISessionDriverAttribution` (`getActiveDriverId`), which `InteractiveSession` and the published
  test double already implement.

  `@robota-sdk/agent-interface-session` / `@robota-sdk/agent-session` / `@robota-sdk/agent-framework`:
  `ISessionRuntimeTools.invokeRuntimeTool` (and `Session.invokeRuntimeTool`) accept
  `options.permissionInteraction` and `options.driverId`. A direct call still denies a decision that
  would need a person, and finds no one to ask a question, unless its caller passes
  `permissionInteraction: 'interactive'`; then it asks the session's permission handler and its
  tools get the session's ask port. `InteractiveSession` makes `driverId` the active driver while
  the direct call runs, so a prompt the call raises carries it as `requesterDriverId`. With
  `askClient` on, an MCP call runs under its own `mcp:<n>` driver id; a submission made that way is
  attributed to it rather than to the owner.

  `@robota-sdk/agent-transport`: exports `permissionSummaryArgument`, the argument a person recognises
  a tool call by (`filePath` for the built-in file tools), for every transport that puts a permission
  request to a person in its own wire form.

  `@robota-sdk/agent-cli`: `mcp serve --ask-client` turns this on for whichever carrier the run serves.
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-core@3.0.0-beta.95
  - @robota-sdk/agent-interface-command@3.0.0-beta.95
  - @robota-sdk/agent-interface-execution@3.0.0-beta.95
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.95

## 3.0.0-beta.94
### Patch Changes

- Updated dependencies [fef3a50]
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.94
  - @robota-sdk/agent-core@3.0.0-beta.94
  - @robota-sdk/agent-interface-command@3.0.0-beta.94
  - @robota-sdk/agent-interface-execution@3.0.0-beta.94

## 3.0.0-beta.93
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.93
  - @robota-sdk/agent-interface-execution@3.0.0-beta.93
  - @robota-sdk/agent-interface-command@3.0.0-beta.93
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.93

## 3.0.0-beta.92
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.92
  - @robota-sdk/agent-interface-command@3.0.0-beta.92
  - @robota-sdk/agent-interface-execution@3.0.0-beta.92
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.92

## 3.0.0-beta.91
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.91
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.91
  - @robota-sdk/agent-interface-command@3.0.0-beta.91
  - @robota-sdk/agent-interface-execution@3.0.0-beta.91

## 3.0.0-beta.90
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.90
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.90
  - @robota-sdk/agent-interface-command@3.0.0-beta.90
  - @robota-sdk/agent-interface-execution@3.0.0-beta.90

## 3.0.0-beta.89
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.89
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.89
  - @robota-sdk/agent-interface-command@3.0.0-beta.89
  - @robota-sdk/agent-interface-execution@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.88
- @robota-sdk/agent-interface-analytics@3.0.0-beta.88
- @robota-sdk/agent-interface-command@3.0.0-beta.88
- @robota-sdk/agent-interface-execution@3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 7d9cc66: Retain mixed tool observations alongside structured results through live session events and history
  display. The shared app renderer previews inline raster images and keeps resource URIs inert, with
  explicit diagnostics for unsupported media instead of silently dropping it.
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
  - @robota-sdk/agent-core@3.0.0-beta.87
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.87
  - @robota-sdk/agent-interface-command@3.0.0-beta.87
  - @robota-sdk/agent-interface-execution@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.86
- @robota-sdk/agent-interface-analytics@3.0.0-beta.86
- @robota-sdk/agent-interface-command@3.0.0-beta.86
- @robota-sdk/agent-interface-execution@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [41cca13]
- Updated dependencies [193a0bc]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
  - @robota-sdk/agent-core@3.0.0-beta.85
  - @robota-sdk/agent-interface-command@3.0.0-beta.85
  - @robota-sdk/agent-interface-execution@3.0.0-beta.85
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

- Updated dependencies [9f46375]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-core@3.0.0-beta.84
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.84
  - @robota-sdk/agent-interface-execution@3.0.0-beta.84
  - @robota-sdk/agent-interface-command@3.0.0-beta.84

## 3.0.0-beta.83

### Major Changes

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

### Minor Changes

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
- Updated dependencies [e689c8e]
- Updated dependencies [7b72344]
- Updated dependencies [be0e53c]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.83
  - @robota-sdk/agent-core@3.0.0-beta.83
  - @robota-sdk/agent-interface-command@3.0.0-beta.83
  - @robota-sdk/agent-interface-execution@3.0.0-beta.83

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-interface-command@3.0.0-beta.82
  - @robota-sdk/agent-interface-execution@3.0.0-beta.82
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.82

## 3.0.0-beta.81

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

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
- Updated dependencies [18b52cc]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-interface-command@3.0.0-beta.81
  - @robota-sdk/agent-interface-execution@3.0.0-beta.81
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.81

## 3.0.0-beta.80

### Minor Changes

- 37b4bd7: `readAssistantReplies`, `readErrors`, `readLastAssistantText` and `readToolCalls` are exported from
  `@robota-sdk/agent-interface-session`, which is now published alongside
  `@robota-sdk/agent-interface-transport` (issue #2260).

  The four helpers shipped from `agent-interface-transport@3.0.0-beta.79` and moved to the session
  package on `develop` (ARCH-103..108), which was not yet on the registry. A consumer importing them
  from the transport package migrates the import to `@robota-sdk/agent-interface-session`; the session
  package is in the changeset fixed group, so it versions and publishes with the transport package.

### Patch Changes

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

- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [4eea54b]
- Updated dependencies [1698be4]
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
  - @robota-sdk/agent-interface-execution@3.0.0-beta.80
  - @robota-sdk/agent-interface-command@3.0.0-beta.80
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.80
