# @robota-sdk/agent-ui-web

## 3.0.3
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.3
  - @robota-sdk/agent-interface-execution@3.0.3
  - @robota-sdk/agent-interface-session@3.0.3
  - @robota-sdk/agent-interface-transport@3.0.3
  - @robota-sdk/agent-transport@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.2
  - @robota-sdk/agent-interface-execution@3.0.2
  - @robota-sdk/agent-interface-session@3.0.2
  - @robota-sdk/agent-interface-transport@3.0.2
  - @robota-sdk/agent-transport@3.0.2

## 3.0.1
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.1
  - @robota-sdk/agent-interface-execution@3.0.1
  - @robota-sdk/agent-interface-session@3.0.1
  - @robota-sdk/agent-interface-transport@3.0.1
  - @robota-sdk/agent-transport@3.0.1

## 3.0.0
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
    that they belong to the configured CLI terminal, instead of being unknown.
  - `agent-framework`:
    - `InteractiveSession.getStatusSnapshot()`.
    - The main-thread row previews the last chat message instead of the last record's type.
  - `agent-cli` serves the full GUI web app, renamed from `agent-cli-web` to `agent-gui-web`, on
    `robota --serve --open`.
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
  - `agent-cli`: `robota --serve` provides the session directory, and refuses a switch that would lose
    work in progress. External-event grants belong to the run: a switch reopens them on the new session,
    as the TUI already does.
  - External-event grant history (spent tokens, rate windows, revocations) belongs to the run. The new
    option `externalEventGrantHistory` (from `createExternalEventGrantHistory()`) is shared by every
    session that a served runtime or the TUI builds. A session switch therefore replays no spent token
    and resets no rate limit. The TUI previously had this gap when it switched sessions.

### Minor Changes

- 9ecffed: `robota daemon start | status | stop | unlock` runs one long-lived runtime per workspace for clients to attach to.

  - **What a daemon is.** A supervised session marked as the workspace's daemon.
    - Its control socket answers `connect` with the loopback WebSocket address, and only to a caller that names the daemon's current start.
    - The token never touches disk or argv. The daemon removes it from its own environment, so its tools do not inherit it.
  - **Starting.** `daemon start --json` prints one line, `{"id","url"}`, for a client host to read.
    - Starts in one workspace take turns through a lock.
    - A lock left behind by a start that is gone is never removed automatically. The start refuses and names `robota daemon unlock`.
    - A daemon that cannot hand over its address fails its start and is not left running.
  - **The desktop app attaches** to the workspace daemon and starts one only when none is running.
    - Closing the window leaves the daemon running.
    - If the daemon stops while the window is open, the window says so and offers Reconnect.
  - **`agent-ui-web`.** The WebSocket session client reports when its retries are exhausted (`onGiveUp`, and `onConnectionLost` in `useWsSession`).
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
  - `agent-cli`: `robota --serve` and the daemon keep up to four sessions live. Each WebSocket client and
    attached terminal is bound to its own session; leaving a busy session is no longer refused, and only
    the last driver of a session with a pending prompt is kept from leaving it. Grants and the supervised
    name stay on the runtime's first session, and its reported activity covers every live session.
  - `agent-ui-web`: a refused new or switch shows the host's reason as a notice (an older host's
    `protocol_error` still does); the session sidebar marks live sessions and counts the other clients
    on each; after a reconnect to a host that keeps sessions live, the GUI returns to the session it was on.
  - `agent-ui-terminal`: an attached terminal shows why a switch was refused, and the picker's switch
    stays pending until the host answers; the session picker marks live sessions and their clients.
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
- 227ff3a: The GUI session surface (desktop app, `robota --serve --open`) is redesigned as a calm desktop app: readable
  type in a bundled Pretendard, monospace only for code and paths, surfaces separated by tone instead of
  outlines, and light and dark themes that follow the system. Agent replies read as prose, your messages sit
  in bubbles, tool calls are single quiet lines, and the composer carries the model, mode and effort. The
  permission prompt now shows what the tool was asked to run, and the title bar names the current session.
