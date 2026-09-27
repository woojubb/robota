# @robota-sdk/agent-interface-command

## 3.0.0-beta.83

### Major Changes

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

### Minor Changes

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
    - `robota session attach` and an attach from `robota session view` open the full terminal UI,
      the one `robota --attach` opens, in drive mode or, with `--observe`, read-only. The reduced
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
- Updated dependencies [e689c8e]
- Updated dependencies [be0e53c]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
  - @robota-sdk/agent-core@3.0.0-beta.83

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82

## 3.0.0-beta.81

### Minor Changes

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
    `robota mcp login <server>`.

  A command whose bare form is a complete action declares `runsBare`, so choosing `/cost` or `/mcp`
  from the autocomplete menu still runs it even though they now declare subcommands.

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81

## 3.0.0-beta.80

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

### Patch Changes

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
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
