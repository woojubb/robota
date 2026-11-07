# @robota-sdk/agent-command

## 3.2.1
### Patch Changes

  - @robota-sdk/agent-framework@3.2.1
  - @robota-sdk/agent-preset@3.2.1
  - @robota-sdk/agent-core@3.2.1
  - @robota-sdk/agent-interface-command@3.2.1
  - @robota-sdk/agent-interface-execution@3.2.1
  - @robota-sdk/agent-interface-session@3.2.1

## 3.2.0
### Minor Changes

- 12ab3f5: Follow a running fork without stopping its parent, steer its job, and continue its record after it ends.
- ffaf7d5: Add the runtime half of owner-link admission. Secure mode remains dormant until the product enables it.

  The transport provides the spawner-pair exchange and bounded delivery of queued link frames. The CLI
  uses the exchanged runtime identity to admit owner links, receives read grants without a passphrase,
  locks keys when access ends, and refuses unsecured listener and control paths. The child-session spawn
  paths can be held while a handed-over descriptor is consumed, and the runtime uses that hold during the
  exchange.

### Patch Changes

- Updated dependencies [e5ce7d6]
- Updated dependencies [12ab3f5]
- Updated dependencies [ffaf7d5]
- Updated dependencies [9da9c6c]
- Updated dependencies [ad5e9fb]
  - @robota-sdk/agent-interface-session@3.2.0
  - @robota-sdk/agent-framework@3.2.0
  - @robota-sdk/agent-interface-execution@3.2.0
  - @robota-sdk/agent-core@3.2.0
  - @robota-sdk/agent-preset@3.2.0
  - @robota-sdk/agent-interface-command@3.2.0

## 3.1.2
### Patch Changes

  - @robota-sdk/agent-core@3.1.2
  - @robota-sdk/agent-framework@3.1.2
  - @robota-sdk/agent-interface-command@3.1.2
  - @robota-sdk/agent-interface-execution@3.1.2
  - @robota-sdk/agent-interface-session@3.1.2
  - @robota-sdk/agent-preset@3.1.2

## 3.1.1
### Patch Changes

  - @robota-sdk/agent-framework@3.1.1
  - @robota-sdk/agent-preset@3.1.1
  - @robota-sdk/agent-core@3.1.1
  - @robota-sdk/agent-interface-command@3.1.1
  - @robota-sdk/agent-interface-execution@3.1.1
  - @robota-sdk/agent-interface-session@3.1.1

## 3.1.0
### Minor Changes