- f8a8a4d: The GUI surface's design now applies inside an `agent-ui` scope that each of its root components opens,
  so an app with design tokens of its own can embed the surface without either overriding the other. Such
  an app imports `@robota-sdk/agent-ui-web/styles/surface.css` into its Tailwind entry; a page that is only
  the surface keeps importing `styles/theme.css` and puts `agent-ui` on its `<html>`. `ProductMark` and
  `ProductWordmark` are exported. The browser remote client (`RemoteClient`) follows the same design, with
  its pairing states centred on the page.
- 29486da: A lost connection no longer drops a typed message or takes the person out of their session. While the
  transport is not `connected`, the composer keeps its draft and Send explains why it cannot submit
  ("Not connected"). A banner above the conversation — never a full-screen replacement — says "Connection
  lost. Reconnecting…" while retries continue, and once they give up either offers a working Reconnect
  (a host that can restart the runtime) or says how to reopen the page (a browser served by
  `robota --serve --open`). A desktop Reconnect remembers the session the person was in and returns to it
  once the restart's reload reconnects.
- e8d70ac: A first run finds a provider, instead of a dead end. `robota --serve` (and the daemon it starts) no
  longer refuses when no provider is configured: it starts in setup mode, and the GUI's conversation area
  shows a "Connect a model provider to start" panel with a "Set up provider" button in place of the
  composer. Answering it configures and swaps in the first provider live, with no restart. A startup
  failure now says why — `robota daemon start --json` and the desktop app's fatal screen report the
  child's own reason instead of a generic "readiness channel closed", and the fatal screen gets a Try
  again button. `trust status --json` and the desktop trust dialog list only sources whose state trust
  would actually change, instead of naming one this platform could not determine; the dialog shows one
  sentence and a collapsed Details section. `robota --serve --open` in an untrusted folder now asks at
  the terminal (trust it, start Restricted, or quit) when someone is there to ask, instead of refusing
  outright.
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
- fbb287d: Show a finished MCP tool call's app in an opaque frame with a source-bound JSON-RPC bridge. App callbacks use the session's view authority and permission prompt. Session changes and frame disposal reject pending local requests.

  Hosts can provide a sandbox URL through `SessionSurface`. The web GUI serves a separate sandbox document with content restrictions and `Connection-Allowlist` enforcement. App execution requires Chromium 158 or newer and native network isolation; other browsers and hosts without the response policy show an unavailable message and retain the text result. A surface without a sandbox URL never reads the app document.
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
- c402d98: Expose a separate product-bound CLI entry and desktop/native host helpers for npm-only consumer applications. Publish the product configuration and browser client contracts needed by those applications.

### Patch Changes

- 9721162: A key typed just as a prompt appears no longer answers it: in the terminal UI the permission prompt, and in the web UI both the permission and the ask dock.

  - **`agent-ui-terminal`:** the permission prompt ignores its keys for a short pause after it appears (`PERMISSION_PROMPT_ARM_DELAY_MS`). While it waits it shows "keys answer in a moment" and no selection cursor. In screen-reader mode, a number typed during the pause, or typed for the previous request, is not kept for a later Enter.
  - **`agent-ui-web`:** the docked permission or ask prompt waits a short pause (`PROMPT_ARM_DELAY_MS`) before it takes focus, so keys typed during that pause stay in the composer. While it waits it says so. A mouse click on a button answers at once, and Esc still denies or cancels; Enter or Space on a focused button waits like any other key, and a button focused to answer one prompt hands focus back to the dock when the next appears.
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
- 09e7e21: **An MCP server's form-mode elicitation during a tool call becomes a Robota ask prompt.**

  `@robota-sdk/agent-mcp` opens a session with `elicitation: true` to declare form-mode elicitation and
  answer it: a request the server raises while a tool call is in flight (a server→client
  `elicitation/create` on the legacy era, an `input_required` round on 2026-07-28) is put to a person
  through that call's ask port (`IMCPToolCallOptions.ask`, which the discovered tool fills from
  `IToolExecutionContext.ask`) as one question titled with the configured server id and carrying the
  server's message as one bounded line, with Respond and Decline, then one question per field
  (choices, multi-select, yes/no, or free text validated against the field and re-asked once). The
  answer continues the same call; the re-sent `tools/call` that carries it is the protocol's
  continuation, not a replay, and a prompt is withdrawn when its call ends (an abort, or the call's
  own timeout) — when the last in-flight call to that server ends, if there are several, since a
  request names none of them. A request outside an in-flight call, or during a call that has no ask port, is
  declined; a dismissal, a failing port or a second rejected answer cancels; a field named like a
  credential is shown unmasked with a warning. URL mode is not offered. Without the opt-in nothing
  changes: no capability is declared and an `input_required` result still closes the carrier. An
  embedded request of another kind (sampling, roots) or more rounds than the client allows closes the
  carrier as `input_required` does; an embedded elicitation the client refuses on its face (URL mode,
  a malformed form) fails the call and leaves the carrier open.

  `@robota-sdk/agent-cli` turns the opt-in on for the interactive terminal and the serve host driven by
  the desktop app or the web GUI, which show the prompt, and leaves it off for print mode and for the
  two serve-runtime hosts with no prompt surface, `mcp serve` and the ACP editor agent.

  `@robota-sdk/agent-ui-web` renders an ask with `maxSelect` above 1 as a multi-select: options toggle
  (click or 1–9), Submit answers with the ticked values once `minSelect` is met, and a toggle beyond
  `maxSelect` is ignored, as in the terminal.
