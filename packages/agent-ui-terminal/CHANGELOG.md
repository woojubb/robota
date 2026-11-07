# @robota-sdk/agent-ui-terminal

## 3.1.1
### Patch Changes

  - @robota-sdk/agent-framework@3.1.1
  - @robota-sdk/agent-core@3.1.1
  - @robota-sdk/agent-interface-analytics@3.1.1
  - @robota-sdk/agent-interface-command@3.1.1
  - @robota-sdk/agent-interface-execution@3.1.1
  - @robota-sdk/agent-interface-session@3.1.1
  - @robota-sdk/agent-interface-transport@3.1.1
  - @robota-sdk/agent-interface-tui@3.1.1
  - @robota-sdk/agent-transport@3.1.1

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
- bc8de21: `TSessionLoadOutcome` gains a fifth status, `locked`: the record is there and sealed, and this
  process cannot open it right now (`reason: 'no-keys'` when the store keeps its records `'plain'`,
  `'changed'` when a held session's file changed since). `list()` leaves locked sessions out, since
  there is no record to describe; the optional `scan()` returns the listing together with how many it
  left out — `locked`, which an unlock would list, and an optional `noKeys` for those sealed with keys
  this process does not have — and `scanSessionStore`/`listResumableSessions` in
  `@robota-sdk/agent-framework` read it. `lockedSessionReason`, `lockedSessionMessage(id, reason)` and
  `lockedSessionsNotice(locked, noKeys)` word a sealed session by why it does not open, so only locked
  keys are ever met with "unlock"; resume, rename, hand-off, usage and the CLI's notices follow them. A
  served session listing carries how many sealed sessions the host cannot open, its keys locked or
  none that open them, as `lockedSessionCount`; the reason does not cross the wire, so the terminal
  picker and the web session list say how many are sealed and not listed, never to unlock.

  `@robota-sdk/agent-interface-analytics` adds an optional `IPersonalUsageCoverage.lockedSessions`, the
  number of sealed sessions a usage report could not open (locked keys, or none that open them).
  `@robota-sdk/agent-session-analytics` adds an optional `IPersonalUsageSnapshot.lockedSessionCount`,
  which fills it, and the formatted report then reads `locked N` in its coverage line.

  What to do: a `switch` over `outcome.status` handles `locked`; when you write, treat it like
  `corrupt` (do not save over it). A surface that lists sessions can show `scan().locked` and
  `scan().noKeys` so sealed sessions do not look deleted.
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
- 82663df: One session has one writer across processes. Every claim of a session id now holds the id's writer
  marker in a `claims/` directory beside the records, so a second opener of a session another process
  has open is refused with `has_writer`, naming that process — `-r`, `-c`, the resume picker, ACP
  `session/load`, the served and desktop pool, a served switch, rename and delete. This is a break: a
  session that two processes could open at once before is now refused in the second one.

  `@robota-sdk/agent-core` adds exclusive process markers: the neutral `IProcessMarkers` port with its
  result types, and `createProcessMarkers` on `./node`. A marker is published by hard-linking a flushed
  temp file, moved or removed only under its break lock, and re-verified by its handle before each
  write. The owner record and its liveness rule are now one exported classifier,
  `classifyProcessOwner`, shared with process-scoped directories.

  `@robota-sdk/agent-interface-session` and `@robota-sdk/agent-session`: `StoredSessionRecords` takes
  the marker port, and a store without one does not exist. `claim(id, { lease })` takes over a lent
  marker and `claim(id, { copy: true })` reads a record to copy it without one. `lend(id)` is new: it
  lends a record to another process for as long as that process runs and returns `{ nonce, end() }`.
  Every write of an id holds its marker, and a save whose marker another process broke is refused as
  `released`, never written. `hasWriter` now sees other store instances and processes. Removed, since
  `lend` replaces them: `ISessionAuthorship.exportEnded`, the store's export bookkeeping
  (`hasUnclaimedWriter`), the `exported` claim refusal and the `exported` adopt result.
  `TSessionClaimRefusal` is `has_writer | released`, `TSessionAdoptResult` has `has_writer` in place of
  `exported`, and `has_writer` is a session change and delete refusal code. A store may name its release
  command for a refusal (`releaseCommand`). A refusal of a record lent to a subagent names the
  subagent's process once it took the marker over, and says a subagent this process started holds it
  before (`holder.lent`); `SessionClaimedError.closing` is true only for a session of this process that
  has not let its claim go, which is the one refusal a caller may wait out (`still_closing`).

  `@robota-sdk/agent-subagent-runner`: the parent lends a fork job's record before it spawns the child,
  in either mode; the lease nonce rides on the start payload (`resumeLease`); the child claims its
  record under the lease, saves under that claim and releases it on every exit; the parent ends the
  lease once the child has exited and disconnected, then countersigns under its own marker. A running
  child-process fork therefore has one writer, and attaching to it is refused until the job ends.

  `@robota-sdk/agent-cli` adds `session release <id> [--force]`, the user's own command for a marker a
  crashed or planted process left: on its own it removes only a marker whose process has ended, and
  `--force` removes one whose process may still run only at a terminal and after a y/N. `secure migrate`
  leaves a session open in another process as it is and names it.

  A terminal start whose resumed session another process holds now ends with the store's refusal, as print
  mode does, instead of Ink's error screen; `@robota-sdk/agent-framework` exports `claimRefusalMessage`
  for it, and `claimChangeRefusal` / `claimDeleteRefusal`, which turn a store's claim refusal into the
  client's: `still_closing` for a switch or rename (and `running` for a delete) when a session of this
  process is still closing, `has_writer` in the store's words otherwise. Served rename and delete now
  let the store's write refuse in those words. `@robota-sdk/agent-ui-terminal`: picking a session another process or a subagent holds in the
  resume picker leaves the person on their session, with the store's words as a notice, instead of
  stopping it and blocking the UI on a retry of the same refusal.
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
- 7ce5e73: Add the framework host and make `host` and `cwd` required wherever the framework builds a session. The host is passed and accepted but nothing reads it yet, so behaviour is unchanged.

  - `@robota-sdk/agent-framework`: `IFrameworkHost` lists what a platform lends the framework (home directory, workspace resolver, path canonicalizer, exit flush, environment, files, git, git remotes, hook executors, background task runners, default tools, observer failure report, async scope, project mutation support). Every member is optional and an absent one means the capability is off, so `{}` is a valid host. `IAsyncScope` is the port behind `createAsyncScope`.
  - `@robota-sdk/agent-framework/node` (new, `"browser": null`) exports `createNodeFrameworkHost({ createDefaultTools })`, which fills every member for a Node process. The composition root names `createDefaultTools` from `@robota-sdk/agent-tool-defaults`; pass `() => []` for sessions with no default tier. `@robota-sdk/agent-framework/testing` exports `createTestFrameworkHost(overrides?)`, the same host with the real default tools, where an override replaces a member and an explicit `undefined` removes it.
  - `host` is required on `InteractiveSession` (both construction shapes, so on `buildRuntimeSession` and `startRuntimeHost` too), `createSession`, `createSubagentSession`, `createQuery`, `createAgentRuntime` and `createStatelessRuntime`, and on the options of `createInteractiveRuntime`, `createProgrammaticAgent`, `HeadlessInteractionChannel` and an in-process subagent runner. A missing `host` throws at construction, naming `createNodeFrameworkHost`.
  - `cwd` is required, and absolute as it already had to be, on `createSession`, `createQuery`, `createStatelessRuntime` and an injected-session `InteractiveSession`. The `process.cwd()` fallback is gone: a caller that relied on it passes `process.cwd()` itself.
  - `@robota-sdk/agent-cli`: `startCliCore` takes the host as its second argument and `runPrintMode` as its second after the product runtime; `startCli` and the headless entry build it with `createNodeFrameworkHost`. `IRunEvalDeps.host` is required unless `runFn` is given.
  - `@robota-sdk/agent-subagent-runner`: `ISubagentWorkerComposition.host` is required; the worker builds its child session on it, and the product's composition supplies it.
  - `@robota-sdk/agent-ui-terminal`: `IRenderOptions` and `ITuiInteractionChannelOptions` take `host`.
  - `@robota-sdk/agent-command`, `@robota-sdk/agent-product`: their tests and scenario scripts pass a host; no published surface changes.
- a2d36ea: Move the last two Node-reading exports off the framework's main entry, and give the session's replay-validation read to the host.

  - `resolveGitBranchFromNodeHost` is now on `@robota-sdk/agent-framework/node`, not the main entry. It reads a checkout's `.git` directory with `node:fs`; the terminal UI imports it from `/node`.
  - `validateWorkspaceSessionReplayLog` is now on `@robota-sdk/agent-framework/node`. The session reaches it through a new host member, `validateSessionReplayLog(projectAccess, sessionId)`, which `createNodeFrameworkHost` fills. A host that supplies none leaves the session unable to read its log: `validateCurrentSessionReplayLog()` throws an error that names the member, and `/validate-session` reports it. On Node it behaves as before: the log is read as plain, and a sealed one is reported as sealed.
- a2d36ea: Make the settings, contribution-root and transport-settings modules of the framework platform-neutral. Settings layers and stores on the main entry no longer open a settings file; they ask the host for text and for a store, and the file-backed halves moved to `@robota-sdk/agent-framework/node`. Plugin enablement still works on the user settings file by the source's `path`, through an `IFileSystem`, so a user source with no `path` enables no plugins.

  - Settings sources: a host source is now `IHostSettingsSource` (replacing `INodeHostSettingsSource`) with `kind`, `scope`, `displayName`, an optional `path` and a required `read()` that returns the document's text, `undefined` when it does not exist, and throws when it exists but cannot be read. `readSettingsSourceText` and every settings layer read through it, so an absent, empty, corrupt or unreadable layer is classified and refused exactly as a file layer is. A host with no file system passes its own sources and stores. `createNodeHostSettingsSource` and `createNodeHostSettingsStore` moved to `/node`; the Node source reads the file the way it always did, and the store still writes owner-only.
  - Settings files: `readSettings`, `writeSettings`, `updateModelInSettings`, `deleteSettings` and `resetUserConfig` (with `IResetUserConfigResult`) moved to `/node`, unchanged. `TSettingsData` is exported from the module that defines `ISettingsDocumentStore`, and `TSettingsScope` from the scope types; both stay on the main entry.
  - `applyStatusLineSettings` and `applyAppearanceSettings` take an `ISettingsDocumentStore` instead of a settings file path, so they read and write through whatever store the host built. `@robota-sdk/agent-cli` passes a `createNodeHostSettingsStore` over the product's user settings file.
  - Contribution roots: `createNodeHostContributionSource` and `createDefaultUserContributionSources` moved to `/node`. `createContributionSourcesForProjectAccess(access, userSources)` takes the user `IContributionSource[]` the caller built, where it took a home directory and built the Node source itself; with none, a session has the trusted project's sources only.
  - Transport settings: `TransportRegistry` takes an `ITransportSettingsRepository` only. A file path string is no longer accepted; pass `createFileTransportSettingsRepository(path)` from `/node`. `createMemoryTransportSettingsRepository` stays on the main entry.
  - `readPackageVersion` moved to `/node`.
  - `@robota-sdk/agent-command`: the doctor names a host settings source that has no `path` by a slug of its `displayName` (`settings.<scope>.<slug>`, `settings.user.unnamed` when the name has no letters or digits), labels the check with that name, reports no path for it and never offers a repair for it. A source with a `path` is unchanged.
  - `@robota-sdk/agent-cli`, `@robota-sdk/agent-ui-terminal`: import the moved symbols from `/node`; behaviour is unchanged.
- a2d36ea: Move the edit checkpoint store and the session stores off the framework's main entry, so a session's checkpoints and stored sessions are typed by contracts a host with no files can implement. The package stays Node-only until the rest of the split lands.

  What a session now takes:

  - `editCheckpointStore` is an `IEditCheckpointStore` (new, on the main entry: `beginTurn`, `captureFile`, `finalizeTurn`, `list`, `countUnreadable`, `listing`, `inspect`, `restoreToCheckpoint`, `rollbackThroughCheckpoint`, the branch methods and the active-branch pointer), not the `EditCheckpointStore` class. A host that keeps checkpoints somewhere other than a project's files implements the interface; absent, a session has no checkpoints and says why, as before. `createEditCheckpointStore` options of the CLI and the terminal UI are typed the same way.
  - `IInteractiveSessionStore`, `IInteractiveSessionRecord`, `IResumableSessionSummary` and `TSessionLoadOutcome` are now exported from the main entry, so a host with no files can implement the store it passes as `sessionStore` without reaching into `@robota-sdk/agent-interface-session`. `IHostToolResultSpillStore`, the listing and resolving helpers (`scanSessionStore`, `listResumableSessions`, `resolveSessionIdByIdOrName`, `lockedSessionsNotice` and the rest) and `decorateSessionStore` stay on it; they work over any store.

  Moved to `@robota-sdk/agent-framework/node` (no longer on the main entry): `EditCheckpointStore`, `createDirectoryEditCheckpointState`, `migrateWorkspaceEditCheckpoints` and the types `IEditCheckpointStateStorage`, `IEditCheckpointMigration`, `IMigrateEditCheckpointsOptions` and `TEditCheckpointKeptPlainReason`; `createProjectSessionStore`, `createNodeHostSessionStore`, `createUserSessionStore`, `createUserPromptHistoryFile`, `createNodeToolResultSpillStore`, `sweepStaleToolResultSpillDirectories`, `WorkspaceProjectSessionStore`, `WorkspaceSessionLogSink`, `WorkspaceSessionLogSource`, `projectSessionClaimsDirectory`, `migrateWorkspaceProjectSessionLogs`, `migrateWorkspaceProjectSessionRecords` and their option and result types. They seal, read and migrate exactly as before, through `@robota-sdk/agent-session/node`. The repository's lint rule that keeps product packages from building a conversation store outside the product factory now names the same constructors on the Node entry too.

### Patch Changes

- eabce48: A record a store that seals does not verify as the owner's is never resumed, chosen or vouched for
  without the owner's word.

  - Resume: `-c` continues the newest verified session and stops when a newer unverified one exists
    (asking at a terminal, exiting elsewhere). `-r` takes a verified or plain record's exact id, then
    such a record's name, then any other record's id, and refuses a text that is both a verified
    record's name and the id of a record that is unverified or does not read
    (`ambiguousSessionNameMessage`); a store that never seals has no verified record, so there an
    exact id answers before a name and nothing is refused as ambiguous. Breaking:
    `resolveSessionIdByIdOrName` returns a `TSessionIdResolution` (`found`, `ambiguous` with `namedId`
    and `otherId`, `not-found`) instead of an id. An unverified id, or one picked in the picker, is
    shown in fixed text (`unverifiedSessionNotice`, `UNVERIFIED_SESSION_QUESTION`) and asked about —
    before startup only when stdin, stdout and stderr are all a terminal; a yes hands the session the
    digest of exactly the bytes shown. Surfaces with no one to ask refuse
    it, a served switch with the new change-refusal code `unverified`. Listings put unverified records
    after verified ones, the picker marks them first and cuts their names short, and
    `session list --json` adds `authorship`.
  - Forks: a child handed a sealed record runs it only when the parent held it as the owner's, and
    reports each save of it as the new `record_saved` member of
    `TSubagentWorkerChildMessage`, and the parent vouches for the last one once the child is gone, when
    the job started from the owner's own record and no save was refused.
  - Migration: `secure migrate` offers once, at the end of a finished interactive run, to mark the
    sessions it sealed from plaintext (`sealedRecords` on the migration results) as yours. Each store
    is marked on its own; one it could not reach is named, and records the keys locked before marking
    are said to be not marked, to be marked when resumed, apart from changed ones.

  What to do: handle `unverified` and `record_saved` where you switch on `TSessionChangeRefusalCode`
  or `TSubagentWorkerChildMessage`, and read `resolveSessionIdByIdOrName`'s `status`.
- eabce48: Every `InteractiveSession` claims its record and restores only from the claim's read.

  - Breaking: a session store that offers no `claim` is refused when the session is built, and so is
    one given to the in-process subagent runner. `restoreSessionRecordIntoSession` takes the read to
    restore from (a claim's, or a write-only child's of its handed record) and refuses an unverified
    one; it no longer reads the store itself.
  - A record a store that seals calls unverified is refused (`SessionAuthorshipRefusedError`,
    `isSessionAuthorshipRefusedError`: fixed text, nothing the record says) unless the new
    `acceptedDigest` option names exactly its bytes. Those bytes are raised to the owner's only once the
    session has restored from them, and never by `--fork-session`, whose new record is the owner's.
    `checkRestoredRecord` judges the record the session actually restores.
  - Every save of the session's id carries the claim, and every way the session ends releases it —
    `releaseSessionClaim()` for a host that stops waiting on a shutdown. A pool asked for an id
    something here still holds refuses with the new change-refusal code `still_closing`
    (`SESSION_STILL_CLOSING_MESSAGE`, or the store's words for a record a subagent may still save:
    `claimedSessionMessage`).
  - Attach to a fork is no longer offered, and is refused with the reason, while a job in this process
    runs the fork or a child it was handed to may still save it: attaching opens the record as a second
    session, a second writer. Breaking: `ICreateExecutionWorkspaceSnapshotInput.sessionHasWriter` and
    `IResolveExecutionAttachInput.hasWriter` are required, and both read the store's `hasWriter`.
  - When something the session cannot verify changes its record on disk, the session stops saving that
    id and starting work on its own, saves its whole state once under a new id as the owner's, and
    says which. A save only the locked keys refused is tried again at the unlock, and a session that
    ends while either refusal stands, or whose copy could not be written, writes that copy as it ends.

  What to do: give a session store of your own `claim`; handle `still_closing` where you switch on
  `TSessionChangeRefusalCode`.
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
- Updated dependencies [437ca9e]
- Updated dependencies [0a677e9]
- Updated dependencies [44e9640]
- Updated dependencies [b56b5a9]
- Updated dependencies [1c19435]
- Updated dependencies [4e4c92a]
- Updated dependencies [6ba10ef]
  - @robota-sdk/agent-core@3.1.0
  - @robota-sdk/agent-framework@3.1.0
  - @robota-sdk/agent-interface-session@3.1.0
  - @robota-sdk/agent-interface-analytics@3.1.0
  - @robota-sdk/agent-interface-execution@3.1.0
  - @robota-sdk/agent-transport@3.1.0
  - @robota-sdk/agent-interface-transport@3.1.0
  - @robota-sdk/agent-interface-command@3.1.0
  - @robota-sdk/agent-interface-tui@3.1.0

## 3.0.7
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.7
  - @robota-sdk/agent-core@3.0.7
  - @robota-sdk/agent-interface-analytics@3.0.7
  - @robota-sdk/agent-interface-command@3.0.7
  - @robota-sdk/agent-interface-execution@3.0.7
  - @robota-sdk/agent-interface-session@3.0.7
  - @robota-sdk/agent-interface-transport@3.0.7
  - @robota-sdk/agent-interface-tui@3.0.7
  - @robota-sdk/agent-transport@3.0.7

## 3.0.6
### Patch Changes

  - @robota-sdk/agent-framework@3.0.6
  - @robota-sdk/agent-core@3.0.6
  - @robota-sdk/agent-interface-analytics@3.0.6
  - @robota-sdk/agent-interface-command@3.0.6
  - @robota-sdk/agent-interface-execution@3.0.6
  - @robota-sdk/agent-interface-session@3.0.6
  - @robota-sdk/agent-interface-transport@3.0.6
  - @robota-sdk/agent-interface-tui@3.0.6
  - @robota-sdk/agent-transport@3.0.6

## 3.0.5
### Patch Changes

  - @robota-sdk/agent-core@3.0.5
  - @robota-sdk/agent-framework@3.0.5
  - @robota-sdk/agent-interface-analytics@3.0.5
  - @robota-sdk/agent-interface-command@3.0.5
  - @robota-sdk/agent-interface-execution@3.0.5
  - @robota-sdk/agent-interface-session@3.0.5
  - @robota-sdk/agent-interface-transport@3.0.5
  - @robota-sdk/agent-interface-tui@3.0.5
  - @robota-sdk/agent-transport@3.0.5

## 3.0.4
### Patch Changes

  - @robota-sdk/agent-core@3.0.4
  - @robota-sdk/agent-framework@3.0.4
  - @robota-sdk/agent-interface-analytics@3.0.4
  - @robota-sdk/agent-interface-command@3.0.4
  - @robota-sdk/agent-interface-execution@3.0.4
  - @robota-sdk/agent-interface-session@3.0.4
  - @robota-sdk/agent-interface-transport@3.0.4
  - @robota-sdk/agent-interface-tui@3.0.4
  - @robota-sdk/agent-transport@3.0.4

## 3.0.3
### Patch Changes

- Align React dependencies with Ink so supported mixed CLI and web installs share the same React instance.
  - @robota-sdk/agent-core@3.0.3
  - @robota-sdk/agent-framework@3.0.3
  - @robota-sdk/agent-interface-analytics@3.0.3
  - @robota-sdk/agent-interface-command@3.0.3
  - @robota-sdk/agent-interface-execution@3.0.3
  - @robota-sdk/agent-interface-session@3.0.3
  - @robota-sdk/agent-interface-transport@3.0.3
  - @robota-sdk/agent-interface-tui@3.0.3
  - @robota-sdk/agent-transport@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/agent-core@3.0.2
  - @robota-sdk/agent-framework@3.0.2
  - @robota-sdk/agent-interface-analytics@3.0.2
  - @robota-sdk/agent-interface-command@3.0.2
  - @robota-sdk/agent-interface-execution@3.0.2
  - @robota-sdk/agent-interface-session@3.0.2
  - @robota-sdk/agent-interface-transport@3.0.2
  - @robota-sdk/agent-interface-tui@3.0.2
  - @robota-sdk/agent-transport@3.0.2

## 3.0.1
### Patch Changes

  - @robota-sdk/agent-core@3.0.1
  - @robota-sdk/agent-framework@3.0.1
  - @robota-sdk/agent-interface-analytics@3.0.1
  - @robota-sdk/agent-interface-command@3.0.1
  - @robota-sdk/agent-interface-execution@3.0.1
  - @robota-sdk/agent-interface-session@3.0.1
  - @robota-sdk/agent-interface-transport@3.0.1
  - @robota-sdk/agent-interface-tui@3.0.1
  - @robota-sdk/agent-transport@3.0.1

## 3.0.0
### Major Changes

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
- f3fe3db: The terminal renderer no longer reads `PRODUCT_SCREEN_READER_STARTUP_QUIET_MS` or
  `PRODUCT_SCREEN_READER_PREPARK_MS` from the process environment. SDK hosts calling `renderApp`
  directly should pass raw timing choices and diagnostic labels through the new optional
  `screenReaderPacing` render option. Without it, the renderer uses its existing 900 ms startup
  quiet period and 50 ms pre-write park when screen-reader mode is enabled. The configured CLI still
  reads the same environment variables and preserves their validation, bounds, and warnings.
- 724d5b6: The terminal renderer no longer reads `PRODUCT_IME_CURSOR` or `PRODUCT_TURN_MARKS` from the process environment. SDK hosts calling `renderApp` directly should pass cursor and turn-mark choices through the optional `terminalCapabilities` render option. Without a host choice, the renderer keeps its terminal and TTY defaults. The configured CLI still reads both environment variables and preserves its exact `1` and `0` overrides.

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
- 617b795: `robota session attach <id> [--observe]` puts this terminal on a live supervised session.

  - It asks first, on the controlling terminal, naming the session and the role: drive (send prompts,
    answer its questions) or observe (read only). The yes holds only for the process start it named: if
    the session restarted meanwhile, the attach is refused.
  - It needs an interactive terminal. Without one (a script, or an agent running shell commands) it is
    refused and prints the command for the user to run. It is not available as a slash command or a
    model tool.
  - The terminal view shows the conversation so far, then follows the session live: streaming replies,
    tools, other terminals' prompts, queued input and questions. In drive mode it sends prompts and
    `/commands` and answers permission prompts and questions; a question answered on another surface is
    dismissed. Observe mode is labelled read-only and sends nothing but reads.
  - `/exit`, `/quit`, Ctrl-C and Ctrl-] detach. Nothing is sent to the session, so its turn continues and
    it keeps running; stop it with `robota session stop` or from `robota session view`.
  - The attached terminal is the full terminal UI (`renderAttachedApp` in `agent-ui-terminal`).
  - A handshake from a connection that already closed no longer holds one of the session's attach slots.
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
- 1706d29: `robota session view` attaches to and peeks at sessions.

  - `a` attaches to the selected session to drive it, and `p` peeks at it read-only. Both are offered, in
    the footer and in help, only on a row that is alive, controllable and verified. The view asks first,
    naming the role. The yes is held to the process start the row showed: if the session restarted or
    lost control meanwhile, the attach is refused. Detaching returns to the view, on the same row and
    grouping, without printing the screen-reader line again.
  - **Breaking:** opening a row's linked PR moves from `p` to `o`.
  - The attached view shows the keys for what is on screen: sending, answering a permission, or
    answering a question. With a screen reader it words every line ("Prompt from attach:2: …",
    "Tool started: …", "Permission needed: …") and uses no symbols.
  - Questions wait their turn: a second permission request or question no longer replaces the one on
    screen, and one settled elsewhere leaves the queue.
  - Line breaks inside pasted text become spaces instead of sending the text. In a masked answer they are
    dropped, so a copied key that ends with a line break is kept exactly.
  - `robota session attach` accepts `--screen-reader` and `--no-screen-reader`.
  - The attach client closes a connection that sends more frames than it can hold before the view reads
    them.
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
- 6e6b06b: `robota --attach` puts the full terminal UI on this workspace's running daemon.

  - **`agent-ui-terminal`:**
    - `renderAttachedApp` renders the same App over a wire connection, through `WireTuiChannel`, a second implementation of the TUI's channel port.
    - Leaving detaches; the daemon keeps running.
    - The session picker lists and switches the daemon's sessions. It opens on the daemon's answer to `/resume`; a daemon that cannot list its sessions says why instead.
    - With no saved sessions to resume, `/resume` says so and keeps the prompt, instead of opening an empty picker that blocks input. This applies to the in-process TUI too.
    - The session picker lists an unnamed session by the part of its id that differs, not by the `session_` prefix every id shares. This applies to the in-process TUI too.
    - The status bar names the daemon's current session: its name, or else its short id.
    - A question already open when the terminal attaches is shown, and a long session's history reaches the terminal without the daemon cutting it off.
    - Features that belong to the runtime process say they are unavailable while attached: the plugin manager, background task details and sending to an agent job.
  - **`agent-cli`:**
    - `robota --attach` finds the workspace daemon and asks the user to confirm on the terminal, as `robota session attach` does, then attaches.
    - Options that shape a session are refused, because the daemon shapes its session.
    - A terminal attached over the supervised socket can now list, start and switch sessions.
    - A client's command no longer stops or restarts the workspace daemon. `/language`, `/reset`, `/exit` and provider setup or switch keep their saved change, and the client is told to run `robota daemon stop`, then `robota daemon start`.
    - `robota --attach` installs the plain TUI's process guards, so an error the plain TUI survives no longer ends the attached terminal.
    - A client's command no longer stops or restarts any supervised session either; the client is told to run `robota session stop <id>`, and the saved change applies to a new session from `robota session start --background`.
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
- f01868f: `sandbox.autoAllowBashIfSandboxed` takes effect. The CLI confined shell commands in the OS sandbox,
  but no session learned about the sandbox, so a confined command still asked for approval in the
  terminal UI, a served runtime and MCP serve, and a print run with no one to approve it refused it.

  - `agent-cli` (patch): a served session, and each session a daemon keeps live, receives the sandbox
    the shell tools run under.
  - `agent-framework` (minor): `HeadlessInteractionChannel` takes a `sandboxClient` option and hands it
    to the session.
  - `agent-ui-terminal` (minor): `renderApp` and `TuiInteractionChannel` take a `sandboxClient` option
    and hand it to each session they build.