- d46727b: The local unlock gate for secure conversations (issue #3679), dormant until secure mode can be turned
  on: no product process is given a key holder yet, so nothing below runs and nothing reads differently.

  - `@robota-sdk/agent-ui-terminal` exports the key custody port types (`IKeyCustodyPort`,
    `TUserReadRequest`, `TReadPurpose`, `TReadability`) and `isUserReadRequest`, which answers whether
    the UI's own mint made a request: an object of the same shape made by a cast is not one.
    `ITuiCliAdapter` gains an optional `keyCustody`. Attaching to a fork sealed while the keys are
    locked asks the port to unlock for it, only when the attach would be honoured. While the terminal
    is handed over to another program, the composer's stdin proxy now forwards nothing.
  - `@robota-sdk/agent-command` adds `/unlock` and `/lock` (`createKeyCustodyCommandModule`,
    `IKeyCustodyCommandPort`), user-only, registered by `createDefaultCommandModules` only when given a
    `keyCustodyPort`.
  - `@robota-sdk/agent-framework`: `lockedSessionMessage` and `lockedSessionsNotice` take an optional
    `unlockCommand` and name it for locked keys, and `editCheckpointsLockedMessage` words a locked
    rewind the same way; without one the wording is unchanged. The TUI passes `/unlock` where it has
    the key custody, in the resume picker, Ctrl+R and fork attach; `/rewind`, `/validate-session`,
    `/agent read` and `/background read` name it where the session registered it.
  - `@robota-sdk/agent-cli` composes the gate for the TUI in secure mode: the passphrase is asked on the
    secret terminal inside the terminal handoff, one question at a time, never where nobody can answer.

  What to do: nothing.
- bc8de21: Edit checkpoints can be sealed, and every `EditCheckpointStore` now states how it keeps them.

  - `EditCheckpointStore` requires `sealing`: `{ sealer }` seals every manifest and pre-image, bound to
    its session, turn and pre-image number so one moved elsewhere does not open there; `'plain'` keeps
    them as they are. `stateStorage` only says where they live (the project's checkpoint directory when
    omitted), and `sealedOnly: true` is for state made for one process, which never held a plain
    checkpoint. A sealed store numbers new checkpoints from directory names alone and refuses with
    `EditCheckpointNumberingExhaustedError` at the highest number, after which an interactive turn runs
    without a checkpoint and its history says why.
  - `IEditCheckpointStateStorage` requires `replaceBytes(path, content, purpose)`, which replaces a file
    whole; `createDirectoryEditCheckpointState` and the project's checkpoint state have it.
  - A checkpoint that cannot be read (damaged, written by a newer build, or sealed and locked) is
    reported instead of failing the whole read: `EditCheckpointsLockedError` (an `ArtifactLockedError`
    with its `reason`) for locked keys or no keys, `EditCheckpointUnreadableError` for a restore or
    rollback range holding one, refused before any project file is written. The store takes an optional
    `keysLocked` gate, and `countUnreadable()` and `listing()` say how many `list()` left out. `/rewind
  list` prints that count and `/rewind inspect` marks a recorded size and a plan that would be refused.
  - The branch head moves to a new checkpoint only once its manifest is written; a failed write used to
    leave the head on the unwritten checkpoint, so the next turn became its own parent and walking its
    ancestors never ended. `CheckpointTree.ancestors` (`@robota-sdk/agent-session`) also stops where
    parent edges loop back.

  What to do: pass `sealing: 'plain'` to every `new EditCheckpointStore(...)` that does not seal, and add
  `replaceBytes` to a storage of your own.
- bc8de21: `secure migrate`, still reserved for secure mode (which cannot be turned on yet), now converts every
  conversation store after the prompt history: the user's session records, the subagent transcripts,
  and the state of each trusted project on a host that can write project state (session records, replay
  logs with their payload files, edit checkpoints, and pending memory candidates, which are deleted). It
  then deletes what earlier runs left behind: temp files of crashed writes, sessions kept aside during a
  hand-off, `/editor` buffers in the shared temporary directory and the scratch directories of
  processes that are gone. What it cannot seal safely (a link or a file with another hard link,
  untrusted and non-Linux projects, the SDK's spill directories, anything that does not open with the
  keyring) is listed and left as it is. `--dry-run` shows exactly what a run would do and changes
  nothing. A run that leaves plaintext which a rerun or moving a file aside would remove ends
  incomplete (exit 5) and says what to do; plaintext it can never seal (a project record or log past
  the project read limit once sealed, checkpoint turns kept plain) is listed, and the run still ends
  done. A run stopped part-way finishes when started again. `/rewind` names `<cli> secure migrate`
  for a checkpoint whose sealed copy is still waiting.

  `@robota-sdk/agent-session` adds `migrateNodeSessionStore`, `readSessionStoreWorkingDirectories`,
  `migrateSessionLogDirectory`, `readPromptHistoryProjects` and the format helpers they share.
  `@robota-sdk/agent-framework` adds `migrateWorkspaceProjectSessionRecords`,
  `migrateWorkspaceProjectSessionLogs`, `migrateWorkspaceEditCheckpoints` and
  `migrateSubagentTranscripts`; `EditCheckpointUnreadableError` gains `unfinishedMigration`; and
  `createNodeWorkspaceTrustStore(path, { tightenOnRead: false })` reads a trust store without narrowing
  its mode. Nothing calls the converters outside a migration.

  What to do: nothing.
- bc8de21: Every store that keeps conversation content now states how it seals (`TArtifactSealing`, from
  `@robota-sdk/agent-core`), and has no plain default: a store left plain beside sealed ones would
  write plaintext next to them. `{ sealing: { sealer } }`
  seals with an `IArtifactSealer` (bound to the record, line or file it belongs to), and
  `{ sealing: 'plain' }` writes plain JSON, lines and files as before. A store that seals reads plain
  content too and seals what it rewrites; a store that does not seal meets a sealed file as `locked`.

  What breaks, and what to do: the `sealing` option is required (omitting it is a compile error and a
  `TypeError` at run time) wherever a store is built or read, so pass `{ sealing: 'plain' }` to keep
  what you have.

  - `@robota-sdk/agent-session`: `NodeSessionStore(baseDir, { sealing, ownedRoot? })`, where `ownedRoot`
    moves from a positional argument into the options; `NodePromptHistoryFile`, `NodeSessionLogSink`,
    `NodeSessionLogSource`, `NodeExternalPayloadSource` (with an optional `ownerId`) and
    `NodeToolResultSpillStore` take it in their options.
  - `@robota-sdk/agent-framework`: `createUserSessionStore(dir, { sealing })`,
    `createNodeHostSessionStore(dir, { sealing, ownedRoot? })` (same move of `ownedRoot`),
    `createProjectSessionStore(sessions, logs, { sealing })`, `WorkspaceProjectSessionStore`,
    `createUserPromptHistoryFile`, `WorkspaceSessionLogSink`, `WorkspaceSessionLogSource` and
    `createNodeToolResultSpillStore`. `IWorkspaceProjectStateStorage.replaceBytes` is required: the
    project session store replaces a record whole through it, so a storage of your own implements it
    (the framework's storage does).

  A sealing append store writes each append as one sealed line and each log sidecar sealed under a
  random name. The log sources gain `readStoredLines()`, which returns every line as readable, locked,
  not opening, or sealed by a newer build, while `readText()` stays strict and throws
  `ArtifactLockedError`, `ArtifactCorruptError` or `SessionLogDecodeError`. `StoredLines`,
  `StoredPayloads` and `splitStoredLines` are exported for hosts that build their own append stores.
  `IPromptHistoryBlock` gains an optional `unreadable: { locked, noKeys }`, and the terminal's Ctrl+R
  search says how many prompts are sealed and whether an unlock would let it search them. A project
  store reads its replay logs with its own sealing and reports a log it cannot read as `locked`,
  `corrupt` or `unsupported`; a plain log whose payload file is missing or does not match is now
  `corrupt` too, where `load` and `list` used to throw, and `/validate-session` says when the log is
  sealed instead of failing with an error.

  A sealing spill store writes each result sealed and bound to its reference as `<token>.sealed` and
  answers `read-failed` for one that does not open. In either mode a result whose file is already gone
  when it expires or at shutdown now counts as removed, where that cleanup used to fail with
  `cleanup-failed` every time, and with it every later write.
- bc8de21: Subagent transcripts and fork jobs work with sealed conversation stores.

  What breaks, and what to do:

  - `createChildProcessSubagentRunnerFactory` and `ChildProcessSubagentRunner` require `logSealing`:
    how the children keep their logs, `{ sealer }` or `'plain'`. A host that seals passes its sealer
    and implements `bindWriteGrant(grant)` in its worker composition; any other host passes `'plain'`.
  - `createSubagentLogger(parentSessionId, agentId, baseLogsDir, { sealing }, fs?)` requires `sealing`
    as its fourth argument, ahead of the optional file system; pass `'plain'` for a plain log.
  - `TSubagentWorkerParentMessage` gains `{ type: 'sealing_key'; grant }`, which
    `isSubagentWorkerParentMessage` accepts: a worker of your own handles it by binding the new grant,
    or stops when it cannot seal to it.

  What is new:

  - A fork job's log is now read from the file the child writes. The child names its log after the
    session it runs (the forked record, else the task) and the parent read `<taskId>.jsonl`, so
    `/agent read` on a fork job showed "No log lines", and with worktree isolation (the default for
    `/fork`) the read was not offered at all. `resolveSubagentLogSessionId`,
    `resolveSubagentTranscriptPath` and `readSubagentTranscriptPage(path, { sealing })`
    (`@robota-sdk/agent-framework`) are the one rule both sides use.
  - In a sealed log a page's offset counts stored records, so it names the same record whether or not
    the keys are locked. `IBackgroundTaskLogPage` gains an optional `unreadable` count of records the
    page could not show (`locked`, `noKeys`, `doesNotOpen`); a run of locked records shows as one fixed
    line, and `/agent read` and `/background read` say whether an unlock would read them.
  - `IInteractiveSessionStore.save` takes optional `{ handoff }`, and the store port gains optional
    `exportHeld(id, { keep })` and `importHeld(id, token)`, implemented by `NodeSessionStore` and
    `WorkspaceProjectSessionStore`: a record written for a fork job is kept apart from the sessions a
    sealing store runs and handed to the job once. A fork job restores from a read made the way a
    writer reads, so an in-process fork job restores the fork `/fork` just wrote while the keys are
    locked. A sealed record a write-only store cannot open loads as
    `{ status: 'locked', reason: 'no-keys' }`.
  - `@robota-sdk/agent-subagent-runner`: with a sealer, the start payload carries the write grant (no
    secret) the sealer issues when the payload is sent and, for a fork job, the parent's held record as
    `resumeHeld` (at most 32 MiB; the job is refused before anything is made for it when none can be
    handed over, naming "unlock" only when locked keys are why). A child already sent its payload gets
    a newer grant as a `sealing_key` message, and one that cannot follow it stops. `bindWriteGrant`
    must return a sealer whose `writeGrant()` equals the grant, or the job fails. `ISubagentRunner`
    gains optional `preflight(job)`, which refuses what `start` would and changes nothing; the worktree
    runner calls it before it prepares a worktree. A job whose start payload cannot be built or sent
    after its child was spawned now cancels the child before it rejects.
  - Job handles may say `transcriptSealed`, and the manager projects it into the task state beside
    `transcriptPath` (`IBackgroundTaskState`, `ISubagentJobState`), where the session record codec
    accepts it. A job-group result gets `transcriptSealed` too. SubagentStart/Stop hooks get
    `transcript_sealed: true` beside the transcript path, and `summarizeBackgroundJobGroup` points at
    `/agent read <taskId>` instead of the path, also for a group restored in a later session.
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
- ee7f7ef: Make the main entries of `@robota-sdk/agent-tools`, `@robota-sdk/agent-framework`, `@robota-sdk/agent-command`, `@robota-sdk/agent-preset` and `@robota-sdk/agent-product` platform-neutral. They run unchanged in a browser, a Web Worker, Node, Deno and Bun, and no longer map `"browser": null` on `.`. Every package is now in exactly one of ARCHITECTURE.md's three platform lists; the "Not yet neutral" list is gone.

  - `@robota-sdk/agent-tools` no longer re-exports `GrepIsolationError`, `ReadByteLimitError`, `ReadCancelledError`, `createBashTool`, `createEditTool`, `createGlobTool`, `createGrepTool`, `createReadTool`, `createShellTool`, `createWriteTool` and `webFetchTool` from its main entry. They are on `@robota-sdk/agent-tools/node` only, which is where `@robota-sdk/workflows` 0.0.4 imports them.
  - The five packages build once into `dist` (not `dist/node`) and their `exports` map `import` and `require` only. A Node-only subpath keeps `"browser": null`: `./node` on `agent-tools`, `agent-framework`, `agent-command` and `agent-preset`, and `./testing` on `agent-framework`. Specifiers and the code behind them are unchanged; only a deep import of `dist/node/*` breaks.
  - `/user-local` and `executeUserLocalDirectCommand` read and write their storage root through an injected file system, as `/doctor` does through `doctorDeps`: `createUserLocalCommandModule(storageRoot, fsAsync)`, the `userLocalFileSystem` option of `createDefaultCommandModules` and the `fsAsync` option of `executeUserLocalDirectCommand`. They no longer import `NodeFileSystemAsync` themselves, and absent a file system the command is listed and answers that it is unavailable on this host; nothing is read or written.
  - `@robota-sdk/agent-cli` passes `new NodeFileSystemAsync()` from `@robota-sdk/agent-framework/node` for both, so `/user-local` and `agent user-local` behave as before.
- 7ce5e73: Add the framework host and make `host` and `cwd` required wherever the framework builds a session. The host is passed and accepted but nothing reads it yet, so behaviour is unchanged.

  - `@robota-sdk/agent-framework`: `IFrameworkHost` lists what a platform lends the framework (home directory, workspace resolver, path canonicalizer, exit flush, environment, files, git, git remotes, hook executors, background task runners, default tools, observer failure report, async scope, project mutation support). Every member is optional and an absent one means the capability is off, so `{}` is a valid host. `IAsyncScope` is the port behind `createAsyncScope`.
  - `@robota-sdk/agent-framework/node` (new, `"browser": null`) exports `createNodeFrameworkHost({ createDefaultTools })`, which fills every member for a Node process. The composition root names `createDefaultTools` from `@robota-sdk/agent-tool-defaults`; pass `() => []` for sessions with no default tier. `@robota-sdk/agent-framework/testing` exports `createTestFrameworkHost(overrides?)`, the same host with the real default tools, where an override replaces a member and an explicit `undefined` removes it.
  - `host` is required on `InteractiveSession` (both construction shapes, so on `buildRuntimeSession` and `startRuntimeHost` too), `createSession`, `createSubagentSession`, `createQuery`, `createAgentRuntime` and `createStatelessRuntime`, and on the options of `createInteractiveRuntime`, `createProgrammaticAgent`, `HeadlessInteractionChannel` and an in-process subagent runner. A missing `host` throws at construction, naming `createNodeFrameworkHost`.
  - `cwd` is required, and absolute as it already had to be, on `createSession`, `createQuery`, `createStatelessRuntime` and an injected-session `InteractiveSession`. The `process.cwd()` fallback is gone: a caller that relied on it passes `process.cwd()` itself.
  - `@robota-sdk/agent-cli`: `startCliCore` takes the host as its second argument and `runPrintMode` as its second after the product runtime; `startCli` and the headless entry build it with `createNodeFrameworkHost`. `IRunEvalDeps.host` is required unless `runFn` is given.
  - `@robota-sdk/agent-subagent-runner`: `ISubagentWorkerComposition.host` is required; the worker builds its child session on it, and the product's composition supplies it.
  - `@robota-sdk/agent-ui-terminal`: `IRenderOptions` and `ITuiInteractionChannelOptions` take `host`.
  - `@robota-sdk/agent-command`, `@robota-sdk/agent-product`: their tests and scenario scripts pass a host; no published surface changes.
- a2d36ea: Make `InteractiveSession`, the git reads, the headless output and the task context read their platform from the host instead of from the process they run in. Where the Node host supplies a capability, behaviour is as before; where a host leaves it out, the code says so.

  - `@robota-sdk/agent-framework`, session: the session reads `host.git`, `host.files`, `host.canonicalizePath`, `host.homeDirectory`, `host.registerExitFlush`, `host.supportsProjectMutation` and `host.createAsyncScope`. Without `git`, `readProjectStatus` and `readProjectDiff` return `failed`; without `files` a project diff is refused (containment cannot be proven), an Edit diff carries no context lines from the file, `pluginDirectories` makes the constructor throw, and a workspace manifest's local entries are refused by name; without `files` or `canonicalizePath` `/cd` refuses, and `/cd ~` refuses without `homeDirectory`; without `supportsProjectMutation` "allow for project" is not offered and checkpoints report `host-cannot-write-project`; without `registerExitFlush` the session log is not flushed at an abnormal exit. Session ids, loop ids and history entry ids use `randomId`.
  - `@robota-sdk/agent-framework`, commands: a host without `createAsyncScope` (a browser) cannot tell overlapping commands apart, so the skill router stays strictly nested. It runs one user or remote command at a time and answers a second with `Another command is already running on this host`; it admits a model command only when no such command runs or that command has started its own turn, and refuses any other the same way; and it refuses a forked skill before it starts, in a message naming `createAsyncScope`, because a fork's resource window needs a scope that follows the fork's own calls. The Node host's `createAsyncScope` keeps every command's scope and every fork's resource window on its own call chain, as before.
  - `@robota-sdk/agent-framework`, git: `createGitProcess`, `gitEnvironment`, `GIT_DEFAULT_TIMEOUT_MS`, `GIT_ENV_DENYLIST`, `GIT_MAX_OUTPUT_BYTES` and `ICreateGitProcessOptions` move from the main entry to `@robota-sdk/agent-framework/node`. `gitFailureMessage`, the port types and the status and diff readers stay on the main entry. `readProjectGitDiff` takes the host's `files` as a required fourth argument.
  - `@robota-sdk/agent-framework`, headless: `createHeadlessRunner`, `createHeadlessTransport` and `HeadlessInteractionChannel` take a required `output` (`IHeadlessOutput`: `stdout` and `stderr`, each anything with `write(text)`), and write nothing to `process`. `readCurrentGitBranchFromNodeHost` takes its file system as a required second argument; a relative `cwd` has no branch.
  - `@robota-sdk/agent-framework`, internal signatures: `buildDiffState` and `applyToolEnd` take the host's `files` instead of defaulting to the Node file system.
  - `@robota-sdk/agent-cli`: print mode passes `{ stdout: process.stdout, stderr: process.stderr }` as the headless `output`, and the open-invocation host takes `createGitProcess` from `@robota-sdk/agent-framework/node`.
  - `@robota-sdk/agent-command`: `createGitProcess`, `gitEnvironment` and `ICreateGitProcessOptions` are no longer re-exported; import them from `@robota-sdk/agent-framework/node`.
- be32d9b: Make the provider, org-policy, plugin and user-local modules of the framework platform-neutral. They no longer reach for the process environment, the process streams or the file system; each takes what it needs from its caller, and an absent one means the capability is off.

  - Provider environment: `$ENV:` references and a definition's default credential variable are read against the `env` the caller passes, which is either a map or a resolver function (`readProviderSettings`, `createProviderFromSettings`, `resolveEnvDefaultProvider`, `resolveActiveProvider`, `validateProviderProfile`, `buildProviderProfile`, `buildProviderSetupPatch`, `checkSettingsDocument`, `buildProviderProfilesSnapshot`, `testProviderProfileCommand`). With none, every reference reads as unset instead of falling back to `process.env`: `resolveEnvDefaultProvider` finds no provider, `readProviderSettings` throws `ProviderConfigError`, and a profile whose credential is an unset reference fails its credential check. `TProviderEnvironment` and `resolveProviderEnvironment` are exported for a host that builds its own. A session reads its `environment` option, then `host.env`. `@robota-sdk/agent-cli` always passes its environment snapshot; a host that passed none to the workflows commands gets the unset behaviour.
  - Org policy and settings check: `loadOrgPolicy` and `checkNodeHostSettingsFile` read files, so they moved to `@robota-sdk/agent-framework/node`. `formatOrgPolicyViolationMessage`, `isApiKeyPlaintext` and `checkSettingsDocument` stay on the main entry.
  - Plugins: `fs` is required, with no `NodeFileSystem` default, on `BundlePluginLoader` (third argument, after `enabledPlugins`, which may be `undefined`), `BundlePluginInstaller`, `MarketplaceClient`, `NodeHostPluginSettingsStore`, `createHostBundlePluginLoader`, `loadHostBundlePluginsFromScopes` and `loadHostBundlePluginInspectionFromScopes`, whose options are now required. Each refuses at construction without it, naming `NodeFileSystem`. A registry record refused as outside the plugin root was written to `process.stderr`; it goes to the new `onWarning` option, or the library logger when there is none. `TExecFn` returns `string | Uint8Array` instead of `string | Buffer`. A session whose `pluginDirectories` are set needs `host.files`, and throws at construction without it.
  - User-local: `fsAsync` is required on the memory and storage functions, and `activeRepositoryRoot` must be absolute (a relative one used to be resolved against the process directory). A storage root inside a repository directory whose name starts with two dots is now refused. The absolute check accepts either platform's spelling (`/x`, `C:\x`, `\\srv\share`) and does not know which one this host is, so a Node root resolves its path first, as `@robota-sdk/agent-cli` now does; a Windows `\x` otherwise takes its drive from the process and is refused as relative, and on POSIX `C:\x` is accepted as the absolute path it spells.
  - `@robota-sdk/agent-framework/node` exports `NodeFileSystem` and `NodeFileSystemAsync`.
  - `@robota-sdk/agent-command`: the provider commands (`IProviderCommandModuleOptions.env`, `providerEnvironment` of the default command modules, the startup `env`) take a map or a resolver, and no longer read `process.env` when there is none; `/provider add` with a `$ENV:` key now checks it against the same environment `buildProviderSetupPatch` does.
  - `@robota-sdk/agent-cli`, `@robota-sdk/agent-command`: pass `NodeFileSystem`, `NodeFileSystemAsync` and a stderr `onWarning` where they compose these modules, so their behaviour is unchanged; the user-local storage root is resolved against the platform before the framework sees it.
- a2d36ea: Make the settings, contribution-root and transport-settings modules of the framework platform-neutral. Settings layers and stores on the main entry no longer open a settings file; they ask the host for text and for a store, and the file-backed halves moved to `@robota-sdk/agent-framework/node`. Plugin enablement still works on the user settings file by the source's `path`, through an `IFileSystem`, so a user source with no `path` enables no plugins.

  - Settings sources: a host source is now `IHostSettingsSource` (replacing `INodeHostSettingsSource`) with `kind`, `scope`, `displayName`, an optional `path` and a required `read()` that returns the document's text, `undefined` when it does not exist, and throws when it exists but cannot be read. `readSettingsSourceText` and every settings layer read through it, so an absent, empty, corrupt or unreadable layer is classified and refused exactly as a file layer is. A host with no file system passes its own sources and stores. `createNodeHostSettingsSource` and `createNodeHostSettingsStore` moved to `/node`; the Node source reads the file the way it always did, and the store still writes owner-only.
  - Settings files: `readSettings`, `writeSettings`, `updateModelInSettings`, `deleteSettings` and `resetUserConfig` (with `IResetUserConfigResult`) moved to `/node`, unchanged. `TSettingsData` is exported from the module that defines `ISettingsDocumentStore`, and `TSettingsScope` from the scope types; both stay on the main entry.
  - `applyStatusLineSettings` and `applyAppearanceSettings` take an `ISettingsDocumentStore` instead of a settings file path, so they read and write through whatever store the host built. `@robota-sdk/agent-cli` passes a `createNodeHostSettingsStore` over the product's user settings file.
  - Contribution roots: `createNodeHostContributionSource` and `createDefaultUserContributionSources` moved to `/node`. `createContributionSourcesForProjectAccess(access, userSources)` takes the user `IContributionSource[]` the caller built, where it took a home directory and built the Node source itself; with none, a session has the trusted project's sources only.
  - Transport settings: `TransportRegistry` takes an `ITransportSettingsRepository` only. A file path string is no longer accepted; pass `createFileTransportSettingsRepository(path)` from `/node`. `createMemoryTransportSettingsRepository` stays on the main entry.
  - `readPackageVersion` moved to `/node`.
  - `@robota-sdk/agent-command`: the doctor names a host settings source that has no `path` by a slug of its `displayName` (`settings.<scope>.<slug>`, `settings.user.unnamed` when the name has no letters or digits), labels the check with that name, reports no path for it and never offers a repair for it. A source with a `path` is unchanged.
  - `@robota-sdk/agent-cli`, `@robota-sdk/agent-ui-terminal`: import the moved symbols from `/node`; behaviour is unchanged.

### Patch Changes

- fab48ad: The CLI keeps spilled tool results and the `/editor` buffer in owner-only, per-process directories of its state root instead of the shared operating-system temporary directory. They are removed when the run ends, including on a hangup, interrupt or termination, and the next start removes those a killed run left behind.

  `NodeToolResultSpillStore` and `createNodeToolResultSpillStore` take a `parentDirectory`: an existing owner-only directory the host owns, used as it is. A store there records its owner, is removed when the process ends without `shutdown()`, and can be cleaned up after a kill with the new `sweepStaleToolResultSpillDirectories(parent)`. The process-scoped directory helpers behind this are exported from `@robota-sdk/agent-core/node`.
- Updated dependencies [bc8de21]
- Updated dependencies [51ad6a4]
- Updated dependencies [d46727b]
- Updated dependencies [bc8de21]
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
- Updated dependencies [04c3233]
- Updated dependencies [9bc13f9]
- Updated dependencies [830d3d2]
- Updated dependencies [0a677e9]
- Updated dependencies [a8c9e25]
- Updated dependencies [5b46d43]
- Updated dependencies [fab48ad]
- Updated dependencies [a2d36ea]
- Updated dependencies [ea0e424]
- Updated dependencies [ee7f7ef]
- Updated dependencies [a2d36ea]
- Updated dependencies [0fec62f]
- Updated dependencies [7ce5e73]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [0fec62f]
- Updated dependencies [be32d9b]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [b7b6cd0]
- Updated dependencies [8069d0e]
- Updated dependencies [f5e3057]
- Updated dependencies [d8cb04f]
- Updated dependencies [42d595e]
- Updated dependencies [0a677e9]
- Updated dependencies [44e9640]
- Updated dependencies [b56b5a9]
- Updated dependencies [1c19435]
- Updated dependencies [4e4c92a]
- Updated dependencies [6ba10ef]
  - @robota-sdk/agent-core@3.1.0
  - @robota-sdk/agent-framework@3.1.0
  - @robota-sdk/agent-interface-session@3.1.0
  - @robota-sdk/agent-interface-execution@3.1.0
  - @robota-sdk/agent-preset@3.1.0
  - @robota-sdk/agent-interface-command@3.1.0

## 3.0.7
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.7
  - @robota-sdk/agent-preset@3.0.7
  - @robota-sdk/agent-core@3.0.7
  - @robota-sdk/agent-interface-command@3.0.7
  - @robota-sdk/agent-interface-execution@3.0.7
  - @robota-sdk/agent-interface-session@3.0.7

## 3.0.6
### Patch Changes

  - @robota-sdk/agent-framework@3.0.6
  - @robota-sdk/agent-preset@3.0.6
  - @robota-sdk/agent-core@3.0.6
  - @robota-sdk/agent-interface-command@3.0.6
  - @robota-sdk/agent-interface-execution@3.0.6
  - @robota-sdk/agent-interface-session@3.0.6

## 3.0.5
### Patch Changes

  - @robota-sdk/agent-core@3.0.5
  - @robota-sdk/agent-framework@3.0.5
  - @robota-sdk/agent-interface-command@3.0.5
  - @robota-sdk/agent-interface-execution@3.0.5
  - @robota-sdk/agent-interface-session@3.0.5
  - @robota-sdk/agent-preset@3.0.5

## 3.0.4
### Patch Changes

  - @robota-sdk/agent-core@3.0.4
  - @robota-sdk/agent-framework@3.0.4
  - @robota-sdk/agent-interface-command@3.0.4
  - @robota-sdk/agent-interface-execution@3.0.4
  - @robota-sdk/agent-interface-session@3.0.4
  - @robota-sdk/agent-preset@3.0.4

## 3.0.3
### Patch Changes

  - @robota-sdk/agent-core@3.0.3
  - @robota-sdk/agent-framework@3.0.3
  - @robota-sdk/agent-interface-command@3.0.3
  - @robota-sdk/agent-interface-execution@3.0.3
  - @robota-sdk/agent-interface-session@3.0.3
  - @robota-sdk/agent-preset@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/agent-core@3.0.2
  - @robota-sdk/agent-framework@3.0.2
  - @robota-sdk/agent-interface-command@3.0.2
  - @robota-sdk/agent-interface-execution@3.0.2
  - @robota-sdk/agent-interface-session@3.0.2
  - @robota-sdk/agent-preset@3.0.2

## 3.0.1
### Patch Changes

  - @robota-sdk/agent-core@3.0.1
  - @robota-sdk/agent-framework@3.0.1
  - @robota-sdk/agent-interface-command@3.0.1
  - @robota-sdk/agent-interface-execution@3.0.1
  - @robota-sdk/agent-interface-session@3.0.1
  - @robota-sdk/agent-preset@3.0.1

## 3.0.0
### Major Changes

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
    reason that names the grant and no configured value. `robota --external-event-grant <file>` (TUI) and
    `robota session start --background --external-event-grant <file>` open every grant or fail the start; a
    background session receives its grants through a private file, opens them before it reports ready, and the
    launcher refuses a readiness that names other grants. `robota session events list <id> [--json]` and
    `robota session events revoke <id> <grant-id>` work over the generation-bound control socket, and
    `robota session list --format json` shows each grant's counts. The retired `--external-event-allow` now points
    at `--external-event-grant`.
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
- d4189b9: The rest of the per-server MCP OAuth lifecycle: signing in to a server without a local browser,
  signing out of it with token revocation, and each server's sign-in state in `/mcp`.

  - **`robota mcp login <name> --no-browser`** prints the authorization URL and reads the redirect URL
    the user pastes back (not echoed). `runMCPOAuthLogin` takes `readRedirect` for this; nothing
    listens on the redirect URI then. The pasted URL is held to the loopback listener's rules through
    `createPastedRedirectAcceptor`: it must be the registered redirect URI (same origin and path, no
    user info), carry the sign-in's `state` (compared in constant time), and is accepted once; an
    error redirect is `authorization-denied` without its `error_description`, and the RFC 9207 `iss`
    check applies as before. `openBrowser` now also receives the redirect URI. `readRedirect` gets a
    signal that aborts on cancel or at `callbackTimeoutMs` (5 minutes by default, as for the loopback
    listener); a paste longer than the prompt accepts fails as `redirect-too-long`.
  - **Signing out** (`runMCPOAuthLogout`; `robota mcp logout <name>`; `/mcp logout <serverId>`):
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
  - **No in-session sign-in:** signing in stays `robota mcp login <server>` in a terminal, since it
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
- af2f2ad: `/cd <directory>` continues the conversation in another directory.

  - **A move is a new session in the target directory.** In the TUI, the configured CLI saves a copy of the
    conversation where the target's session store will find it, ends the current run through its
    normal end-of-life flow, and starts again in the target directory resuming that copy. The target's
    settings, trust decision, tools, skills and `AGENTS.md` apply, exactly as if the configured CLI had been
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
    `robota doctor` and in `/sandbox`, and commands then run unconfined.
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
- 28fa8a7: `/devices add` and `/devices join` enrol a new device into your devices.

  - On a device that holds the signing key, `/devices add` shows a one-time code on the terminal. It
    works once, for five minutes.
  - On the new device, `/devices join [name]` asks for the code on the terminal, creates the device's
    keys, and meets the other device through the signaling relay in
    `transports.webrtc.options.relayUrl`. Both devices need that setting.
  - The new device proves the code over the WebRTC connection's DTLS fingerprints before anything else
    crosses, so a relay in the middle cannot enrol anyone.
  - Both devices then show the same six digits, and both operators compare them and confirm. Someone
    who saw the code cannot choose the digits: the new device commits to its part before it sees the
    existing device's.
  - Only when both operators say yes does the existing device certify the new one and issue a new
    roster. The new device keeps its identity only once the chain it receives verifies.
  - A wrong, expired or already used code is refused. So is a code after a few failed attempts. When
    either operator declines, nothing is issued or kept.
  - The code appears only on the two terminals. It never reaches history, transcripts or the model. A
    code typed as a command argument is refused. Both commands stay user-only and refuse remote
    surfaces.
  - `agent-remote-pairing`: enrollment codes, the enrollment proof, the signed request with its
    commitment, the short authentication string and the frame decoder.
  - `agent-transport-webrtc`: `dialEnrollment` and `listenForEnrollment` provide a data channel bound to
    the negotiated fingerprints.
- 44fc732: Add `/devices` for this device's identity among the user's devices: `list`, `init` (creates the identity: a recovery phrase, the master-certified signing key, this device's keys and certificate, the first roster and revocation list), `revoke <device-id>` (signing key only, no phrase; confirmed at the terminal) and `recover` (rotates the signing key from the phrase and revokes the old ones). Enrolling another device (`add` / `join`) comes with the device connection.

  The recovery phrase never enters the session: it is shown once and read with no echo on the controlling terminal (opened apart from the session's input), on the alternate screen that is cleared afterwards, and never reaches prompt history, conversation history, transcripts, traces or the model. Without an interactive terminal the phrase commands refuse. `/devices` is operator-only: never model-invocable and refused from remote surfaces. Private keys live in the host credential store; certificates, roster, revocation lists and sequence marks are kept in owner-only files under `the configured user data directory`.

  `agent-remote-pairing` adds `isRecoveryPhraseWord`, so a phrase can be checked one word at a time.
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
- c7f9203: Connected sessions can send each other files.

  - `/peers send-file <session-id> <path>` sends a copy of any file the operator can read to another
    live session on this host.
  - The model sends a file only through the `peer_send_file` tool. Every call asks the user, showing
    the path, size, hash and destination; no permission mode, rule or remembered consent answers it.
    The tool reaches only files inside the workspace whose path does not look like it holds secrets
    (`.env*`, `~/.ssh`, keys and credentials), and it does not exist in a turn a peer's message started.
  - The receiving operator approves every file. A received file is kept as an inert copy (mode 0600)
    under `the configured user data directory<sender>/`. It is never run and never placed in the model's context.
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
- 004fe7f: `/handoff` moves a session over a real connection.

  - `/handoff <session-id>` pushes this conversation to another the agent runtime session on this machine. The
    same carrier also runs between two of the user's devices over their mesh connection; no command
    opens that connection yet.
  - A hand-off is push-only: only the operator of the session that holds it starts one. A session or
    device that asks another for its session is refused.
  - The source signs a grant for that one transfer over that one channel with its device key, so a
    hand-off needs the device identity from `/devices init`. The receiving side checks it against the
    sender's certificate, then asks its own operator; without a yes nothing is sent.
  - The session travels on the file-transfer carrier, is kept aside until it matches the manifest, and
    is saved without being started. The operator there resumes it with `robota --resume <id>`.
  - The source gives the session up, and ends, only once the receiving side confirms it saved it.
    Every other outcome leaves the session where it was; if the confirmation is lost, `/handoff` to the
    same session again resends the same transfer, which the receiver settles without saving it twice.
    Peer attribution (`driverId`, `turnSource`)
    travels with it.
  - `/handoff` stays user-only. Its description tells the model to suggest the command to the user.
  - `agent-transport-webrtc`: an admitted mesh link exposes the DTLS fingerprints it is bound to, and
    `judgeHandoffGrant` is exported.
  - `agent-interface-session-mobility`: a hand-off carrier may move the sealed payload whole
    (`sendPayload`), the destination verifies it with `receivePayload`, and the source can report its
    open transfer (`status`) and abandon it for any refusal the destination names.
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
- 9843fe6: Sign in to a remote MCP server from inside a session, and use its tools without restarting.

  - **`/mcp login <server> [--no-browser]`** runs the same per-server OAuth sign-in as
    `robota mcp login` (discovery checks, PKCE, `state`, RFC 9207 `iss`, RFC 8707 resource, the
    loopback listener, the lock-guarded store). It opens the browser through the argv opener; with
    `--no-browser`, or when no browser can be opened, it shows the authorization URL and asks for the
    redirect URL in the session's own prompt (masked), held to the same rules as a pasted redirect in
    the terminal. A failed, refused, timed-out or cancelled sign-in changes nothing and is reported by
    a fixed reason only. `/mcp login <server> --client-secret` is refused: a secret is never typed into
    a session, and `robota mcp login <server> --client-secret` is named instead (also after a failed
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
    `robota mcp login <server>` in a terminal; the server's name is shown only when it is safe to paste
    into any shell, otherwise `<server>`.
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
- 5bb675a: Provider commands check a profile's `$ENV:` or default credential against the host's environment snapshot, so `/provider switch`, `/provider test`, `/provider add`, `/provider edit` and a cross-profile `/model` keep working while the runtime withholds its own credentials from `process.env`.

  - `IProviderCommandModuleOptions` takes an optional `env`, and `createDefaultCommandModules` takes `providerEnvironment`. The CLI passes its startup snapshot.
  - The git that isolated subagents run, and so the repository's hooks, now get the command environment instead of the full snapshot.
- 2d3b2c0: ARCH-024 replaces framework knowledge of command-owner ids with optional, owner-declared semantic
  roles. `ISystemCommand` can declare `skillActivation`, `contextReduction`, or `subagentSpawn`;
  `SystemCommandExecutor` exposes the selected role projection and rejects duplicate owners with the
  typed `DuplicateSystemCommandSemanticRoleError`, atomically across construction, registration, and
  replacement.

  This is a beta-line breaking contract correction: unannotated commands named `skills`, `compact`, or
  `agent` no longer receive special framework behavior. `@robota-sdk/agent-command` now declares the
  roles on its shipped skills, compact, and agent commands.
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
- 44393be: Add the `/remote-control` enable path (REMOTE-008 Stage B4-2b) — turn on P2P remote control locally, get
  a QR + link, and a paired device co-drives the SAME live session over pairing-gated WebRTC. The command
  is a declarative trigger returning `remote-control-enable-requested`/`-stop-requested` effects (SSOT
  agent-interface-transport) and reads state via a new `ICommandHostAdapters.remoteControl.getStatus()`;
  the TUI dispatches the effects to injected callbacks; all transport construction lives at the agent-cli
  composition root (`WsSignalingClient` + pairing-gated `WebRtcTransport`, relay URL from
  `transports.webrtc.options.relayUrl`, QR/link rendered into history). Fail-closed: no relay configured ⇒
  does nothing; pairing mismatch/timeout ⇒ the session is never exposed. Consumes REMOTE-007 so a paired
  remote owner answers their own permission/ask prompts over the WebRTC channel.
- cbee54e: Surface unmatched preset command-module names instead of silently dropping them (INFRA-032). A preset `enabledCommandModules`/`disabledCommandModules` entry that matches no built command module — a short form like `"editor"` instead of `agent-command-editor`, or a typo — is now reported as a non-fatal notice on both the startup `--preset` path (CLI terminal) and the in-session `/preset` path (command result). Detection lives once in agent-framework's new pure `findUnknownModuleNames`, and agent-command's duplicate module filter now delegates to the framework's `selectCommandModules`; `createDefaultCommandModules` returns `{ modules, unknownModuleNames }`.

### Patch Changes

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
- ec5e477: Add a credential store port (`ICredentialStore` in `agent-core`) and keep the CLI's secrets behind it: the OS keychain through the optional `@napi-rs/keyring` binding (macOS Keychain, Windows Credential Manager, Linux Secret Service), else an owner-only file under `the configured user data directory`. The backend is chosen at first use, recorded, and named by `/remote-control status`; a recorded keychain that stops working fails closed instead of degrading to the file.

  The remote-control host identity key moves into the store. The old `the configured user data directory` may have been copied by backups or dotfile sync, so it is not carried over: on the first run after upgrading a new host key is generated, the old file is removed, and the operator is told once that trusted devices must pair again.
- e15e22b: Two of one user's devices can connect to each other over WebRTC, admitted by the device handshake.

  - `agent-transport-webrtc` — `DeviceMeshNode` keeps one connection per device pair, in either role: the
    device with the lower id offers and the other answers, so concurrent attempts resolve by rule. Both
    roles bind the handshake to the certificate the DTLS layer verified and take one remote description
    with exactly one fingerprint; before admission only handshake frames cross, and a connection counts
    as admitted only once both sides admitted each other. Each connection gets its own DTLS certificate
    (`createDtlsKeys`). A new attempt never displaces an admitted connection until it is admitted
    itself, and attempts per pair are paced. Lists adopted in a handshake, or handed over through
    `refresh`, apply at once, and a device they revoke loses its connection. Signaling runs through
    `IMeshRelay`: `WsMeshRelayClient` for the self-hosted relay's `presence` / `message` frames
    (topics capped per source and relay-wide), `createInMemoryMeshRelayHub` for tests.
  - `agent-remote-pairing` — the pair's two relay inbox topics, one per direction, come from their
    pairwise secret (`derivePairRendezvous(...).relayInbox()`).
  - `agent-cli` — a device holding the signing key reissues its roster and revocation list before they
    expire while an interactive session runs. The host can open this device's mesh endpoint from the
    identity under `the configured user data directory`, saving newer lists a peer hands over; no command starts it yet.
  - `agent-command` — `/devices add|join` still reports that enrolment is not available yet.
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
- caaab20: `/rewind` works again. Every session the CLI builds for a trusted workspace captures edit
  checkpoints; before, none did, and `/rewind` failed everywhere with "Edit checkpoints require
  project authority."

  - `agent-cli` (patch): a trusted workspace composes an edit checkpoint store for the terminal UI, a
    print run, a served runtime and each session a daemon keeps live. Every session gets its own
    store, pooled or switched to in the terminal UI, since two can run turns at the same time. On a host that cannot prove a project write
    stays inside the project (every platform but Linux), none is composed: a checkpoint could be
    neither saved nor restored there.
  - `agent-command` (patch): where a session has no checkpoints, `/rewind` says why: a restricted
    workspace is told to run `robota trust --yes` and restart the configured CLI, and a host that cannot write
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
- 3c1967f: Reloading plugins updates the live session's skill routing and model skill catalogue together
  with command completion. Disabled plugins stop being executable after reload, and unreadable
  settings clear the plugin skill snapshot. Hook changes require a new session.
- db35dcd: MCP approvals now outlive the process, and an approval takes effect at once. The configured CLI keeps
  activation decisions in `the configured user data directory` (owner-only) unless the host passes its own
  `mcpApprovalStore`, so an approved server connects at later starts until its definition changes.
  `/mcp approve <server>` now also connects the server in the running session, the way `/mcp reload`
  does, instead of waiting for a restart. A remote server without OAuth therefore connects once
  approved; stdio servers still need a host-supplied authority.
- 4cee6fb: Report unsupported MCP transports at startup and reload instead of silently skipping them,
  and distinguish plugin MCP declaration inspection from a runtime connection.
- 043fd27: In `plan` mode the model can no longer save project memory with `/memory add`. The command is auto-approved, so it ran in plan mode while `Write` and `Edit` were denied there. Reading memory, and adding it by hand, still work in plan mode.
- 6ee8725: A user settings file that does not parse no longer reads as "no plugin is disabled". Plugin settings
  now refuse to read it: no plugin loads (skills, commands, hooks and themes alike), a plugin command
  such as `/plugin enable` fails instead of rewriting the whole settings file with the plugin keys
  alone, and `robota doctor` reports the plugin check as failed while still inspecting each installed
  plugin. The CLI already refuses to start with such a file; this covers a session started later in
  the same process.
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
- 2c612ba: Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 7116367: Credentials the runtime holds for itself no longer reach the commands it runs.

  - `agent-cli` — once a workspace's settings are admitted, every variable a provider profile or
    definition names as its credential (`$ENV:` references, and defaults such as `OPENAI_API_KEY`)
    leaves the process environment, so tools, hooks, background shells, a skill's `!` commands and
    the environment an MCP header helper inherits no longer carry it, a hosted worker's broker token
    included (a variable an MCP definition references explicitly still resolves); the provider keeps
    authenticating from the startup snapshot. A user or managed settings layer can let
    commands see one with `"commandEnvAllow": ["NAME"]`; project settings cannot. With the OS sandbox
    on, confined commands can no longer read `settings.json`, `credentials/`, `mcp-credentials/` or
    `remote-host-identity.json` under the user state directory. **Behavior change:** a command that
    relied on inheriting a provider key now needs the opt-in, and a host embedding `startCli` finds
    those variables gone from its own `process.env` afterwards — a later in-process call must pass them
    in its `environment`.
  - `agent-framework` — the settings schema gains `commandEnvAllow`; `checkSettingsDocument` and
    `buildProviderProfilesSnapshot` take an optional environment map to resolve `$ENV:` references
    against instead of the live process environment.
  - `agent-command` — provider startup checks credentials against the host's environment snapshot.
  - `agent-tools` — `OsSandboxClient` takes `hiddenPaths`, always hidden from confined commands and
    not changeable by sandbox settings.
  - `agent-subagent-runner` — a child-process subagent removes its provider credential variable from
    its own environment once its provider is built, unless the start payload says the owner opted it in
    (`keepProviderCredential`).
  - `dag-node-instant-node` — prompt nodes accept an env resolver (`createPromptBackedNodeDefinition`'s
    third argument, `rehydrateInstantNode`'s `resolveEnv`) for their `$ENV:` credential default.
  - `agent-command-workflows` — `/workflows create` and `/workflows run` resolve prompt-node credentials
    from the host's environment snapshot.
- 7d9cc66: Keep host-declared inline human controls reachable during active turns. Plugin disable and uninstall can withdraw future dispatch without changing model invocation or host command policy.
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
- 7d9cc66: Allow authenticated attached users to correct and forget project memory while preserving host remote-command policy and rejecting model curation.
- b330269: Align command test fixtures with the core run-loop state contract.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- 7d9cc66: Add user-only project memory topic correction and forgetting, prevent automatic restoration after restart, refresh retained startup context, and reconcile semantic recall with current durable source content.
- df02568: Local OpenAI-compatible servers can be set up without saving a placeholder API key. Explicit credentials and environment references remain effective for authenticated servers and connection tests. Optional credentials are managed through the user-only provider edit command.
- 7d9cc66: Add explicit MCP Skills selection, bounded supervisor access and persistent host content consent.
  Users can inspect verified instructions, approve the exact content fingerprint and withdraw consent;
  models can discover metadata only. Consent stays separate from server admission and model-turn activation.
- 7d9cc66: Route discovered MCP Skills through the shared skill command runtime with lazy verified content, source-bound invocation names, current user consent and execution-owned activation cleanup. Keep remote shell expressions inert and defer queued user skill reads until their own turn executes.
- dfb9b15: Release the integrated provider credential isolation and consumer runtime and interaction composition updates.
- d6b9404: Remove polynomial-ReDoS backtracking (SEC-003, CodeQL `js/polynomial-redos`) from three parsers whose input is not repo-controlled.

  `parseStructuredResponseText` (agent-core) parses raw model output; its fenced-code-block regex used `\s*\n`, and because `\s` also matches a newline the two overlapped, so an unterminated fence containing many blank lines was rejected in O(n^2) — 12.7s for a 400 KB string, now ~1ms. The whitespace run is now restricted to horizontal whitespace, which makes the newline split point unique.

  `/schedule cron` and `/monitor` (agent-command) are declared `modelInvocable: true`, so their argument string is composed by the model. Both matched the trailing instruction with `\s+(.+)$`; since `.` also matches a space the split point was ambiguous and a non-matching argument cost O(n^2) — ~15s for a 200 KB argument, now <1ms. The instruction is now required to start with a non-space character, which pins the split point without changing which inputs are accepted.

  No behaviour change: the set of accepted inputs and the parsed values are identical in every case.
- 7d9cc66: Expose verified skill supporting resources only within their owning turn or fork, using the current host consent and manifest.
- 02053ec: Leave unregistered DeepSeek model costs unknown instead of applying unrelated legacy model prices.
- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [08a9bd6]
- Updated dependencies [37b4bd7]
- Updated dependencies [818f0c8]
- Updated dependencies [4eea54b]
- Updated dependencies [3c81769]
- Updated dependencies [724fabb]
- Updated dependencies [997f2fb]
- Updated dependencies [bfe8ed5]
- Updated dependencies [1698be4]
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
- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [4dd45cc]
- Updated dependencies [e689c8e]
- Updated dependencies [4241fc5]
- Updated dependencies [ec5e477]
- Updated dependencies [4f49d14]
- Updated dependencies [007fd90]
- Updated dependencies [c7f9203]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [9721162]
- Updated dependencies [be0e53c]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [7d77ce4]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
- Updated dependencies [caaab20]
- Updated dependencies [f01868f]
- Updated dependencies [e8779c9]
- Updated dependencies [5a0ee96]
- Updated dependencies [9f46375]
- Updated dependencies [4e11579]
- Updated dependencies [41cca13]
- Updated dependencies [193a0bc]
- Updated dependencies [54e2848]
- Updated dependencies [3c1967f]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [5684612]
- Updated dependencies [6ee8725]
- Updated dependencies [6072e9a]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
- Updated dependencies [2e07cad]
- Updated dependencies [e8d70ac]
- Updated dependencies [2c612ba]
- Updated dependencies [66af868]
- Updated dependencies [e079992]
- Updated dependencies [7116367]
- Updated dependencies [5bb675a]
- Updated dependencies [e706b43]
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [6f41c53]
- Updated dependencies [7d9cc66]
- Updated dependencies [378c585]
- Updated dependencies [4c5148e]
- Updated dependencies [37af5dc]
- Updated dependencies [807d161]
- Updated dependencies [fec722f]
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
- Updated dependencies [9fbab1b]
- Updated dependencies [d312755]
- Updated dependencies [a009f5b]
- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [7d9cc66]
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
- Updated dependencies [7d9cc66]
- Updated dependencies [fe48835]
- Updated dependencies [7d9cc66]
- Updated dependencies [1e40b5b]
- Updated dependencies [bad976f]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
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
- Updated dependencies [9c6a8db]
- Updated dependencies [dfb9b15]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [5134b3b]
- Updated dependencies [dd444c1]
- Updated dependencies [1f57e7f]
- Updated dependencies [7911a7d]
- Updated dependencies [833afe1]
- Updated dependencies [d6b9404]
- Updated dependencies [7863b16]
- Updated dependencies [fde558e]
- Updated dependencies [db5c439]
- Updated dependencies [7d9cc66]
- Updated dependencies [62663ae]
- Updated dependencies [4a01a87]
- Updated dependencies [9c6a8db]
- Updated dependencies [cbee54e]
- Updated dependencies [23a30cd]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [9814afc]
- Updated dependencies [7d9cc66]
- Updated dependencies [02053ec]
- Updated dependencies [242a644]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-interface-execution@3.0.0
  - @robota-sdk/agent-interface-command@3.0.0
  - @robota-sdk/agent-framework@3.0.0
  - @robota-sdk/agent-core@3.0.0
  - @robota-sdk/agent-interface-session@3.0.0
  - @robota-sdk/agent-preset@3.0.0

## 3.0.0-beta.106
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.106
  - @robota-sdk/agent-framework@3.0.0-beta.106
  - @robota-sdk/agent-interface-command@3.0.0-beta.106
  - @robota-sdk/agent-interface-execution@3.0.0-beta.106
  - @robota-sdk/agent-interface-session@3.0.0-beta.106
  - @robota-sdk/agent-preset@3.0.0-beta.106

## 3.0.0-beta.105
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.105
  - @robota-sdk/agent-framework@3.0.0-beta.105
  - @robota-sdk/agent-interface-command@3.0.0-beta.105
  - @robota-sdk/agent-interface-execution@3.0.0-beta.105
  - @robota-sdk/agent-interface-session@3.0.0-beta.105
  - @robota-sdk/agent-preset@3.0.0-beta.105

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.104
  - @robota-sdk/agent-framework@3.0.0-beta.104
  - @robota-sdk/agent-interface-command@3.0.0-beta.104
  - @robota-sdk/agent-interface-execution@3.0.0-beta.104
  - @robota-sdk/agent-interface-session@3.0.0-beta.104
  - @robota-sdk/agent-preset@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

- Updated dependencies [6f41c53]
  - @robota-sdk/agent-core@3.0.0-beta.103
  - @robota-sdk/agent-framework@3.0.0-beta.103
  - @robota-sdk/agent-interface-command@3.0.0-beta.103
  - @robota-sdk/agent-interface-execution@3.0.0-beta.103
  - @robota-sdk/agent-interface-session@3.0.0-beta.103
  - @robota-sdk/agent-preset@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.102
  - @robota-sdk/agent-framework@3.0.0-beta.102
  - @robota-sdk/agent-interface-command@3.0.0-beta.102
  - @robota-sdk/agent-interface-execution@3.0.0-beta.102
  - @robota-sdk/agent-interface-session@3.0.0-beta.102
  - @robota-sdk/agent-preset@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

- Updated dependencies [62663ae]
  - @robota-sdk/agent-core@3.0.0-beta.101
  - @robota-sdk/agent-framework@3.0.0-beta.101
  - @robota-sdk/agent-interface-command@3.0.0-beta.101
  - @robota-sdk/agent-interface-execution@3.0.0-beta.101
  - @robota-sdk/agent-interface-session@3.0.0-beta.101
  - @robota-sdk/agent-preset@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.100
  - @robota-sdk/agent-framework@3.0.0-beta.100
  - @robota-sdk/agent-interface-command@3.0.0-beta.100
  - @robota-sdk/agent-interface-execution@3.0.0-beta.100
  - @robota-sdk/agent-interface-session@3.0.0-beta.100
  - @robota-sdk/agent-preset@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.99
  - @robota-sdk/agent-framework@3.0.0-beta.99
  - @robota-sdk/agent-interface-command@3.0.0-beta.99
  - @robota-sdk/agent-interface-execution@3.0.0-beta.99
  - @robota-sdk/agent-interface-session@3.0.0-beta.99
  - @robota-sdk/agent-preset@3.0.0-beta.99

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.98
  - @robota-sdk/agent-framework@3.0.0-beta.98
  - @robota-sdk/agent-interface-command@3.0.0-beta.98
  - @robota-sdk/agent-interface-execution@3.0.0-beta.98
  - @robota-sdk/agent-interface-session@3.0.0-beta.98
  - @robota-sdk/agent-preset@3.0.0-beta.98

## 3.0.0-beta.97
### Patch Changes

- Align command test fixtures with the core run-loop state contract.
- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [7911a7d]
- Updated dependencies [23a30cd]
  - @robota-sdk/agent-core@3.0.0-beta.97
  - @robota-sdk/agent-interface-session@3.0.0-beta.97
  - @robota-sdk/agent-framework@3.0.0-beta.97
  - @robota-sdk/agent-interface-command@3.0.0-beta.97
  - @robota-sdk/agent-interface-execution@3.0.0-beta.97
  - @robota-sdk/agent-preset@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.96
  - @robota-sdk/agent-framework@3.0.0-beta.96
  - @robota-sdk/agent-interface-command@3.0.0-beta.96
  - @robota-sdk/agent-interface-execution@3.0.0-beta.96
  - @robota-sdk/agent-interface-session@3.0.0-beta.96
  - @robota-sdk/agent-preset@3.0.0-beta.96

## 3.0.0-beta.95
### Patch Changes

- 02053ec: Leave unregistered DeepSeek model costs unknown instead of applying unrelated legacy model prices.
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-interface-session@3.0.0-beta.95
  - @robota-sdk/agent-framework@3.0.0-beta.95
  - @robota-sdk/agent-core@3.0.0-beta.95
  - @robota-sdk/agent-preset@3.0.0-beta.95
  - @robota-sdk/agent-interface-command@3.0.0-beta.95
  - @robota-sdk/agent-interface-execution@3.0.0-beta.95

## 3.0.0-beta.94
### Patch Changes

- Updated dependencies [e079992]
- Updated dependencies [e706b43]
  - @robota-sdk/agent-framework@3.0.0-beta.94
  - @robota-sdk/agent-preset@3.0.0-beta.94
  - @robota-sdk/agent-interface-session@3.0.0-beta.94
  - @robota-sdk/agent-core@3.0.0-beta.94
  - @robota-sdk/agent-interface-command@3.0.0-beta.94
  - @robota-sdk/agent-interface-execution@3.0.0-beta.94

## 3.0.0-beta.93
### Patch Changes

- Release the integrated provider credential isolation and consumer runtime and interaction composition updates.
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.93
  - @robota-sdk/agent-framework@3.0.0-beta.93
  - @robota-sdk/agent-interface-execution@3.0.0-beta.93
  - @robota-sdk/agent-interface-command@3.0.0-beta.93
  - @robota-sdk/agent-interface-session@3.0.0-beta.93
  - @robota-sdk/agent-preset@3.0.0-beta.93

## 3.0.0-beta.92
### Patch Changes

- Local OpenAI-compatible servers can be set up without saving a placeholder API key. Explicit credentials and environment references remain effective for authenticated servers and connection tests. Optional credentials are managed through the user-only provider edit command.
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.92
  - @robota-sdk/agent-framework@3.0.0-beta.92
  - @robota-sdk/agent-interface-command@3.0.0-beta.92
  - @robota-sdk/agent-interface-execution@3.0.0-beta.92
  - @robota-sdk/agent-interface-session@3.0.0-beta.92
  - @robota-sdk/agent-preset@3.0.0-beta.92

## 3.0.0-beta.91
### Patch Changes

- Updated dependencies [bad976f]
  - @robota-sdk/agent-framework@3.0.0-beta.91
  - @robota-sdk/agent-preset@3.0.0-beta.91
  - @robota-sdk/agent-core@3.0.0-beta.91
  - @robota-sdk/agent-interface-command@3.0.0-beta.91
  - @robota-sdk/agent-interface-execution@3.0.0-beta.91
  - @robota-sdk/agent-interface-session@3.0.0-beta.91

## 3.0.0-beta.90
### Minor Changes

- 5bb675a: Provider commands check a profile's `$ENV:` or default credential against the host's environment snapshot, so `/provider switch`, `/provider test`, `/provider add`, `/provider edit` and a cross-profile `/model` keep working while the runtime withholds its own credentials from `process.env`.

  - `IProviderCommandModuleOptions` takes an optional `env`, and `createDefaultCommandModules` takes `providerEnvironment`. The CLI passes its startup snapshot.
  - The git that isolated subagents run, and so the repository's hooks, now get the command environment instead of the full snapshot.

### Patch Changes

- 7116367: Credentials the runtime holds for itself no longer reach the commands it runs.

  - `agent-cli` — once a workspace's settings are admitted, every variable a provider profile or
    definition names as its credential (`$ENV:` references, and defaults such as `OPENAI_API_KEY`)
    leaves the process environment, so tools, hooks, background shells, a skill's `!` commands and
    the environment an MCP header helper inherits no longer carry it, a hosted worker's broker token
    included (a variable an MCP definition references explicitly still resolves); the provider keeps
    authenticating from the startup snapshot. A user or managed settings layer can let
    commands see one with `"commandEnvAllow": ["NAME"]`; project settings cannot. With the OS sandbox
    on, confined commands can no longer read `settings.json`, `credentials/`, `mcp-credentials/` or
    `remote-host-identity.json` under the user state directory. **Behavior change:** a command that
    relied on inheriting a provider key now needs the opt-in, and a host embedding `startCli` finds
    those variables gone from its own `process.env` afterwards — a later in-process call must pass them
    in its `environment`.
  - `agent-framework` — the settings schema gains `commandEnvAllow`; `checkSettingsDocument` and
    `buildProviderProfilesSnapshot` take an optional environment map to resolve `$ENV:` references
    against instead of the live process environment.
  - `agent-command` — provider startup checks credentials against the host's environment snapshot.
  - `agent-tools` — `OsSandboxClient` takes `hiddenPaths`, always hidden from confined commands and
    not changeable by sandbox settings.
  - `agent-subagent-runner` — a child-process subagent removes its provider credential variable from
    its own environment once its provider is built, unless the start payload says the owner opted it in
    (`keepProviderCredential`).
  - `dag-node-instant-node` — prompt nodes accept an env resolver (`createPromptBackedNodeDefinition`'s
    third argument, `rehydrateInstantNode`'s `resolveEnv`) for their `$ENV:` credential default.
  - `agent-command-workflows` — `/workflows create` and `/workflows run` resolve prompt-node credentials
    from the host's environment snapshot.
- Updated dependencies [7116367]
- Updated dependencies [5bb675a]
  - @robota-sdk/agent-framework@3.0.0-beta.90
  - @robota-sdk/agent-preset@3.0.0-beta.90
  - @robota-sdk/agent-core@3.0.0-beta.90
  - @robota-sdk/agent-interface-command@3.0.0-beta.90
  - @robota-sdk/agent-interface-execution@3.0.0-beta.90
  - @robota-sdk/agent-interface-session@3.0.0-beta.90

## 3.0.0-beta.89
### Patch Changes

  - @robota-sdk/agent-framework@3.0.0-beta.89
  - @robota-sdk/agent-core@3.0.0-beta.89
  - @robota-sdk/agent-interface-command@3.0.0-beta.89
  - @robota-sdk/agent-interface-execution@3.0.0-beta.89
  - @robota-sdk/agent-interface-session@3.0.0-beta.89
  - @robota-sdk/agent-preset@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- @robota-sdk/agent-framework@3.0.0-beta.88
- @robota-sdk/agent-preset@3.0.0-beta.88
- @robota-sdk/agent-core@3.0.0-beta.88
- @robota-sdk/agent-interface-command@3.0.0-beta.88
- @robota-sdk/agent-interface-execution@3.0.0-beta.88
- @robota-sdk/agent-interface-session@3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 7d9cc66: Keep host-declared inline human controls reachable during active turns. Plugin disable and uninstall can withdraw future dispatch without changing model invocation or host command policy.
- 7d9cc66: Allow authenticated attached users to correct and forget project memory while preserving host remote-command policy and rejecting model curation.
- 7d9cc66: Add user-only project memory topic correction and forgetting, prevent automatic restoration after restart, refresh retained startup context, and reconcile semantic recall with current durable source content.
- 7d9cc66: Add explicit MCP Skills selection, bounded supervisor access and persistent host content consent.
  Users can inspect verified instructions, approve the exact content fingerprint and withdraw consent;
  models can discover metadata only. Consent stays separate from server admission and model-turn activation.
- 7d9cc66: Route discovered MCP Skills through the shared skill command runtime with lazy verified content, source-bound invocation names, current user consent and execution-owned activation cleanup. Keep remote shell expressions inert and defer queued user skill reads until their own turn executes.
- 7d9cc66: Expose verified skill supporting resources only within their owning turn or fork, using the current host consent and manifest.
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
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
  - @robota-sdk/agent-core@3.0.0-beta.87
  - @robota-sdk/agent-framework@3.0.0-beta.87
  - @robota-sdk/agent-interface-command@3.0.0-beta.87
  - @robota-sdk/agent-interface-execution@3.0.0-beta.87
  - @robota-sdk/agent-interface-session@3.0.0-beta.87
  - @robota-sdk/agent-preset@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.86
- @robota-sdk/agent-framework@3.0.0-beta.86
- @robota-sdk/agent-interface-command@3.0.0-beta.86
- @robota-sdk/agent-interface-execution@3.0.0-beta.86
- @robota-sdk/agent-interface-session@3.0.0-beta.86
- @robota-sdk/agent-preset@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- 3c1967f: Reloading plugins updates the live session's skill routing and model skill catalogue together
  with command completion. Disabled plugins stop being executable after reload, and unreadable
  settings clear the plugin skill snapshot. Hook changes require a new session.
- db35dcd: MCP approvals now outlive the process, and an approval takes effect at once. The `__PRODUCT_CLI_NAME__` CLI keeps
  activation decisions in `$PRODUCT_USER_STATE_DIR/mcp-approvals.json` (owner-only) unless the host passes its own
  `mcpApprovalStore`, so an approved server connects at later starts until its definition changes.
  `/mcp approve <server>` now also connects the server in the running session, the way `/mcp reload`
  does, instead of waiting for a restart. A remote server without OAuth therefore connects once
  approved; stdio servers still need a host-supplied authority.
- 4cee6fb: Report unsupported MCP transports at startup and reload instead of silently skipping them,
  and distinguish plugin MCP declaration inspection from a runtime connection.
- 043fd27: In `plan` mode the model can no longer save project memory with `/memory add`. The command is auto-approved, so it ran in plan mode while `Write` and `Edit` were denied there. Reading memory, and adding it by hand, still work in plan mode.
- 6ee8725: A user settings file that does not parse no longer reads as "no plugin is disabled". Plugin settings
  now refuse to read it: no plugin loads (skills, commands, hooks and themes alike), a plugin command
  such as `/plugin enable` fails instead of rewriting the whole settings file with the plugin keys
  alone, and `__PRODUCT_CLI_NAME__ doctor` reports the plugin check as failed while still inspecting each installed
  plugin. The CLI already refuses to start with such a file; this covers a session started later in
  the same process.
- Updated dependencies [4e11579]
- Updated dependencies [41cca13]
- Updated dependencies [193a0bc]
- Updated dependencies [54e2848]
- Updated dependencies [3c1967f]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [5684612]
- Updated dependencies [6ee8725]
- Updated dependencies [6072e9a]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
- Updated dependencies [2e07cad]
  - @robota-sdk/agent-framework@3.0.0-beta.85
  - @robota-sdk/agent-core@3.0.0-beta.85
  - @robota-sdk/agent-interface-command@3.0.0-beta.85
  - @robota-sdk/agent-preset@3.0.0-beta.85
  - @robota-sdk/agent-interface-execution@3.0.0-beta.85
  - @robota-sdk/agent-interface-session@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

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
- Updated dependencies [9f46375]
- Updated dependencies [e8d70ac]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-core@3.0.0-beta.84
  - @robota-sdk/agent-framework@3.0.0-beta.84
  - @robota-sdk/agent-interface-session@3.0.0-beta.84
  - @robota-sdk/agent-interface-execution@3.0.0-beta.84
  - @robota-sdk/agent-interface-command@3.0.0-beta.84
  - @robota-sdk/agent-preset@3.0.0-beta.84

## 3.0.0-beta.83

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

- 28fa8a7: `/devices add` and `/devices join` enrol a new device into your devices.

  - On a device that holds the signing key, `/devices add` shows a one-time code on the terminal. It
    works once, for five minutes.
  - On the new device, `/devices join [name]` asks for the code on the terminal, creates the device's
    keys, and meets the other device through the signaling relay in
    `transports.webrtc.options.relayUrl`. Both devices need that setting.
  - The new device proves the code over the WebRTC connection's DTLS fingerprints before anything else
    crosses, so a relay in the middle cannot enrol anyone.
  - Both devices then show the same six digits, and both operators compare them and confirm. Someone
    who saw the code cannot choose the digits: the new device commits to its part before it sees the
    existing device's.
  - Only when both operators say yes does the existing device certify the new one and issue a new
    roster. The new device keeps its identity only once the chain it receives verifies.
  - A wrong, expired or already used code is refused. So is a code after a few failed attempts. When
    either operator declines, nothing is issued or kept.
  - The code appears only on the two terminals. It never reaches history, transcripts or the model. A
    code typed as a command argument is refused. Both commands stay user-only and refuse remote
    surfaces.
  - `agent-remote-pairing`: enrollment codes, the enrollment proof, the signed request with its
    commitment, the short authentication string and the frame decoder.
  - `agent-transport-webrtc`: `dialEnrollment` and `listenForEnrollment` provide a data channel bound to
    the negotiated fingerprints.

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

### Patch Changes

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

- Updated dependencies [3c81769]
- Updated dependencies [724fabb]
- Updated dependencies [997f2fb]
- Updated dependencies [bfe8ed5]
- Updated dependencies [e689c8e]
- Updated dependencies [4241fc5]
- Updated dependencies [4f49d14]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [9721162]
- Updated dependencies [be0e53c]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [9721162]
- Updated dependencies [6e6b06b]
- Updated dependencies [7d77ce4]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
- Updated dependencies [caaab20]
- Updated dependencies [f01868f]
- Updated dependencies [e8779c9]
- Updated dependencies [5a0ee96]
  - @robota-sdk/agent-framework@3.0.0-beta.83
  - @robota-sdk/agent-core@3.0.0-beta.83
  - @robota-sdk/agent-interface-session@3.0.0-beta.83
  - @robota-sdk/agent-interface-command@3.0.0-beta.83
  - @robota-sdk/agent-interface-execution@3.0.0-beta.83
  - @robota-sdk/agent-preset@3.0.0-beta.83

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

- 004fe7f: `/handoff` moves a session over a real connection.

  - `/handoff <session-id>` pushes this conversation to another __PRODUCT_DISPLAY_NAME__ session on this machine. The
    same carrier also runs between two of the user's devices over their mesh connection; no command
    opens that connection yet.
  - A hand-off is push-only: only the operator of the session that holds it starts one. A session or
    device that asks another for its session is refused.
  - The source signs a grant for that one transfer over that one channel with its device key, so a
    hand-off needs the device identity from `/devices init`. The receiving side checks it against the
    sender's certificate, then asks its own operator; without a yes nothing is sent.
  - The session travels on the file-transfer carrier, is kept aside until it matches the manifest, and
    is saved without being started. The operator there resumes it with `__PRODUCT_CLI_NAME__ --resume <id>`.
  - The source gives the session up, and ends, only once the receiving side confirms it saved it.
    Every other outcome leaves the session where it was; if the confirmation is lost, `/handoff` to the
    same session again resends the same transfer, which the receiver settles without saving it twice.
    Peer attribution (`driverId`, `turnSource`)
    travels with it.
  - `/handoff` stays user-only. Its description tells the model to suggest the command to the user.
  - `agent-transport-webrtc`: an admitted mesh link exposes the DTLS fingerprints it is bound to, and
    `judgeHandoffGrant` is exported.
  - `agent-interface-session-mobility`: a hand-off carrier may move the sealed payload whole
    (`sendPayload`), the destination verifies it with `receivePayload`, and the source can report its
    open transfer (`status`) and abandon it for any refusal the destination names.

### Patch Changes

- e15e22b: Two of one user's devices can connect to each other over WebRTC, admitted by the device handshake.

  - `agent-transport-webrtc` — `DeviceMeshNode` keeps one connection per device pair, in either role: the
    device with the lower id offers and the other answers, so concurrent attempts resolve by rule. Both
    roles bind the handshake to the certificate the DTLS layer verified and take one remote description
    with exactly one fingerprint; before admission only handshake frames cross, and a connection counts
    as admitted only once both sides admitted each other. Each connection gets its own DTLS certificate
    (`createDtlsKeys`). A new attempt never displaces an admitted connection until it is admitted
    itself, and attempts per pair are paced. Lists adopted in a handshake, or handed over through
    `refresh`, apply at once, and a device they revoke loses its connection. Signaling runs through
    `IMeshRelay`: `WsMeshRelayClient` for the self-hosted relay's `presence` / `message` frames
    (topics capped per source and relay-wide), `createInMemoryMeshRelayHub` for tests.
  - `agent-remote-pairing` — the pair's two relay inbox topics, one per direction, come from their
    pairwise secret (`derivePairRendezvous(...).relayInbox()`).
  - `agent-cli` — a device holding the signing key reissues its roster and revocation list before they
    expire while an interactive session runs. The host can open this device's mesh endpoint from the
    identity under `$PRODUCT_USER_STATE_DIR/devices`, saving newer lists a peer hands over; no command starts it yet.
  - `agent-command` — `/devices add|join` still reports that enrolment is not available yet.

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-framework@3.0.0-beta.82
  - @robota-sdk/agent-interface-command@3.0.0-beta.82
  - @robota-sdk/agent-interface-execution@3.0.0-beta.82
  - @robota-sdk/agent-interface-session@3.0.0-beta.82
  - @robota-sdk/agent-preset@3.0.0-beta.82

## 3.0.0-beta.81

### Minor Changes

- 44fc732: Add `/devices` for this device's identity among the user's devices: `list`, `init` (creates the identity: a recovery phrase, the master-certified signing key, this device's keys and certificate, the first roster and revocation list), `revoke <device-id>` (signing key only, no phrase; confirmed at the terminal) and `recover` (rotates the signing key from the phrase and revokes the old ones). Enrolling another device (`add` / `join`) comes with the device connection.

  The recovery phrase never enters the session: it is shown once and read with no echo on the controlling terminal (opened apart from the session's input), on the alternate screen that is cleared afterwards, and never reaches prompt history, conversation history, transcripts, traces or the model. Without an interactive terminal the phrase commands refuse. `/devices` is operator-only: never model-invocable and refused from remote surfaces. Private keys live in the host credential store; certificates, roster, revocation lists and sequence marks are kept in owner-only files under `$PRODUCT_USER_STATE_DIR/devices`.

  `agent-remote-pairing` adds `isRecoveryPhraseWord`, so a phrase can be checked one word at a time.

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

### Patch Changes

- ec5e477: Add a credential store port (`ICredentialStore` in `agent-core`) and keep the CLI's secrets behind it: the OS keychain through the optional `@napi-rs/keyring` binding (macOS Keychain, Windows Credential Manager, Linux Secret Service), else an owner-only file under `$PRODUCT_USER_STATE_DIR/credentials`. The backend is chosen at first use, recorded, and named by `/remote-control status`; a recorded keychain that stops working fails closed instead of degrading to the file.

  The remote-control host identity key moves into the store. The old `$PRODUCT_USER_STATE_DIR/remote-host-identity.json` may have been copied by backups or dotfile sync, so it is not carried over: on the first run after upgrading a new host key is generated, the old file is removed, and the operator is told once that trusted devices must pair again.

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
- Updated dependencies [007fd90]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-interface-session@3.0.0-beta.81
  - @robota-sdk/agent-framework@3.0.0-beta.81
  - @robota-sdk/agent-interface-command@3.0.0-beta.81
  - @robota-sdk/agent-interface-execution@3.0.0-beta.81
  - @robota-sdk/agent-preset@3.0.0-beta.81

## 3.0.0-beta.80

### Major Changes

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

- 2d3b2c0: ARCH-024 replaces framework knowledge of command-owner ids with optional, owner-declared semantic
  roles. `ISystemCommand` can declare `skillActivation`, `contextReduction`, or `subagentSpawn`;
  `SystemCommandExecutor` exposes the selected role projection and rejects duplicate owners with the
  typed `DuplicateSystemCommandSemanticRoleError`, atomically across construction, registration, and
  replacement.

  This is a beta-line breaking contract correction: unannotated commands named `skills`, `compact`, or
  `agent` no longer receive special framework behavior. `@robota-sdk/agent-command` now declares the
  roles on its shipped skills, compact, and agent commands.

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
- 44393be: Add the `/remote-control` enable path (REMOTE-008 Stage B4-2b) — turn on P2P remote control locally, get
  a QR + link, and a paired device co-drives the SAME live session over pairing-gated WebRTC. The command
  is a declarative trigger returning `remote-control-enable-requested`/`-stop-requested` effects (SSOT
  agent-interface-transport) and reads state via a new `ICommandHostAdapters.remoteControl.getStatus()`;
  the TUI dispatches the effects to injected callbacks; all transport construction lives at the agent-cli
  composition root (`WsSignalingClient` + pairing-gated `WebRtcTransport`, relay URL from
  `transports.webrtc.options.relayUrl`, QR/link rendered into history). Fail-closed: no relay configured ⇒
  does nothing; pairing mismatch/timeout ⇒ the session is never exposed. Consumes REMOTE-007 so a paired
  remote owner answers their own permission/ask prompts over the WebRTC channel.
- cbee54e: Surface unmatched preset command-module names instead of silently dropping them (INFRA-032). A preset `enabledCommandModules`/`disabledCommandModules` entry that matches no built command module — a short form like `"editor"` instead of `agent-command-editor`, or a typo — is now reported as a non-fatal notice on both the startup `--preset` path (CLI terminal) and the in-session `/preset` path (command result). Detection lives once in agent-framework's new pure `findUnknownModuleNames`, and agent-command's duplicate module filter now delegates to the framework's `selectCommandModules`; `createDefaultCommandModules` returns `{ modules, unknownModuleNames }`.

### Patch Changes

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
- d6b9404: Remove polynomial-ReDoS backtracking (SEC-003, CodeQL `js/polynomial-redos`) from three parsers whose input is not repo-controlled.

  `parseStructuredResponseText` (agent-core) parses raw model output; its fenced-code-block regex used `\s*\n`, and because `\s` also matches a newline the two overlapped, so an unterminated fence containing many blank lines was rejected in O(n^2) — 12.7s for a 400 KB string, now ~1ms. The whitespace run is now restricted to horizontal whitespace, which makes the newline split point unique.

  `/schedule cron` and `/monitor` (agent-command) are declared `modelInvocable: true`, so their argument string is composed by the model. Both matched the trailing instruction with `\s+(.+)$`; since `.` also matches a space the split point was ambiguous and a non-matching argument cost O(n^2) — ~15s for a 200 KB argument, now <1ms. The instruction is now required to start with a non-space character, which pins the split point without changing which inputs are accepted.

  No behaviour change: the set of accepted inputs and the parsed values are identical in every case.

- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [08a9bd6]
- Updated dependencies [37b4bd7]
- Updated dependencies [818f0c8]
- Updated dependencies [4eea54b]
- Updated dependencies [1698be4]
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
- Updated dependencies [378c585]
- Updated dependencies [4c5148e]
- Updated dependencies [37af5dc]
- Updated dependencies [807d161]
- Updated dependencies [fec722f]
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
  - @robota-sdk/agent-interface-execution@3.0.0-beta.80
  - @robota-sdk/agent-interface-command@3.0.0-beta.80
  - @robota-sdk/agent-framework@3.0.0-beta.80
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-interface-session@3.0.0-beta.80
  - @robota-sdk/agent-preset@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79
- @robota-sdk/agent-framework@3.0.0-beta.79
- @robota-sdk/agent-interface-transport@3.0.0-beta.79
- @robota-sdk/agent-preset@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78
  - @robota-sdk/agent-framework@3.0.0-beta.78
  - @robota-sdk/agent-interface-transport@3.0.0-beta.78
  - @robota-sdk/agent-preset@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-framework@3.0.0-beta.77
  - @robota-sdk/agent-interface-transport@3.0.0-beta.77
  - @robota-sdk/agent-preset@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- DQ-AUDIT-002 — consolidate duplicated domain data onto single owners: one model-pricing SSOT in agent-core (`MODEL_PRICES`/`lookupModelPrice`/`calculateModelCost`/`estimateBlendedCostPer1000`) consumed by agent-command and agent-plugin (drops two embedded/stale price tables); the `len/4` token estimator replaced by core `CONTEXT_ESTIMATE_CHARS_PER_TOKEN`; TUI `TContextState` derived from core `IContextWindowState`; dead pass-through re-exports removed from agent-session.
- 576af62: Fix `ConfigurationError: Agent must be fully initialized before changing model configuration` when running `/preset` (or any live model re-apply) on a fresh interactive session before the first message. The __PRODUCT_DISPLAY_NAME__ agent initialized lazily on the first `run()`, but `setModel` requires full initialization. `Session.applyModelOptions` now awaits the new idempotent `__PRODUCT_DISPLAY_NAME__.ensureReady()` before `setModel`, and the preset live-switch path (`applyPresetToSession` → `executePresetCommand`) is async end-to-end. Adds a real cold-session regression test (no mocked __PRODUCT_DISPLAY_NAME__).
- Updated dependencies
- Updated dependencies [c0a6287]
- Updated dependencies [9df3a88]
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-framework@3.0.0-beta.76
  - @robota-sdk/agent-interface-transport@3.0.0-beta.76
  - @robota-sdk/agent-preset@3.0.0-beta.76

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
  - @robota-sdk/agent-preset@3.0.0-beta.75
  - @robota-sdk/agent-framework@3.0.0-beta.75
  - @robota-sdk/agent-core@3.0.0-beta.75
  - @robota-sdk/agent-interface-transport@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.74
  - @robota-sdk/agent-core@3.0.0-beta.74
  - @robota-sdk/agent-interface-transport@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73
- @robota-sdk/agent-framework@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.72
  - @robota-sdk/agent-core@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71
  - @robota-sdk/agent-framework@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- CLI UX fixes: /context list full LLM context breakdown (CLI-B10), logo resize fix (CLI-B03), token estimates in context list (CLI-B04)
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.70
  - @robota-sdk/agent-core@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.69
  - @robota-sdk/agent-core@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68
- @robota-sdk/agent-framework@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.67
  - @robota-sdk/agent-core@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- refactor: CLI-001/002 — agent-cli layer separation and monorepo-wide readability lint rules
  - CLI-001: Extract startup phases into focused modules; enforce agent-cli layer separation
  - CLI-002: Apply import/order, consistent-type-imports, explicit-function-return-type, prefer-const, object-shorthand across all packages
  - Fix stale child-process-subagent-worker entry in agent-cli tsdown.config.ts (build fix)

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.66
  - @robota-sdk/agent-core@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65
- @robota-sdk/agent-framework@3.0.0-beta.65

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