- c207a31: Keep automatic compaction aligned with the active model and pending input, preserve provider usage when estimating new context, and keep summary text out of the response stream. Display live context changes and successful automatic compaction in the shared app interface.
- df02568: Local OpenAI-compatible servers can be set up without saving a placeholder API key. Explicit credentials and environment references remain effective for authenticated servers and connection tests. Optional credentials are managed through the user-only provider edit command.
- 7d9cc66: Restore actual interactive tool observations, identities and outcomes from persisted event history.
  Show denied calls as failed in live and restored GUI conversation views.
- Updated dependencies [9c19c50]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [37b4bd7]
- Updated dependencies [50d2c9f]
- Updated dependencies [724fabb]
- Updated dependencies [d877de2]
- Updated dependencies [d61e159]
- Updated dependencies [bfe8ed5]
- Updated dependencies [a5961c9]
- Updated dependencies [af2f2ad]
- Updated dependencies [3038eb7]
- Updated dependencies [c7f9203]
- Updated dependencies [18b52cc]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [57280bf]
- Updated dependencies [18c0d5c]
- Updated dependencies [193a0bc]
- Updated dependencies [9a01e78]
- Updated dependencies [e8d70ac]
- Updated dependencies [2c612ba]
- Updated dependencies [3427887]
- Updated dependencies [c967c57]
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [4c5148e]
- Updated dependencies [0116a29]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [9db63ee]
- Updated dependencies [b078afa]
- Updated dependencies [2ebff01]
- Updated dependencies [9db63ee]
- Updated dependencies [2ebff01]
- Updated dependencies [4772067]
- Updated dependencies [0f98419]
- Updated dependencies [64ba748]
- Updated dependencies [d312755]
- Updated dependencies [c207a31]
- Updated dependencies [3244fb8]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [7669851]
- Updated dependencies [7d9cc66]
- Updated dependencies [4b76cfa]
- Updated dependencies [07b627f]
- Updated dependencies [dfb9b15]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [7911a7d]
- Updated dependencies [7d9cc66]
- Updated dependencies [9c6a8db]
- Updated dependencies [7d9cc66]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-interface-execution@3.0.0
  - @robota-sdk/agent-interface-command@3.0.0
  - @robota-sdk/agent-interface-session@3.0.0
  - @robota-sdk/agent-interface-transport@3.0.0
  - @robota-sdk/agent-transport@3.0.0

## 3.0.0-beta.106
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.106
  - @robota-sdk/agent-interface-execution@3.0.0-beta.106
  - @robota-sdk/agent-interface-session@3.0.0-beta.106
  - @robota-sdk/agent-interface-transport@3.0.0-beta.106
  - @robota-sdk/agent-transport@3.0.0-beta.106

