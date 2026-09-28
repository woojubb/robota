# @robota-sdk/agent-ui-web

## 3.0.0-beta.84

### Minor Changes

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
    that they belong to the robota terminal, instead of being unknown.
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
- f8a8a4d: The GUI surface's design now applies inside a `robota-ui` scope that each of its root components opens,
  so an app with design tokens of its own can embed the surface without either overriding the other. Such
  an app imports `@robota-sdk/agent-ui-web/styles/surface.css` into its Tailwind entry; a page that is only
  the surface keeps importing `styles/theme.css` and puts `robota-ui` on its `<html>`. `RobotaMark` and
  `RobotaWordmark` are exported. The browser remote client (`RemoteClient`) follows the same design, with
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