- 4f35721: Starting a session from `robota session view` in a folder that is not trusted asks what to do
  instead of failing. The question names the folder and lists what trust would load. The choices are
  `y` to trust the folder and start, `r` to start it Restricted, and `n` to cancel. A Restricted answer
  holds even if the folder was trusted meanwhile. Before, the view showed only "Start failed".

  - `agent-cli` (patch):
    - A background session started Restricted runs with `--restricted-workspace`.
    - A headless start that asked to run Restricted is no longer refused for want of trust, the same
      as `--safe-mode`.
  - `agent-ui-terminal` (minor): the session view takes `startTrustQuestion`, which returns the
    folder and what trust would load (`ISupervisedStartTrustQuestion`). `onStart` receives the person's
    choice (`TSupervisedStartTrustChoice`).
- 4c5148e: ARCH-005 Stage S2 — `configured CLI` is now expressed as an `IProductProfile` and assembled by `assembleProduct`;
  the hand-wired composition root in `agent-cli` is gone.

  - **`@robota-sdk/agent-product`** — provider construction returns IN-KERNEL. `assembleProduct` builds the
    provider from `providerDefinitions` + the shell's already-resolved `providerSettings` vian agent-core's
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
    `agentDefinitions` through the headless and TUI channels so every product surface carries the seam.
  - **`@robota-sdk/agent-cli`** — `configured CLI`'s identity (branding, provider surface, presets,
    `packs: [codingPack]`, base command modules, injected transports/runners/subagent factory) is declared as
    data in a product profile and folded by `assembleProduct`. The coding command modules (`/shell`,
    `/editor`) now come from `pack-coding` rather than the base set, so the pack is load-bearing. What remains
    in the CLI is product-shell only: arg parsing, settings/file IO, terminal notices, first-run/init/
    `--configure`, memory + session-resume UX, and print/serve/TUI mode dispatch.

  End-user `configured CLI` behavior is unchanged in substance — the assembled command-module set, provider surface,
  tool set, subagent roster, and preset resolution all match the pre-change assembly — with one accepted
  cosmetic delta: `/shell` and `/editor` now appear at the END of `/help` output and of the slash-command
  autocomplete popup rather than mid-list, because they arrive from `pack-coding` and both surfaces render in
  module-insertion order. Same commands, same behavior, different position.
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
- 7d9cc66: Preserve an explicitly supplied host tool scheduling policy through session assembly and CLI presentation modes, retaining permission admission and conservative handling of undeclared resources.
- 90e7a10: The default background observer warning code and exported `OBSERVER_FAILURE_WARNING_CODE` value
  change from `PRODUCT_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
  the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
  their background manager or session options. The configured CLI supplies its existing code explicitly
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

- 8625a14: Supervised session control is bound to one process start.

  - Each supervised session start writes a fresh random generation into its private registration. Its
    control endpoint echoes that generation in every reply and refuses any request that carries a
    different one, or none.
  - `session view` keeps the generation each row was verified with. Stop and linked-PR opening send it,
    so a session that restarted under the same id since the row was shown is refused instead of acted
    on. A stop confirmation also refuses when the row's generation changed while it was open.
  - `session stop`, `rename`, `link-pr` and `unlink-pr` read the generation at request time and the
    session itself checks it, closing the window between the liveness check and the action.
  - A registration without a generation (written by an earlier version) is listed but never
    controllable; restart that session to control it again.
  - The generation is never printed by `session list` in text or JSON.
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
- 2711ec6: One broken skill or agent file no longer stops the session.

  Skill, command and agent definitions are shared with other hosts through `.claude`, and those hosts
  define fields of their own. The frontmatter decoder now validates only the fields the configured CLI owns and
  ignores the rest (nested `metadata` entries included); a malformed value of an owned field is still
  refused. A refused file is skipped with a single warning and still claims its name, so a
  lower-priority definition cannot stand in for it. An empty `argument-hint` reads as no hint. When
  initialization does fail, the session reports the cause to readiness probes instead of "not
  initialized", so the terminal shows the reason at once rather than a 15-second timeout.

  The terminal also stops printing type names for message-less telemetry records, keeps its own notices
  in place across a history sync so the following answer is not skipped, and CLI diagnostics print
  their context instead of `[object Object]`, through the console so Ink renders them above the frame.
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
- 9721162: A key typed just as a prompt appears no longer answers it: in the terminal UI the permission prompt, and in the web UI both the permission and the ask dock.

  - **`agent-ui-terminal`:** the permission prompt ignores its keys for a short pause after it appears (`PERMISSION_PROMPT_ARM_DELAY_MS`). While it waits it shows "keys answer in a moment" and no selection cursor. In screen-reader mode, a number typed during the pause, or typed for the previous request, is not kept for a later Enter.
  - **`agent-ui-web`:** the docked permission or ask prompt waits a short pause (`PROMPT_ARM_DELAY_MS`) before it takes focus, so keys typed during that pause stay in the composer. While it waits it says so. A mouse click on a button answers at once, and Esc still denies or cancels; Enter or Space on a focused button waits like any other key, and a button focused to answer one prompt hands focus back to the dock when the next appears.
- 57280bf: Every published package now declares `"engines": { "node": ">=22.12.0" }`. Before, 27 of the 38
  packages declared no floor (`agent-core`, `agent-tools` and every provider among them),
  `agent-session` and `agent-file-authority` declared `>=20.19.0`, and the other nine declared
  `>=22.0.0`, so a consumer on Node 20 saw at most a warning from a transitive dependency.

  Why 22.12: `agent-cli` and `agent-ui-terminal` need Node 22 through `ink` 7, and the CommonJS entries
  of `agent-tools` and its dependents, `agent-transport`/`node` and its dependents, and
  `agent-ui-terminal` `require()` ESM-only dependencies (`p-limit`, `jose`, `chalk`), which Node 22
  supports unflagged only from 22.12. `engines` is advisory unless the consumer enables `engine-strict`.

  No code changes: `tsdown` now reads `node22.12.0` as its build target from the field.
- 1efb124: `@robota-sdk/agent-cli` and `@robota-sdk/agent-ui-terminal` are now ESM-only. Their CommonJS entry
  could never load: it pulls in Ink, whose `yoga-layout` dependency starts with a top-level `await`, so
  `require()` failed on every Node version with `ERR_REQUIRE_ASYNC_MODULE`. The packages no longer
  declare a `require` condition or ship `index.cjs`/`index.d.cts`, so `require()` now fails at resolution
  with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Load them with `import` or `import()`, which is unchanged. The
  configured CLI executable is unaffected.
- 18c0d5c: Every published package now exports `./package.json`, so `require('<package>/package.json')` and
  `import('<package>/package.json', { with: { type: 'json' } })` work instead of failing with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and each tarball now ships the package's `CHANGELOG.md`.
- 2c612ba: Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
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
- dfb9b15: Release the integrated provider credential isolation and consumer runtime and interaction composition updates.
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
- Updated dependencies [50d2c9f]
- Updated dependencies [3c81769]
- Updated dependencies [724fabb]
- Updated dependencies [d877de2]
- Updated dependencies [d61e159]
- Updated dependencies [997f2fb]
- Updated dependencies [bfe8ed5]
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
- Updated dependencies [9a01e78]
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
- Updated dependencies [3427887]
- Updated dependencies [7116367]
- Updated dependencies [5bb675a]
- Updated dependencies [c967c57]
- Updated dependencies [e706b43]
- Updated dependencies [fef3a50]
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [6f41c53]
- Updated dependencies [7d9cc66]
- Updated dependencies [4c5148e]
- Updated dependencies [37af5dc]
- Updated dependencies [0116a29]
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
- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [3244fb8]
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
- Updated dependencies [7669851]
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
- Updated dependencies [5c5ff23]
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
  - @robota-sdk/agent-interface-transport@3.0.0
  - @robota-sdk/agent-transport@3.0.0
  - @robota-sdk/agent-interface-analytics@3.0.0
  - @robota-sdk/agent-interface-tui@3.0.0

## 3.0.0-beta.106
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.106
  - @robota-sdk/agent-framework@3.0.0-beta.106
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.106
  - @robota-sdk/agent-interface-command@3.0.0-beta.106
  - @robota-sdk/agent-interface-execution@3.0.0-beta.106
  - @robota-sdk/agent-interface-session@3.0.0-beta.106
  - @robota-sdk/agent-interface-transport@3.0.0-beta.106
  - @robota-sdk/agent-interface-tui@3.0.0-beta.106
  - @robota-sdk/agent-transport@3.0.0-beta.106

## 3.0.0-beta.105
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.105
  - @robota-sdk/agent-framework@3.0.0-beta.105
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.105
  - @robota-sdk/agent-interface-command@3.0.0-beta.105
  - @robota-sdk/agent-interface-execution@3.0.0-beta.105
  - @robota-sdk/agent-interface-session@3.0.0-beta.105
  - @robota-sdk/agent-interface-transport@3.0.0-beta.105
  - @robota-sdk/agent-interface-tui@3.0.0-beta.105
  - @robota-sdk/agent-transport@3.0.0-beta.105

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.104
  - @robota-sdk/agent-framework@3.0.0-beta.104
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.104
  - @robota-sdk/agent-interface-command@3.0.0-beta.104
  - @robota-sdk/agent-interface-execution@3.0.0-beta.104
  - @robota-sdk/agent-interface-session@3.0.0-beta.104
  - @robota-sdk/agent-interface-transport@3.0.0-beta.104
  - @robota-sdk/agent-interface-tui@3.0.0-beta.104
  - @robota-sdk/agent-transport@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

- Updated dependencies [6f41c53]
  - @robota-sdk/agent-core@3.0.0-beta.103
  - @robota-sdk/agent-framework@3.0.0-beta.103
  - @robota-sdk/agent-interface-command@3.0.0-beta.103
  - @robota-sdk/agent-interface-execution@3.0.0-beta.103
  - @robota-sdk/agent-interface-session@3.0.0-beta.103
  - @robota-sdk/agent-interface-transport@3.0.0-beta.103
  - @robota-sdk/agent-transport@3.0.0-beta.103
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.103
  - @robota-sdk/agent-interface-tui@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.102
  - @robota-sdk/agent-framework@3.0.0-beta.102
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.102
  - @robota-sdk/agent-interface-command@3.0.0-beta.102
  - @robota-sdk/agent-interface-execution@3.0.0-beta.102
  - @robota-sdk/agent-interface-session@3.0.0-beta.102
  - @robota-sdk/agent-interface-transport@3.0.0-beta.102
  - @robota-sdk/agent-interface-tui@3.0.0-beta.102
  - @robota-sdk/agent-transport@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

- Updated dependencies [62663ae]
  - @robota-sdk/agent-core@3.0.0-beta.101
  - @robota-sdk/agent-framework@3.0.0-beta.101
  - @robota-sdk/agent-interface-command@3.0.0-beta.101
  - @robota-sdk/agent-interface-execution@3.0.0-beta.101
  - @robota-sdk/agent-interface-session@3.0.0-beta.101
  - @robota-sdk/agent-interface-transport@3.0.0-beta.101
  - @robota-sdk/agent-transport@3.0.0-beta.101
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.101
  - @robota-sdk/agent-interface-tui@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.100
  - @robota-sdk/agent-framework@3.0.0-beta.100
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.100
  - @robota-sdk/agent-interface-command@3.0.0-beta.100
  - @robota-sdk/agent-interface-execution@3.0.0-beta.100
  - @robota-sdk/agent-interface-session@3.0.0-beta.100
  - @robota-sdk/agent-interface-transport@3.0.0-beta.100
  - @robota-sdk/agent-interface-tui@3.0.0-beta.100
  - @robota-sdk/agent-transport@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.99
  - @robota-sdk/agent-framework@3.0.0-beta.99
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.99
  - @robota-sdk/agent-interface-command@3.0.0-beta.99
  - @robota-sdk/agent-interface-execution@3.0.0-beta.99
  - @robota-sdk/agent-interface-session@3.0.0-beta.99
  - @robota-sdk/agent-interface-transport@3.0.0-beta.99
  - @robota-sdk/agent-interface-tui@3.0.0-beta.99
  - @robota-sdk/agent-transport@3.0.0-beta.99

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.98
  - @robota-sdk/agent-framework@3.0.0-beta.98
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.98
  - @robota-sdk/agent-interface-command@3.0.0-beta.98
  - @robota-sdk/agent-interface-execution@3.0.0-beta.98
  - @robota-sdk/agent-interface-session@3.0.0-beta.98
  - @robota-sdk/agent-interface-transport@3.0.0-beta.98
  - @robota-sdk/agent-interface-tui@3.0.0-beta.98
  - @robota-sdk/agent-transport@3.0.0-beta.98

## 3.0.0-beta.97
### Patch Changes

- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [7911a7d]
- Updated dependencies [23a30cd]
  - @robota-sdk/agent-core@3.0.0-beta.97
  - @robota-sdk/agent-transport@3.0.0-beta.97
  - @robota-sdk/agent-interface-session@3.0.0-beta.97
  - @robota-sdk/agent-framework@3.0.0-beta.97
  - @robota-sdk/agent-interface-command@3.0.0-beta.97
  - @robota-sdk/agent-interface-execution@3.0.0-beta.97
  - @robota-sdk/agent-interface-transport@3.0.0-beta.97
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.97
  - @robota-sdk/agent-interface-tui@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.96
  - @robota-sdk/agent-framework@3.0.0-beta.96
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.96
  - @robota-sdk/agent-interface-command@3.0.0-beta.96
  - @robota-sdk/agent-interface-execution@3.0.0-beta.96
  - @robota-sdk/agent-interface-session@3.0.0-beta.96
  - @robota-sdk/agent-interface-transport@3.0.0-beta.96
  - @robota-sdk/agent-interface-tui@3.0.0-beta.96
  - @robota-sdk/agent-transport@3.0.0-beta.96

## 3.0.0-beta.95
### Patch Changes

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
- Updated dependencies [c967c57]
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-transport@3.0.0-beta.95
  - @robota-sdk/agent-interface-session@3.0.0-beta.95
  - @robota-sdk/agent-framework@3.0.0-beta.95
  - @robota-sdk/agent-core@3.0.0-beta.95
  - @robota-sdk/agent-interface-command@3.0.0-beta.95
  - @robota-sdk/agent-interface-execution@3.0.0-beta.95
  - @robota-sdk/agent-interface-transport@3.0.0-beta.95
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.95
  - @robota-sdk/agent-interface-tui@3.0.0-beta.95

## 3.0.0-beta.94
### Patch Changes

- Updated dependencies [e079992]
- Updated dependencies [e706b43]
- Updated dependencies [fef3a50]
  - @robota-sdk/agent-framework@3.0.0-beta.94
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.94
  - @robota-sdk/agent-interface-session@3.0.0-beta.94
  - @robota-sdk/agent-transport@3.0.0-beta.94
  - @robota-sdk/agent-core@3.0.0-beta.94
  - @robota-sdk/agent-interface-command@3.0.0-beta.94
  - @robota-sdk/agent-interface-execution@3.0.0-beta.94
  - @robota-sdk/agent-interface-transport@3.0.0-beta.94
  - @robota-sdk/agent-interface-tui@3.0.0-beta.94

## 3.0.0-beta.93
### Patch Changes

- Release the integrated provider credential isolation and consumer runtime and interaction composition updates.
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.93
  - @robota-sdk/agent-framework@3.0.0-beta.93
  - @robota-sdk/agent-interface-execution@3.0.0-beta.93
  - @robota-sdk/agent-interface-command@3.0.0-beta.93
  - @robota-sdk/agent-interface-session@3.0.0-beta.93
  - @robota-sdk/agent-interface-transport@3.0.0-beta.93
  - @robota-sdk/agent-transport@3.0.0-beta.93
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.93
  - @robota-sdk/agent-interface-tui@3.0.0-beta.93

## 3.0.0-beta.92
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.92
  - @robota-sdk/agent-framework@3.0.0-beta.92
  - @robota-sdk/agent-interface-command@3.0.0-beta.92
  - @robota-sdk/agent-interface-execution@3.0.0-beta.92
  - @robota-sdk/agent-interface-session@3.0.0-beta.92
  - @robota-sdk/agent-interface-transport@3.0.0-beta.92
  - @robota-sdk/agent-transport@3.0.0-beta.92
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.92
  - @robota-sdk/agent-interface-tui@3.0.0-beta.92

## 3.0.0-beta.91
### Patch Changes

- Updated dependencies [bad976f]
  - @robota-sdk/agent-framework@3.0.0-beta.91
  - @robota-sdk/agent-core@3.0.0-beta.91
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.91
  - @robota-sdk/agent-interface-command@3.0.0-beta.91
  - @robota-sdk/agent-interface-execution@3.0.0-beta.91
  - @robota-sdk/agent-interface-session@3.0.0-beta.91
  - @robota-sdk/agent-interface-transport@3.0.0-beta.91
  - @robota-sdk/agent-interface-tui@3.0.0-beta.91
  - @robota-sdk/agent-transport@3.0.0-beta.91

## 3.0.0-beta.90
### Patch Changes

- Updated dependencies [7116367]
- Updated dependencies [5bb675a]
  - @robota-sdk/agent-framework@3.0.0-beta.90
  - @robota-sdk/agent-core@3.0.0-beta.90
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.90
  - @robota-sdk/agent-interface-command@3.0.0-beta.90
  - @robota-sdk/agent-interface-execution@3.0.0-beta.90
  - @robota-sdk/agent-interface-session@3.0.0-beta.90
  - @robota-sdk/agent-interface-transport@3.0.0-beta.90
  - @robota-sdk/agent-interface-tui@3.0.0-beta.90
  - @robota-sdk/agent-transport@3.0.0-beta.90

## 3.0.0-beta.89
### Patch Changes

- Updated dependencies [3427887]
  - @robota-sdk/agent-transport@3.0.0-beta.89
  - @robota-sdk/agent-framework@3.0.0-beta.89
  - @robota-sdk/agent-core@3.0.0-beta.89
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.89
  - @robota-sdk/agent-interface-command@3.0.0-beta.89
  - @robota-sdk/agent-interface-execution@3.0.0-beta.89
  - @robota-sdk/agent-interface-session@3.0.0-beta.89
  - @robota-sdk/agent-interface-transport@3.0.0-beta.89
  - @robota-sdk/agent-interface-tui@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- @robota-sdk/agent-framework@3.0.0-beta.88
- @robota-sdk/agent-core@3.0.0-beta.88
- @robota-sdk/agent-interface-analytics@3.0.0-beta.88
- @robota-sdk/agent-interface-command@3.0.0-beta.88
- @robota-sdk/agent-interface-execution@3.0.0-beta.88
- @robota-sdk/agent-interface-session@3.0.0-beta.88
- @robota-sdk/agent-interface-transport@3.0.0-beta.88
- @robota-sdk/agent-interface-tui@3.0.0-beta.88
- @robota-sdk/agent-transport@3.0.0-beta.88

## 3.0.0-beta.87

### Minor Changes

- 7d9cc66: Preserve an explicitly supplied host tool scheduling policy through session assembly and CLI presentation modes, retaining permission admission and conservative handling of undeclared resources.

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
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
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.87
  - @robota-sdk/agent-interface-command@3.0.0-beta.87
  - @robota-sdk/agent-interface-execution@3.0.0-beta.87
  - @robota-sdk/agent-interface-session@3.0.0-beta.87
  - @robota-sdk/agent-interface-transport@3.0.0-beta.87
  - @robota-sdk/agent-interface-tui@3.0.0-beta.87
  - @robota-sdk/agent-transport@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.86
- @robota-sdk/agent-framework@3.0.0-beta.86
- @robota-sdk/agent-interface-analytics@3.0.0-beta.86
- @robota-sdk/agent-interface-command@3.0.0-beta.86
- @robota-sdk/agent-interface-execution@3.0.0-beta.86
- @robota-sdk/agent-interface-session@3.0.0-beta.86
- @robota-sdk/agent-interface-transport@3.0.0-beta.86
- @robota-sdk/agent-interface-tui@3.0.0-beta.86
- @robota-sdk/agent-transport@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [4e11579]
- Updated dependencies [41cca13]
- Updated dependencies [193a0bc]
- Updated dependencies [54e2848]
- Updated dependencies [9a01e78]
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
  - @robota-sdk/agent-transport@3.0.0-beta.85
  - @robota-sdk/agent-interface-execution@3.0.0-beta.85
  - @robota-sdk/agent-interface-session@3.0.0-beta.85
  - @robota-sdk/agent-interface-transport@3.0.0-beta.85
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.85
  - @robota-sdk/agent-interface-tui@3.0.0-beta.85

## 3.0.0-beta.84

### Minor Changes

- 4f35721: Starting a session from `__PRODUCT_CLI_NAME__ session view` in a folder that is not trusted asks what to do
  instead of failing. The question names the folder and lists what trust would load. The choices are
  `y` to trust the folder and start, `r` to start it Restricted, and `n` to cancel. A Restricted answer
  holds even if the folder was trusted meanwhile. Before, the view showed only "Start failed".

  - `agent-cli` (patch):
    - A background session started Restricted runs with `--restricted-workspace`.
    - A headless start that asked to run Restricted is no longer refused for want of trust, the same
      as `--safe-mode`.
  - `agent-ui-terminal` (minor): the session view takes `startTrustQuestion`, which returns the
    folder and what trust would load (`ISupervisedStartTrustQuestion`). `onStart` receives the person's
    choice (`TSupervisedStartTrustChoice`).

### Patch Changes

- Updated dependencies [9f46375]
- Updated dependencies [e8d70ac]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-core@3.0.0-beta.84
  - @robota-sdk/agent-framework@3.0.0-beta.84
  - @robota-sdk/agent-interface-session@3.0.0-beta.84
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.84
  - @robota-sdk/agent-interface-execution@3.0.0-beta.84
  - @robota-sdk/agent-transport@3.0.0-beta.84
  - @robota-sdk/agent-interface-command@3.0.0-beta.84
  - @robota-sdk/agent-interface-transport@3.0.0-beta.84
  - @robota-sdk/agent-interface-tui@3.0.0-beta.84

## 3.0.0-beta.83

### Major Changes

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

### Minor Changes

- 617b795: `__PRODUCT_CLI_NAME__ session attach <id> [--observe]` puts this terminal on a live supervised session.

  - It asks first, on the controlling terminal, naming the session and the role: drive (send prompts,
    answer its questions) or observe (read only). The yes holds only for the process start it named: if
    the session restarted meanwhile, the attach is refused.
  - It needs an interactive terminal. Without one (a script, or an agent running shell commands) it is
    refused and prints the command for the user to run. It is not available as a slash command or a
    model tool.
  - The terminal view shows the conversation so far, then follows the session live: streaming replies,
    tools, other terminals' prompts, queued input and questions. In drive mode it sends prompts and
    `/commands` and answers permission prompts and questions; a question answered on another surface is
    dismissed. Observe mode is labelled read-only and sends nothing but reads.
  - `/exit`, `/quit`, Ctrl-C and Ctrl-] detach. Nothing is sent to the session, so its turn continues and
    it keeps running; stop it with `__PRODUCT_CLI_NAME__ session stop` or from `__PRODUCT_CLI_NAME__ session view`.
  - The attached terminal is the full terminal UI (`renderAttachedApp` in `agent-ui-terminal`).
  - A handshake from a connection that already closed no longer holds one of the session's attach slots.

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

- 1706d29: `__PRODUCT_CLI_NAME__ session view` attaches to and peeks at sessions.

  - `a` attaches to the selected session to drive it, and `p` peeks at it read-only. Both are offered, in
    the footer and in help, only on a row that is alive, controllable and verified. The view asks first,
    naming the role. The yes is held to the process start the row showed: if the session restarted or
    lost control meanwhile, the attach is refused. Detaching returns to the view, on the same row and
    grouping, without printing the screen-reader line again.
  - **Breaking:** opening a row's linked PR moves from `p` to `o`.
  - The attached view shows the keys for what is on screen: sending, answering a permission, or
    answering a question. With a screen reader it words every line ("Prompt from attach:2: …",
    "Tool started: …", "Permission needed: …") and uses no symbols.
  - Questions wait their turn: a second permission request or question no longer replaces the one on
    screen, and one settled elsewhere leaves the queue.
  - Line breaks inside pasted text become spaces instead of sending the text. In a masked answer they are
    dropped, so a copied key that ends with a line break is kept exactly.
  - `__PRODUCT_CLI_NAME__ session attach` accepts `--screen-reader` and `--no-screen-reader`.
  - The attach client closes a connection that sends more frames than it can hold before the view reads
    them.

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

- 6e6b06b: `__PRODUCT_CLI_NAME__ --attach` puts the full terminal UI on this workspace's running daemon.

  - **`agent-ui-terminal`:**
    - `renderAttachedApp` renders the same App over a wire connection, through `WireTuiChannel`, a second implementation of the TUI's channel port.
    - Leaving detaches; the daemon keeps running.
    - The session picker lists and switches the daemon's sessions. It opens on the daemon's answer to `/resume`; a daemon that cannot list its sessions says why instead.
    - With no saved sessions to resume, `/resume` says so and keeps the prompt, instead of opening an empty picker that blocks input. This applies to the in-process TUI too.
    - The session picker lists an unnamed session by the part of its id that differs, not by the `session_` prefix every id shares. This applies to the in-process TUI too.
    - The status bar names the daemon's current session: its name, or else its short id.
    - A question already open when the terminal attaches is shown, and a long session's history reaches the terminal without the daemon cutting it off.
    - Features that belong to the runtime process say they are unavailable while attached: the plugin manager, background task details and sending to an agent job.
  - **`agent-cli`:**
    - `__PRODUCT_CLI_NAME__ --attach` finds the workspace daemon and asks the user to confirm on the terminal, as `__PRODUCT_CLI_NAME__ session attach` does, then attaches.
    - Options that shape a session are refused, because the daemon shapes its session.
    - A terminal attached over the supervised socket can now list, start and switch sessions.
    - A client's command no longer stops or restarts the workspace daemon. `/language`, `/reset`, `/exit` and provider setup or switch keep their saved change, and the client is told to run `__PRODUCT_CLI_NAME__ daemon stop`, then `__PRODUCT_CLI_NAME__ daemon start`.
    - `__PRODUCT_CLI_NAME__ --attach` installs the plain TUI's process guards, so an error the plain TUI survives no longer ends the attached terminal.
    - A client's command no longer stops or restarts any supervised session either; the client is told to run `__PRODUCT_CLI_NAME__ session stop <id>`, and the saved change applies to a new session from `__PRODUCT_CLI_NAME__ session start --background`.

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

### Patch Changes

- 8625a14: Supervised session control is bound to one process start.

  - Each supervised session start writes a fresh random generation into its private registration. Its
    control endpoint echoes that generation in every reply and refuses any request that carries a
    different one, or none.
  - `session view` keeps the generation each row was verified with. Stop and linked-PR opening send it,
    so a session that restarted under the same id since the row was shown is refused instead of acted
    on. A stop confirmation also refuses when the row's generation changed while it was open.
  - `session stop`, `rename`, `link-pr` and `unlink-pr` read the generation at request time and the
    session itself checks it, closing the window between the liveness check and the action.
  - A registration without a generation (written by an earlier version) is listed but never
    controllable; restart that session to control it again.
  - The generation is never printed by `session list` in text or JSON.

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

- 9721162: A key typed just as a prompt appears no longer answers it: in the terminal UI the permission prompt, and in the web UI both the permission and the ask dock.

  - **`agent-ui-terminal`:** the permission prompt ignores its keys for a short pause after it appears (`PERMISSION_PROMPT_ARM_DELAY_MS`). While it waits it shows "keys answer in a moment" and no selection cursor. In screen-reader mode, a number typed during the pause, or typed for the previous request, is not kept for a later Enter.
  - **`agent-ui-web`:** the docked permission or ask prompt waits a short pause (`PROMPT_ARM_DELAY_MS`) before it takes focus, so keys typed during that pause stay in the composer. While it waits it says so. A mouse click on a button answers at once, and Esc still denies or cancels; Enter or Space on a focused button waits like any other key, and a button focused to answer one prompt hands focus back to the dock when the next appears.

- 57280bf: Every published package now declares `"engines": { "node": ">=22.12.0" }`. Before, 27 of the 38
  packages declared no floor (`agent-core`, `agent-tools` and every provider among them),
  `agent-session` and `agent-file-authority` declared `>=20.19.0`, and the other nine declared
  `>=22.0.0`, so a consumer on Node 20 saw at most a warning from a transitive dependency.

  Why 22.12: `agent-cli` and `agent-ui-terminal` need Node 22 through `ink` 7, and the CommonJS entries
  of `agent-tools` and its dependents, `agent-transport`/`node` and its dependents, and
  `agent-ui-terminal` `require()` ESM-only dependencies (`p-limit`, `jose`, `chalk`), which Node 22
  supports unflagged only from 22.12. `engines` is advisory unless the consumer enables `engine-strict`.

  No code changes: `tsdown` now reads `node22.12.0` as its build target from the field.

- 1efb124: `@robota-sdk/agent-cli` and `@robota-sdk/agent-ui-terminal` are now ESM-only. Their CommonJS entry
  could never load: it pulls in Ink, whose `yoga-layout` dependency starts with a top-level `await`, so
  `require()` failed on every Node version with `ERR_REQUIRE_ASYNC_MODULE`. The packages no longer
  declare a `require` condition or ship `index.cjs`/`index.d.cts`, so `require()` now fails at resolution
  with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Load them with `import` or `import()`, which is unchanged. The
  `__PRODUCT_CLI_NAME__` executable is unaffected.
- 18c0d5c: Every published package now exports `./package.json`, so `require('<package>/package.json')` and
  `import('<package>/package.json', { with: { type: 'json' } })` work instead of failing with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and each tarball now ships the package's `CHANGELOG.md`.
- Updated dependencies [3c81769]
- Updated dependencies [724fabb]
- Updated dependencies [d877de2]
- Updated dependencies [d61e159]
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
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.83
  - @robota-sdk/agent-framework@3.0.0-beta.83
  - @robota-sdk/agent-interface-transport@3.0.0-beta.83
  - @robota-sdk/agent-transport@3.0.0-beta.83
  - @robota-sdk/agent-core@3.0.0-beta.83
  - @robota-sdk/agent-interface-session@3.0.0-beta.83
  - @robota-sdk/agent-interface-command@3.0.0-beta.83
  - @robota-sdk/agent-interface-execution@3.0.0-beta.83
  - @robota-sdk/agent-interface-tui@3.0.0-beta.83

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-framework@3.0.0-beta.82
  - @robota-sdk/agent-interface-command@3.0.0-beta.82
  - @robota-sdk/agent-interface-execution@3.0.0-beta.82
  - @robota-sdk/agent-interface-session@3.0.0-beta.82
  - @robota-sdk/agent-interface-transport@3.0.0-beta.82
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.82
  - @robota-sdk/agent-interface-tui@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

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
  - @robota-sdk/agent-interface-transport@3.0.0-beta.81
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.81
  - @robota-sdk/agent-interface-tui@3.0.0-beta.81

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

- f3fe3db: The terminal renderer no longer reads `PRODUCT_SCREEN_READER_STARTUP_QUIET_MS` or
  `PRODUCT_SCREEN_READER_PREPARK_MS` from the process environment. SDK hosts calling `renderApp`
  directly should pass raw timing choices and diagnostic labels through the new optional
  `screenReaderPacing` render option. Without it, the renderer uses its existing 900 ms startup
  quiet period and 50 ms pre-write park when screen-reader mode is enabled. The __PRODUCT_DISPLAY_NAME__ CLI still
  reads the same environment variables and preserves their validation, bounds, and warnings.
- 724d5b6: The terminal renderer no longer reads `PRODUCT_IME_CURSOR` or `PRODUCT_TURN_MARKS` from the process environment. SDK hosts calling `renderApp` directly should pass cursor and turn-mark choices through the optional `terminalCapabilities` render option. Without a host choice, the renderer keeps its terminal and TTY defaults. The __PRODUCT_DISPLAY_NAME__ CLI still reads both environment variables and preserves its exact `1` and `0` overrides.

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
  change from `PRODUCT_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
  the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
  their background manager or session options. The __PRODUCT_DISPLAY_NAME__ CLI supplies its existing code explicitly
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