## 3.0.0-beta.105
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.105
  - @robota-sdk/agent-interface-execution@3.0.0-beta.105
  - @robota-sdk/agent-interface-session@3.0.0-beta.105
  - @robota-sdk/agent-interface-transport@3.0.0-beta.105
  - @robota-sdk/agent-transport@3.0.0-beta.105

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.104
  - @robota-sdk/agent-interface-execution@3.0.0-beta.104
  - @robota-sdk/agent-interface-session@3.0.0-beta.104
  - @robota-sdk/agent-interface-transport@3.0.0-beta.104
  - @robota-sdk/agent-transport@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.103
  - @robota-sdk/agent-interface-execution@3.0.0-beta.103
  - @robota-sdk/agent-interface-session@3.0.0-beta.103
  - @robota-sdk/agent-interface-transport@3.0.0-beta.103
  - @robota-sdk/agent-transport@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.102
  - @robota-sdk/agent-interface-execution@3.0.0-beta.102
  - @robota-sdk/agent-interface-session@3.0.0-beta.102
  - @robota-sdk/agent-interface-transport@3.0.0-beta.102
  - @robota-sdk/agent-transport@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.101
  - @robota-sdk/agent-interface-execution@3.0.0-beta.101
  - @robota-sdk/agent-interface-session@3.0.0-beta.101
  - @robota-sdk/agent-interface-transport@3.0.0-beta.101
  - @robota-sdk/agent-transport@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.100
  - @robota-sdk/agent-interface-execution@3.0.0-beta.100
  - @robota-sdk/agent-interface-session@3.0.0-beta.100
  - @robota-sdk/agent-interface-transport@3.0.0-beta.100
  - @robota-sdk/agent-transport@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.99
  - @robota-sdk/agent-interface-execution@3.0.0-beta.99
  - @robota-sdk/agent-interface-session@3.0.0-beta.99
  - @robota-sdk/agent-interface-transport@3.0.0-beta.99
  - @robota-sdk/agent-transport@3.0.0-beta.99

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.98
  - @robota-sdk/agent-interface-execution@3.0.0-beta.98
  - @robota-sdk/agent-interface-session@3.0.0-beta.98
  - @robota-sdk/agent-interface-transport@3.0.0-beta.98
  - @robota-sdk/agent-transport@3.0.0-beta.98

## 3.0.0-beta.97
### Patch Changes

- c207a31: Keep automatic compaction aligned with the active model and pending input, preserve provider usage when estimating new context, and keep summary text out of the response stream. Display live context changes and successful automatic compaction in the shared app interface.
- Updated dependencies [c207a31]
- Updated dependencies [7911a7d]
  - @robota-sdk/agent-transport@3.0.0-beta.97
  - @robota-sdk/agent-interface-session@3.0.0-beta.97
  - @robota-sdk/agent-interface-command@3.0.0-beta.97
  - @robota-sdk/agent-interface-execution@3.0.0-beta.97
  - @robota-sdk/agent-interface-transport@3.0.0-beta.97

## 3.0.0-beta.96
### Minor Changes

- fbb287d: Show a finished MCP tool call's app in an opaque frame with a source-bound JSON-RPC bridge. App callbacks use the session's view authority and permission prompt. Session changes and frame disposal reject pending local requests.

  Hosts can provide a sandbox URL through `SessionSurface`. The web GUI serves a separate sandbox document with content restrictions and `Connection-Allowlist` enforcement. App execution requires Chromium 158 or newer and native network isolation; other browsers and hosts without the response policy show an unavailable message and retain the text result. A surface without a sandbox URL never reads the app document.

### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.96
  - @robota-sdk/agent-interface-execution@3.0.0-beta.96
  - @robota-sdk/agent-interface-session@3.0.0-beta.96
  - @robota-sdk/agent-interface-transport@3.0.0-beta.96
  - @robota-sdk/agent-transport@3.0.0-beta.96

## 3.0.0-beta.95
### Minor Changes

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

### Patch Changes

- 09e7e21: **An MCP server's form-mode elicitation during a tool call becomes a Robota ask prompt.**

  `@robota-sdk/agent-mcp` opens a session with `elicitation: true` to declare form-mode elicitation and
  answer it: a request the server raises while a tool call is in flight (a server→client
  `elicitation/create` on the legacy era, an `input_required` round on 2026-07-28) is put to a person
  through that call's ask port (`IMCPToolCallOptions.ask`, which the discovered tool fills from
  `IToolExecutionContext.ask`) as one question titled with the configured server id and carrying the
  server's message as one bounded line, with Respond and Decline, then one question per field
  (choices, multi-select, yes/no, or free text validated against the field and re-asked once). The
  answer continues the same call; the re-sent `tools/call` that carries it is the protocol's
  continuation, not a replay, and a prompt is withdrawn when its call ends (an abort, or the call's
  own timeout) — when the last in-flight call to that server ends, if there are several, since a
  request names none of them. A request outside an in-flight call, or during a call that has no ask port, is
  declined; a dismissal, a failing port or a second rejected answer cancels; a field named like a
  credential is shown unmasked with a warning. URL mode is not offered. Without the opt-in nothing
  changes: no capability is declared and an `input_required` result still closes the carrier. An
  embedded request of another kind (sampling, roots) or more rounds than the client allows closes the
  carrier as `input_required` does; an embedded elicitation the client refuses on its face (URL mode,
  a malformed form) fails the call and leaves the carrier open.

  `@robota-sdk/agent-cli` turns the opt-in on for the interactive terminal and the serve host driven by
  the desktop app or the web GUI, which show the prompt, and leaves it off for print mode and for the
  two serve-runtime hosts with no prompt surface, `mcp serve` and the ACP editor agent.

  `@robota-sdk/agent-ui-web` renders an ask with `maxSelect` above 1 as a multi-select: options toggle
  (click or 1–9), Submit answers with the ticked values once `minSelect` is met, and a toggle beyond
  `maxSelect` is ignored, as in the terminal.
- Updated dependencies [c967c57]
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
  - @robota-sdk/agent-transport@3.0.0-beta.95
  - @robota-sdk/agent-interface-session@3.0.0-beta.95
  - @robota-sdk/agent-interface-command@3.0.0-beta.95
  - @robota-sdk/agent-interface-execution@3.0.0-beta.95
  - @robota-sdk/agent-interface-transport@3.0.0-beta.95

## 3.0.0-beta.94
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.94
  - @robota-sdk/agent-transport@3.0.0-beta.94
  - @robota-sdk/agent-interface-command@3.0.0-beta.94
  - @robota-sdk/agent-interface-execution@3.0.0-beta.94
  - @robota-sdk/agent-interface-transport@3.0.0-beta.94

## 3.0.0-beta.93
### Minor Changes

- c402d98: Expose a separate product-bound CLI entry and desktop/native host helpers for npm-only consumer applications. Publish the product configuration and browser client contracts needed by those applications.

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-interface-execution@3.0.0-beta.93
  - @robota-sdk/agent-interface-command@3.0.0-beta.93
  - @robota-sdk/agent-interface-session@3.0.0-beta.93
  - @robota-sdk/agent-interface-transport@3.0.0-beta.93
  - @robota-sdk/agent-transport@3.0.0-beta.93

## 3.0.0-beta.92
### Patch Changes

- Local OpenAI-compatible servers can be set up without saving a placeholder API key. Explicit credentials and environment references remain effective for authenticated servers and connection tests. Optional credentials are managed through the user-only provider edit command.
  - @robota-sdk/agent-interface-command@3.0.0-beta.92
  - @robota-sdk/agent-interface-execution@3.0.0-beta.92
  - @robota-sdk/agent-interface-session@3.0.0-beta.92
  - @robota-sdk/agent-interface-transport@3.0.0-beta.92
  - @robota-sdk/agent-transport@3.0.0-beta.92

## 3.0.0-beta.91
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.91
  - @robota-sdk/agent-interface-execution@3.0.0-beta.91
  - @robota-sdk/agent-interface-session@3.0.0-beta.91
  - @robota-sdk/agent-interface-transport@3.0.0-beta.91
  - @robota-sdk/agent-transport@3.0.0-beta.91

## 3.0.0-beta.90
### Patch Changes

  - @robota-sdk/agent-interface-command@3.0.0-beta.90
  - @robota-sdk/agent-interface-execution@3.0.0-beta.90
  - @robota-sdk/agent-interface-session@3.0.0-beta.90
  - @robota-sdk/agent-interface-transport@3.0.0-beta.90
  - @robota-sdk/agent-transport@3.0.0-beta.90

## 3.0.0-beta.89
### Patch Changes

- Updated dependencies [3427887]
  - @robota-sdk/agent-transport@3.0.0-beta.89
  - @robota-sdk/agent-interface-command@3.0.0-beta.89
  - @robota-sdk/agent-interface-execution@3.0.0-beta.89
  - @robota-sdk/agent-interface-session@3.0.0-beta.89
  - @robota-sdk/agent-interface-transport@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- @robota-sdk/agent-interface-command@3.0.0-beta.88
- @robota-sdk/agent-interface-execution@3.0.0-beta.88
- @robota-sdk/agent-interface-session@3.0.0-beta.88
- @robota-sdk/agent-interface-transport@3.0.0-beta.88
- @robota-sdk/agent-transport@3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- 7d9cc66: Restore actual interactive tool observations, identities and outcomes from persisted event history.
  Show denied calls as failed in live and restored GUI conversation views.
- Updated dependencies
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
  - @robota-sdk/agent-interface-command@3.0.0-beta.87
  - @robota-sdk/agent-interface-execution@3.0.0-beta.87
  - @robota-sdk/agent-interface-session@3.0.0-beta.87
  - @robota-sdk/agent-interface-transport@3.0.0-beta.87
  - @robota-sdk/agent-transport@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-interface-command@3.0.0-beta.86
- @robota-sdk/agent-interface-execution@3.0.0-beta.86
- @robota-sdk/agent-interface-session@3.0.0-beta.86
- @robota-sdk/agent-interface-transport@3.0.0-beta.86
- @robota-sdk/agent-transport@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [193a0bc]
- Updated dependencies [9a01e78]
  - @robota-sdk/agent-interface-command@3.0.0-beta.85
  - @robota-sdk/agent-transport@3.0.0-beta.85
  - @robota-sdk/agent-interface-execution@3.0.0-beta.85
  - @robota-sdk/agent-interface-session@3.0.0-beta.85
  - @robota-sdk/agent-interface-transport@3.0.0-beta.85

## 3.0.0-beta.84

### Minor Changes

- 29486da: A lost connection no longer drops a typed message or takes the person out of their session. While the
  transport is not `connected`, the composer keeps its draft and Send explains why it cannot submit
  ("Not connected"). A banner above the conversation — never a full-screen replacement — says "Connection
  lost. Reconnecting…" while retries continue, and once they give up either offers a working Reconnect
  (a host that can restart the runtime) or says how to reopen the page (a browser served by
  `__PRODUCT_CLI_NAME__ --serve --open`). A desktop Reconnect remembers the session the person was in and returns to it
  once the restart's reload reconnects.
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

- Updated dependencies [e8d70ac]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-interface-session@3.0.0-beta.84
  - @robota-sdk/agent-interface-execution@3.0.0-beta.84
  - @robota-sdk/agent-transport@3.0.0-beta.84
  - @robota-sdk/agent-interface-command@3.0.0-beta.84
  - @robota-sdk/agent-interface-transport@3.0.0-beta.84

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

### Minor Changes

- 9ecffed: `__PRODUCT_CLI_NAME__ daemon start | status | stop | unlock` runs one long-lived runtime per workspace for clients to attach to.

  - **What a daemon is.** A supervised session marked as the workspace's daemon.
    - Its control socket answers `connect` with the loopback WebSocket address, and only to a caller that names the daemon's current start.
    - The token never touches disk or argv. The daemon removes it from its own environment, so its tools do not inherit it.
  - **Starting.** `daemon start --json` prints one line, `{"id","url"}`, for a client host to read.
    - Starts in one workspace take turns through a lock.
    - A lock left behind by a start that is gone is never removed automatically. The start refuses and names `__PRODUCT_CLI_NAME__ daemon unlock`.
    - A daemon that cannot hand over its address fails its start and is not left running.
  - **The desktop app attaches** to the workspace daemon and starts one only when none is running.
    - Closing the window leaves the daemon running.
    - If the daemon stops while the window is open, the window says so and offers Reconnect.
  - **`agent-ui-web`.** The WebSocket session client reports when its retries are exhausted (`onGiveUp`, and `onConnectionLost` in `useWsSession`).

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

- 227ff3a: The GUI session surface (desktop app, `__PRODUCT_CLI_NAME__ --serve --open`) is redesigned as a calm desktop app: readable
  type in a bundled Pretendard, monospace only for code and paths, surfaces separated by tone instead of
  outlines, and light and dark themes that follow the system. Agent replies read as prose, your messages sit
  in bubbles, tool calls are single quiet lines, and the composer carries the model, mode and effort. The
  permission prompt now shows what the tool was asked to run, and the title bar names the current session.
- f8a8a4d: The GUI surface's design now applies inside a `agent-ui` scope that each of its root components opens,
  so an app with design tokens of its own can embed the surface without either overriding the other. Such
  an app imports `@robota-sdk/agent-ui-web/styles/surface.css` into its Tailwind entry; a page that is only
  the surface keeps importing `styles/theme.css` and puts `agent-ui` on its `<html>`. `ProductMark` and
  `ProductWordmark` are exported. The browser remote client (`RemoteClient`) follows the same design, with
  its pairing states centred on the page.

### Patch Changes

- 9721162: A key typed just as a prompt appears no longer answers it: in the terminal UI the permission prompt, and in the web UI both the permission and the ask dock.

  - **`agent-ui-terminal`:** the permission prompt ignores its keys for a short pause after it appears (`PERMISSION_PROMPT_ARM_DELAY_MS`). While it waits it shows "keys answer in a moment" and no selection cursor. In screen-reader mode, a number typed during the pause, or typed for the previous request, is not kept for a later Enter.
  - **`agent-ui-web`:** the docked permission or ask prompt waits a short pause (`PROMPT_ARM_DELAY_MS`) before it takes focus, so keys typed during that pause stay in the composer. While it waits it says so. A mouse click on a button answers at once, and Esc still denies or cancels; Enter or Space on a focused button waits like any other key, and a button focused to answer one prompt hands focus back to the dock when the next appears.

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

- Updated dependencies [724fabb]
- Updated dependencies [d877de2]
- Updated dependencies [d61e159]
- Updated dependencies [bfe8ed5]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [57280bf]
- Updated dependencies [18c0d5c]
  - @robota-sdk/agent-interface-transport@3.0.0-beta.83
  - @robota-sdk/agent-transport@3.0.0-beta.83
  - @robota-sdk/agent-interface-session@3.0.0-beta.83
  - @robota-sdk/agent-interface-command@3.0.0-beta.83
  - @robota-sdk/agent-interface-execution@3.0.0-beta.83

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-transport@3.0.0-beta.82
  - @robota-sdk/agent-interface-command@3.0.0-beta.82
  - @robota-sdk/agent-interface-execution@3.0.0-beta.82
  - @robota-sdk/agent-interface-session@3.0.0-beta.82
  - @robota-sdk/agent-interface-transport@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [18b52cc]
  - @robota-sdk/agent-interface-session@3.0.0-beta.81
  - @robota-sdk/agent-interface-command@3.0.0-beta.81
  - @robota-sdk/agent-interface-execution@3.0.0-beta.81
  - @robota-sdk/agent-interface-transport@3.0.0-beta.81
  - @robota-sdk/agent-transport@3.0.0-beta.81

## 3.0.0-beta.80

### Minor Changes

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

- Updated dependencies [9c19c50]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [37b4bd7]
- Updated dependencies [50d2c9f]
- Updated dependencies [a5961c9]
- Updated dependencies [af2f2ad]
- Updated dependencies [4c5148e]
- Updated dependencies [0116a29]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [9db63ee]
- Updated dependencies [b078afa]
- Updated dependencies [2ebff01]
- Updated dependencies [9db63ee]
- Updated dependencies [2ebff01]
- Updated dependencies [4772067]
- Updated dependencies [0f98419]
- Updated dependencies [64ba748]
- Updated dependencies [d312755]
- Updated dependencies [3244fb8]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [7669851]
- Updated dependencies [4b76cfa]
- Updated dependencies [07b627f]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-interface-execution@3.0.0-beta.80
  - @robota-sdk/agent-interface-command@3.0.0-beta.80
  - @robota-sdk/agent-interface-session@3.0.0-beta.80
  - @robota-sdk/agent-interface-transport@3.0.0-beta.80
  - @robota-sdk/agent-transport@3.0.0-beta.80
