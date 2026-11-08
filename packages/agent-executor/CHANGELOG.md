# @robota-sdk/agent-executor

## 3.2.3
### Patch Changes

- 327999e: The contract packages are now one package, `@robota-sdk/agent-interface`, with one subpath per family: `session` (and `session/testing`), `session-mobility`, `command`, `execution`, `analytics`, `transport` (and `transport/testing`) and `tui`. Import the subpath of the family you use (`@robota-sdk/agent-interface/session`); there is no root export. `@robota-sdk/agent-core` is now an optional peer dependency: `analytics` and `tui` need nothing, and a project that imports another family installs `agent-core` itself (the SDK packages that import those families declare it). The exported names and signatures are unchanged. `@robota-sdk/agent-interface-session`, `-session-mobility`, `-command`, `-execution`, `-analytics`, `-transport` and `-tui` no longer receive releases. The SDK packages that import a contract depend on `@robota-sdk/agent-interface`.
- 913d334: The host primitives are now one package, `@robota-sdk/agent-os`, with one subpath each: `file-authority` (and `file-authority/testing`), `node-lock` and `process`. Import the subpath you use (`@robota-sdk/agent-os/process`); there is no root export, and a bundle that imports `process` contains no native binding. Koffi is now an optional peer dependency pinned to `3.3.1`: a project that imports `file-authority` or `node-lock` installs it itself, and a project that imports only `process` installs nothing. The exported names and signatures are unchanged. `@robota-sdk/agent-file-authority`, `@robota-sdk/agent-node-lock` and `@robota-sdk/agent-process` no longer receive releases. The framework, session, tools, executor and subagent-runner packages depend on `@robota-sdk/agent-os`; the packages that used the file authority or the lock declare `koffi` themselves, so their installs are unchanged.
- Updated dependencies [1f900da]
- Updated dependencies [327999e]
- Updated dependencies [913d334]
- Updated dependencies [bf901d7]
- Updated dependencies [44f28ee]
  - @robota-sdk/agent-core@3.2.3
  - @robota-sdk/agent-interface@3.3.0
  - @robota-sdk/agent-os@3.3.0

## 3.2.2
### Patch Changes

- 8d05c9b: Allow compatible SDK dependencies to update independently.
- Updated dependencies [8d05c9b]
  - @robota-sdk/agent-interface-execution@3.2.2
  - @robota-sdk/agent-interface-transport@3.2.2

## 3.2.1
### Patch Changes

  - @robota-sdk/agent-core@3.2.1
  - @robota-sdk/agent-interface-execution@3.2.1
  - @robota-sdk/agent-interface-transport@3.2.1
  - @robota-sdk/agent-process@3.2.1

## 3.2.0
### Minor Changes

- e5ce7d6: Preserve restored background task identities and prepare scheduled tasks before resuming them. A resumed schedule activates only after the store confirms a complete save; an unknown result stops initialization without assuming which record is present. Paused schedules stay paused, and a normal shutdown retains scheduled tasks for the next resume.

  When a claimed session has a background manager, it requires an exclusively bound built-in manager. Scheduled tasks in a claimed session require the built-in scheduled runner and a verifiable writer claim. Restoring schedules also requires a store that supplies the restore transaction. Custom managers and scheduled runners remain available to unpersisted sessions, but their saved schedules cannot be resumed. A manager must reserve restored IDs before a session with stored tasks can resume; an already-used manager is refused for a restore.

  The built-in stores serialize claim verification and record replacement with cooperating marker transitions. This requires all writers sharing a session directory to use the operation lock; older writers must be stopped before upgrading. A same-user program that replaces the lock path can bypass this coordination. External commands do not have an exactly-once guarantee.

  When a claimed session detects that it no longer owns the writer claim, it stops admitting wakes and reports a failure without intentionally saving over the new owner. A claim lost after an effect check can still permit an external effect. In-flight subprocess cancellation is best effort, and a process that has already started may still have effects.
- 12ab3f5: Follow a running fork without stopping its parent, steer its job, and continue its record after it ends.

### Patch Changes

- Updated dependencies [12ab3f5]
- Updated dependencies [ffaf7d5]
  - @robota-sdk/agent-interface-execution@3.2.0
  - @robota-sdk/agent-core@3.2.0
  - @robota-sdk/agent-interface-transport@3.2.0
  - @robota-sdk/agent-process@3.2.0

## 3.1.2
### Patch Changes

  - @robota-sdk/agent-core@3.1.2
  - @robota-sdk/agent-interface-execution@3.1.2
  - @robota-sdk/agent-interface-transport@3.1.2
  - @robota-sdk/agent-process@3.1.2

## 3.1.1
### Patch Changes

  - @robota-sdk/agent-core@3.1.1
  - @robota-sdk/agent-interface-execution@3.1.1
  - @robota-sdk/agent-interface-transport@3.1.1
  - @robota-sdk/agent-process@3.1.1

## 3.1.0
### Minor Changes

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
- a2d36ea: Session assembly, the runtime and the query read what the host lends instead of reaching for Node. A capability the host leaves out is absent, and `{}` is a valid host.

  - `@robota-sdk/agent-framework`: the home directory, workspace path resolver and path canonicalizer a `Session` receives come from `host.homeDirectory`, `host.createWorkspacePathResolver` and `host.canonicalizePath`; one the host omits is not passed, and the session treats it as agent-session documents. The hook executors come from `host.createHookExecutors` (given the shell a product chose for command hooks): a host that lends none seeds none, and a config that declares a command or HTTP hook is refused at assembly, naming the host member. A subagent given no executor list gets the host's; when the host lends none, `createSubagentSession` refuses a declared hook at construction, as its parent does, instead of letting a hook on an advisory event run nothing. The default tool tier comes from `host.createDefaultTools`: a host that lends none has no default tier, `defaultTools` still replaces it, and the framework's runtime code no longer imports `@robota-sdk/agent-tool-defaults` at all (the dynamic import is gone). `createQuery({ host: {}, ... })` therefore has no built-in tools; pass `createNodeFrameworkHost({ createDefaultTools })` for the tools the CLI has. The background task runners of `createAgentRuntime` default to `host.createBackgroundTaskRunners()`, else none, and a task kind with no runner is refused by the manager. A failed lifecycle observer goes to `host.reportObserverFailure`, else the executor's own `console.warn` line. The auto-mode classifier lists git remotes through `host.readGitRemotes`; a host that lends none trusts no remote. A trusted `projectAccess` on `createQuery` or `createAgentRuntime` needs `host.canonicalizePath`; without it they throw `WorkspaceAuthorityRequiredError`. `createSession` no longer imports `node:crypto`. `BackgroundJobOrchestrator` takes `reportObserverFailure` in its options. `createSubagentLogger`, `migrateSubagentTranscripts`, `readSubagentTranscriptPage`, `resolveSubagentLogDir`, `resolveSubagentLogSessionId`, `resolveSubagentTranscriptPath` and their types move from the main entry to `@robota-sdk/agent-framework/node`.
  - `@robota-sdk/agent-executor`: exports `reportObserverFailureAsConsoleWarning`, the line a manager writes when no reporter is given, for an owner that delivers to observers itself.
  - `@robota-sdk/agent-subagent-runner`, `@robota-sdk/agent-cli`: import the subagent transcript functions from `@robota-sdk/agent-framework/node`.
- 8069d0e: Make the plugin and executor packages platform-neutral.

  - `@robota-sdk/agent-core` exports `sha256Hex` (string or bytes), `hmacSha256Hex`, `randomHex` and `constantTimeEqual`, built on `jssha` and `crypto.getRandomValues`, so neutral packages need no `node:crypto`.
  - `@robota-sdk/agent-plugin`: the `file` strategies of `ConversationHistoryPlugin`, `LoggingPlugin` and `UsagePlugin` write through a `fileStore` option (the new `IPluginTextFileStore` port) and throw a `ConfigurationError` at construction without one; `FileHistoryStorage`, `FileUsageStorage` and `FileLogStorage` take the store as a constructor argument. `NodePluginTextFileStore` is the Node implementation, and `NodeSystemMetricsCollector` moved from the main entry, both on the new `@robota-sdk/agent-plugin/node`. `PerformancePlugin` reads system metrics only through a `metricsCollector` option: memory and CPU monitoring default to on when one is given and off otherwise, and turning monitoring on without one throws a `ConfigurationError` at construction.
  - `@robota-sdk/agent-executor`: `createDefaultBackgroundTaskRunners`, `createManagedShellProcessRunner`, `createScheduledTaskRunner`, `resolveBackgroundTaskShellCommand` and their option types moved to `@robota-sdk/agent-executor/node`; `nextScheduledFireOnOrAfter` stays on the main entry. `reportObserverFailureAsWarning` is replaced by `reportObserverFailureAsProcessWarning` on `/node`; the default observer-failure reporter of `BackgroundTaskManager` now writes a `console.warn` line prefixed with the same code (on Node it still reaches stderr), so a host that wants the process warning passes `onObserverFailure` (`SubagentManager` forwards the new option of that name).
  - `@robota-sdk/agent-executor`: the environment resolver argument of `resolveProfileApiKey`, `createProviderFromProfile` and `createProviderFromExactProfile` is required (pass `processEnvResolver` from `@robota-sdk/agent-core/node`), and `hookTypeExecutors` is a required option of `createWorktreeSubagentRunner` and `WorktreeSubagentRunner`, which no longer default to the command and HTTP hook executors.
- b56b5a9: Ship one build per package. The platform-neutral entries moved from `dist/node` to `dist`, and the second
  `dist/browser` build of `@robota-sdk/agent-core`, `@robota-sdk/agent-transport`,
  `@robota-sdk/agent-ui-web` and `@robota-sdk/agent-transport-webrtc-web` is gone: a neutral entry runs
  unchanged in every runtime, so a subpath's `exports` map `import` and `require` to the same files and no
  longer a `node` or `browser` condition (a Node-only subpath keeps `"browser": null`). Import specifiers
  and the code behind them are unchanged; only a deep import of `dist/node/*` or `dist/browser/*` breaks.
  `@robota-sdk/agent-transport/client` also ships a CommonJS build now.

### Patch Changes

- 51ad6a4: Children in their own session for secure mode (issue #3679). Nothing turns secure mode on yet, so
  spawning in every product process is unchanged except for the pull-request opener below.

  `@robota-sdk/agent-core/node` adds the child-session policy: `enableOwnChildSessions()` (one-way,
  process-wide, nothing on Windows), `withChildSession(options)`, `execFileInChildSession(...)`,
  `endWithProcess(child)` and `signalChildGroup(child, signal)`, with `resetChildSessionsForTesting()`
  in `@robota-sdk/agent-core/testing`. While the policy is off each returns or runs exactly what the
  caller did before. While on, a child leads its own session and process group, may not inherit a
  terminal descriptor, and its group is killed when the process ends. Command hooks, the identity
  readers, stdio MCP servers, git, the sandbox, background tasks and the CLI's own children use it; the
  terminal handover (`/editor`, `/keybindings`, `/shell`, the workspace-move re-exec) does not.

  Breaking: `removeProcessScopedDirectoriesNow()` is renamed `runProcessEndNow()`, since it now also
  ends the groups of children in their own session. What to do: call `runProcessEndNow()` where a
  crash handler called the old name.

  Plain-mode changes in `@robota-sdk/agent-cli`: the session view opens a pull request with the
  product's own browser opener instead of the `open` package, which is no longer a dependency. macOS
  still runs `open <url>`; Linux runs the `xdg-open` found on `PATH`; Windows runs
  `rundll32 url.dll,FileProtocolHandler <url>` rather than PowerShell's `Start`; and only an https
  link opens. That opener, which sign-in also uses, is now started detached and let go: it settles once
  the opener has started rather than when it exits (it no longer fails after 15 seconds when
  `xdg-open` stays in the foreground), and it is never ended with the process. What to do: nothing.
- Updated dependencies [bc8de21]
- Updated dependencies [51ad6a4]
- Updated dependencies [bc8de21]
- Updated dependencies [eabce48]
- Updated dependencies [82663df]
- Updated dependencies [bc8de21]
- Updated dependencies [04c3233]
- Updated dependencies [9bc13f9]
- Updated dependencies [0a677e9]
- Updated dependencies [5b46d43]
- Updated dependencies [fab48ad]
- Updated dependencies [ea0e424]
- Updated dependencies [0fec62f]
- Updated dependencies [b7b6cd0]
- Updated dependencies [8069d0e]
- Updated dependencies [f5e3057]
- Updated dependencies [d8cb04f]
- Updated dependencies [437ca9e]
- Updated dependencies [44e9640]
- Updated dependencies [b56b5a9]
- Updated dependencies [1c19435]
  - @robota-sdk/agent-core@3.1.0
  - @robota-sdk/agent-interface-execution@3.1.0
  - @robota-sdk/agent-interface-transport@3.1.0
  - @robota-sdk/agent-process@3.1.0

## 3.0.7
### Patch Changes

  - @robota-sdk/agent-core@3.0.7
  - @robota-sdk/agent-interface-execution@3.0.7
  - @robota-sdk/agent-interface-transport@3.0.7
  - @robota-sdk/agent-process@3.0.7

## 3.0.6
### Patch Changes

  - @robota-sdk/agent-core@3.0.6
  - @robota-sdk/agent-interface-execution@3.0.6
  - @robota-sdk/agent-interface-transport@3.0.6
  - @robota-sdk/agent-process@3.0.6

## 3.0.5
### Patch Changes

  - @robota-sdk/agent-core@3.0.5
  - @robota-sdk/agent-interface-execution@3.0.5
  - @robota-sdk/agent-interface-transport@3.0.5
  - @robota-sdk/agent-process@3.0.5

## 3.0.4
### Patch Changes

  - @robota-sdk/agent-core@3.0.4
  - @robota-sdk/agent-interface-execution@3.0.4
  - @robota-sdk/agent-interface-transport@3.0.4
  - @robota-sdk/agent-process@3.0.4

## 3.0.3
### Patch Changes

  - @robota-sdk/agent-core@3.0.3
  - @robota-sdk/agent-interface-execution@3.0.3
  - @robota-sdk/agent-interface-transport@3.0.3
  - @robota-sdk/agent-process@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/agent-core@3.0.2
  - @robota-sdk/agent-interface-execution@3.0.2
  - @robota-sdk/agent-interface-transport@3.0.2
  - @robota-sdk/agent-process@3.0.2

## 3.0.1
### Patch Changes

  - @robota-sdk/agent-core@3.0.1
  - @robota-sdk/agent-interface-execution@3.0.1
  - @robota-sdk/agent-interface-transport@3.0.1
  - @robota-sdk/agent-process@3.0.1

## 3.0.0
### Major Changes

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
- bb4696a: Type each built-in background runner's `start` request to its declared kind. Direct callers with a widened or mismatched request must narrow it before starting a runner. Custom runner classes that implement the exported runner type must specify their kind parameter. Manager registration and dynamic dispatch remain supported.
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
- 90e7a10: The default background observer warning code and exported `OBSERVER_FAILURE_WARNING_CODE` value
  change from `PRODUCT_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
  the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
  their background manager or session options. The configured CLI supplies its existing code explicitly
  across print, goal, serve, MCP, and TUI sessions.

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
- 1698be4: A child-process subagent can no longer send the parent's provider credential to a different
  endpoint.

  - **Before spawning a child**, the parent compares every environment variable that decides where
    the provider connects or which credential it sends. If the child's environment differs, the job
    is refused before the credential leaves the parent. The error names the variable, never its
    value. The variables compared are:
    - the proxy and TLS variables;
    - the variables the provider's SDK reads, such as `OPENAI_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and
      the Vertex settings;
    - the credential's own variable.
  - **The child** repeats the check before it builds its provider. It builds that provider from the
    parent's effective connection exactly: it no longer fills in a base URL, options or a default
    credential from its own registry, and a credential reference that resolves to nothing is refused.
  - **Where the effective connection comes from:** the parent applies its own definition defaults
    (base URL, options). `profileName` is sent only when it names the connection actually sent.
  - **New contracts:**
    - `IProviderDefinition.destinationEnvironment`, declared by every built-in provider.
    - `createProviderFromExactProfile`, `connectionEnvironmentNames`,
      `findConnectionEnvironmentDivergence`, `sealConnectionEnvironment`,
      `verifyConnectionEnvironment` and `TRANSPORT_ENVIRONMENT`.
    - The start payload's `connectionCheck`.
    - The child-process runner's `providerDefinitions` option, now required: a provider with no
      definition there is refused, because its connection cannot be checked.
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
- 2d3b2c0: Make shell resolution executable-aware across managed and scheduled background command runners. The core
  resolver now accepts one request with explicit-executable precedence, returns matching argument families
  for sh/bash, PowerShell/pwsh, and cmd, and fails closed with `UnsupportedShellError` for unknown explicit
  executables. Executor exposes one shared request adapter and both concrete runners consume its pair.

### Patch Changes

- 30e5e50: Reject background runner results whose task ID or kind differs from the task being completed, and report the same mismatch as corruption when decoding a persisted session record.
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
- 2c612ba: Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
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
- 9fbab1b: Provider DIP Stage B (ARCH-PROVIDER-003), part 1: collapse infrastructure. Adds the
  provider-registry-driven `@robota-sdk/dag-node-llm-text` node that supersedes the
  per-vendor LLM nodes + router, relocates the provider config resolver into
  `agent-core`, adds SSOT cost/allowedModels fields, inverts the `llm-text` validator
  tombstone, and wires `createDagFramework({ providers })`. Additive — the per-vendor
  nodes still exist; consumer migration + their removal follow in part 2.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- c6c56a6: Move the concrete `GitWorktreeIsolationAdapter` (git CLI + filesystem I/O) out of the reusable
  `@robota-sdk/agent-executor` runtime-primitives package into the `@robota-sdk/agent-cli` composition
  root, restoring the executor's "creates no Git worktrees" boundary (ARL-02 / ARCH-FIX-024, INFRA-031).

  **Breaking (`@robota-sdk/agent-subagent-runner`):** `worktreeAdapter` is now a **required** option on
  `createChildProcessSubagentRunnerFactory` / `IChildProcessSubagentRunnerOptions`. The concrete git
  default (`createGitWorktreeIsolationAdapter()`) has been removed — inject the adapter at the composition
  root. `@robota-sdk/agent-executor` no longer exports `GitWorktreeIsolationAdapter`,
  `createGitWorktreeIsolationAdapter`, or `IGitWorktreeIsolationAdapterOptions` (the
  `ISubagentWorktreeAdapter` port and `WorktreeSubagentRunner` remain). CLI runtime behavior is unchanged.
- dfb9b15: Release the integrated provider credential isolation and consumer runtime and interaction composition updates.
- 9814afc: Type-SSOT convergence (TYPE-003; re-audit CONTRACT-002/003/011/012 + RUNTIME-47 + STRUCT-04). Behavior is unchanged — this is a type-level refactor. `ITokenUsage` (agent-core) is confirmed as the usage-triple SSOT: `ISessionUsageTotals` and `IBackgroundTaskUsage` become aliases, and every inline `{ promptTokens; completionTokens; totalTokens }` copy (service/orchestration/executor/remote-client shapes) now references the SSOT (structurally identical → patch). The subagent-job contracts derive from the background-task SSOT — `TSubagentJobStatus = Exclude<TBackgroundTaskStatus, 'paused'>`, mode alias, and a `Pick`-projection `ISubagentJobState` — with a compile-enforced parity test so a drifting hand copy can no longer exist. `@robota-sdk/agent-session` is minor because the public `ISessionRecord` type is now the typed `IInteractiveSessionRecord` alias (previously a relaxed `unknown[]` mirror): runtime behavior of `SessionStore` is identical, but downstream code that assigned loose payloads to the record's fields may need explicit casts at its own trust boundary (the framework store facade's `as unknown as` cast bridge is deleted). agent-session's duplicate `@robota-sdk/agent-core` deps/devDeps declaration is also removed (STRUCT-04).
- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [37b4bd7]
- Updated dependencies [4eea54b]
- Updated dependencies [724fabb]
- Updated dependencies [bfe8ed5]
- Updated dependencies [1698be4]
- Updated dependencies [a5961c9]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [e689c8e]
- Updated dependencies [ec5e477]
- Updated dependencies [c7f9203]
- Updated dependencies [be0e53c]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
- Updated dependencies [9f46375]
- Updated dependencies [41cca13]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
- Updated dependencies [2c612ba]
- Updated dependencies [66af868]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [6f41c53]
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
- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
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
- Updated dependencies [7669851]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [df02568]
- Updated dependencies [4b76cfa]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9c6a8db]
- Updated dependencies [dfb9b15]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [5134b3b]
- Updated dependencies [d6b9404]
- Updated dependencies [62663ae]
- Updated dependencies [9c6a8db]
- Updated dependencies [23a30cd]
- Updated dependencies [7d9cc66]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
- Updated dependencies [7d9cc66]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-interface-execution@3.0.0
  - @robota-sdk/agent-core@3.0.0
  - @robota-sdk/agent-interface-transport@3.0.0
  - @robota-sdk/agent-process@3.0.0

## 3.0.0-beta.106
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.106
  - @robota-sdk/agent-interface-execution@3.0.0-beta.106
  - @robota-sdk/agent-interface-transport@3.0.0-beta.106
  - @robota-sdk/agent-process@3.0.0-beta.106

## 3.0.0-beta.105
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.105
  - @robota-sdk/agent-interface-execution@3.0.0-beta.105
  - @robota-sdk/agent-interface-transport@3.0.0-beta.105
  - @robota-sdk/agent-process@3.0.0-beta.105

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.104
  - @robota-sdk/agent-interface-execution@3.0.0-beta.104
  - @robota-sdk/agent-interface-transport@3.0.0-beta.104
  - @robota-sdk/agent-process@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

- Updated dependencies [6f41c53]
  - @robota-sdk/agent-core@3.0.0-beta.103
  - @robota-sdk/agent-interface-execution@3.0.0-beta.103
  - @robota-sdk/agent-interface-transport@3.0.0-beta.103
  - @robota-sdk/agent-process@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.102
  - @robota-sdk/agent-interface-execution@3.0.0-beta.102
  - @robota-sdk/agent-interface-transport@3.0.0-beta.102
  - @robota-sdk/agent-process@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

- Updated dependencies [62663ae]
  - @robota-sdk/agent-core@3.0.0-beta.101
  - @robota-sdk/agent-interface-execution@3.0.0-beta.101
  - @robota-sdk/agent-interface-transport@3.0.0-beta.101
  - @robota-sdk/agent-process@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.100
  - @robota-sdk/agent-interface-execution@3.0.0-beta.100
  - @robota-sdk/agent-interface-transport@3.0.0-beta.100
  - @robota-sdk/agent-process@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.99
  - @robota-sdk/agent-interface-execution@3.0.0-beta.99
  - @robota-sdk/agent-interface-transport@3.0.0-beta.99
  - @robota-sdk/agent-process@3.0.0-beta.99

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.98
  - @robota-sdk/agent-interface-execution@3.0.0-beta.98
  - @robota-sdk/agent-interface-transport@3.0.0-beta.98
  - @robota-sdk/agent-process@3.0.0-beta.98

## 3.0.0-beta.97
### Patch Changes

- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [23a30cd]
  - @robota-sdk/agent-core@3.0.0-beta.97
  - @robota-sdk/agent-interface-execution@3.0.0-beta.97
  - @robota-sdk/agent-interface-transport@3.0.0-beta.97
  - @robota-sdk/agent-process@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.96
  - @robota-sdk/agent-interface-execution@3.0.0-beta.96
  - @robota-sdk/agent-interface-transport@3.0.0-beta.96
  - @robota-sdk/agent-process@3.0.0-beta.96

## 3.0.0-beta.95
### Patch Changes

- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-core@3.0.0-beta.95
  - @robota-sdk/agent-interface-execution@3.0.0-beta.95
  - @robota-sdk/agent-interface-transport@3.0.0-beta.95
  - @robota-sdk/agent-process@3.0.0-beta.95

## 3.0.0-beta.94
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.94
  - @robota-sdk/agent-interface-execution@3.0.0-beta.94
  - @robota-sdk/agent-interface-transport@3.0.0-beta.94
  - @robota-sdk/agent-process@3.0.0-beta.94

## 3.0.0-beta.93
### Patch Changes

- Release the integrated provider credential isolation and consumer runtime and interaction composition updates.
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.93
  - @robota-sdk/agent-interface-execution@3.0.0-beta.93
  - @robota-sdk/agent-interface-transport@3.0.0-beta.93
  - @robota-sdk/agent-process@3.0.0-beta.93

## 3.0.0-beta.92
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.92
  - @robota-sdk/agent-interface-execution@3.0.0-beta.92
  - @robota-sdk/agent-interface-transport@3.0.0-beta.92
  - @robota-sdk/agent-process@3.0.0-beta.92

## 3.0.0-beta.91
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.91
  - @robota-sdk/agent-interface-execution@3.0.0-beta.91
  - @robota-sdk/agent-interface-transport@3.0.0-beta.91
  - @robota-sdk/agent-process@3.0.0-beta.91

## 3.0.0-beta.90
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.90
  - @robota-sdk/agent-interface-execution@3.0.0-beta.90
  - @robota-sdk/agent-interface-transport@3.0.0-beta.90
  - @robota-sdk/agent-process@3.0.0-beta.90

## 3.0.0-beta.89
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.89
  - @robota-sdk/agent-interface-execution@3.0.0-beta.89
  - @robota-sdk/agent-interface-transport@3.0.0-beta.89
  - @robota-sdk/agent-process@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.88
- @robota-sdk/agent-interface-execution@3.0.0-beta.88
- @robota-sdk/agent-interface-transport@3.0.0-beta.88
- @robota-sdk/agent-process@3.0.0-beta.88

## 3.0.0-beta.87

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
  - @robota-sdk/agent-core@3.0.0-beta.87
  - @robota-sdk/agent-interface-execution@3.0.0-beta.87
  - @robota-sdk/agent-interface-transport@3.0.0-beta.87
  - @robota-sdk/agent-process@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.86
- @robota-sdk/agent-interface-execution@3.0.0-beta.86
- @robota-sdk/agent-interface-transport@3.0.0-beta.86
- @robota-sdk/agent-process@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [41cca13]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
  - @robota-sdk/agent-core@3.0.0-beta.85
  - @robota-sdk/agent-interface-execution@3.0.0-beta.85
  - @robota-sdk/agent-interface-transport@3.0.0-beta.85
  - @robota-sdk/agent-process@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- Updated dependencies [9f46375]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-core@3.0.0-beta.84
  - @robota-sdk/agent-interface-execution@3.0.0-beta.84
  - @robota-sdk/agent-interface-transport@3.0.0-beta.84
  - @robota-sdk/agent-process@3.0.0-beta.84

## 3.0.0-beta.83

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
- Updated dependencies [724fabb]
- Updated dependencies [bfe8ed5]
- Updated dependencies [e689c8e]
- Updated dependencies [be0e53c]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
  - @robota-sdk/agent-interface-transport@3.0.0-beta.83
  - @robota-sdk/agent-core@3.0.0-beta.83
  - @robota-sdk/agent-interface-execution@3.0.0-beta.83
  - @robota-sdk/agent-process@3.0.0-beta.83

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-interface-execution@3.0.0-beta.82
  - @robota-sdk/agent-interface-transport@3.0.0-beta.82
  - @robota-sdk/agent-process@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-interface-execution@3.0.0-beta.81
  - @robota-sdk/agent-interface-transport@3.0.0-beta.81
  - @robota-sdk/agent-process@3.0.0-beta.81

## 3.0.0-beta.80

### Major Changes

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

- bb4696a: Type each built-in background runner's `start` request to its declared kind. Direct callers with a widened or mismatched request must narrow it before starting a runner. Custom runner classes that implement the exported runner type must specify their kind parameter. Manager registration and dynamic dispatch remain supported.
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

- 90e7a10: The default background observer warning code and exported `OBSERVER_FAILURE_WARNING_CODE` value
  change from `PRODUCT_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
  the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
  their background manager or session options. The __PRODUCT_DISPLAY_NAME__ CLI supplies its existing code explicitly
  across print, goal, serve, MCP, and TUI sessions.

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

- 1698be4: A child-process subagent can no longer send the parent's provider credential to a different
  endpoint.

  - **Before spawning a child**, the parent compares every environment variable that decides where
    the provider connects or which credential it sends. If the child's environment differs, the job
    is refused before the credential leaves the parent. The error names the variable, never its
    value. The variables compared are:
    - the proxy and TLS variables;
    - the variables the provider's SDK reads, such as `OPENAI_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and
      the Vertex settings;
    - the credential's own variable.
  - **The child** repeats the check before it builds its provider. It builds that provider from the
    parent's effective connection exactly: it no longer fills in a base URL, options or a default
    credential from its own registry, and a credential reference that resolves to nothing is refused.
  - **Where the effective connection comes from:** the parent applies its own definition defaults
    (base URL, options). `profileName` is sent only when it names the connection actually sent.
  - **New contracts:**
    - `IProviderDefinition.destinationEnvironment`, declared by every built-in provider.
    - `createProviderFromExactProfile`, `connectionEnvironmentNames`,
      `findConnectionEnvironmentDivergence`, `sealConnectionEnvironment`,
      `verifyConnectionEnvironment` and `TRANSPORT_ENVIRONMENT`.
    - The start payload's `connectionCheck`.
    - The child-process runner's `providerDefinitions` option, now required: a provider with no
      definition there is refused, because its connection cannot be checked.

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

- 2d3b2c0: Make shell resolution executable-aware across managed and scheduled background command runners. The core
  resolver now accepts one request with explicit-executable precedence, returns matching argument families
  for sh/bash, PowerShell/pwsh, and cmd, and fails closed with `UnsupportedShellError` for unknown explicit
  executables. Executor exposes one shared request adapter and both concrete runners consume its pair.

### Patch Changes

- 30e5e50: Reject background runner results whose task ID or kind differs from the task being completed, and report the same mismatch as corruption when decoding a persisted session record.
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

- 9fbab1b: Provider DIP Stage B (ARCH-PROVIDER-003), part 1: collapse infrastructure. Adds the
  provider-registry-driven `@robota-sdk/dag-node-llm-text` node that supersedes the
  per-vendor LLM nodes + router, relocates the provider config resolver into
  `agent-core`, adds SSOT cost/allowedModels fields, inverts the `llm-text` validator
  tombstone, and wires `createDagFramework({ providers })`. Additive — the per-vendor
  nodes still exist; consumer migration + their removal follow in part 2.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- c6c56a6: Move the concrete `GitWorktreeIsolationAdapter` (git CLI + filesystem I/O) out of the reusable
  `@robota-sdk/agent-executor` runtime-primitives package into the `@robota-sdk/agent-cli` composition
  root, restoring the executor's "creates no Git worktrees" boundary (ARL-02 / ARCH-FIX-024, INFRA-031).

  **Breaking (`@robota-sdk/agent-subagent-runner`):** `worktreeAdapter` is now a **required** option on
  `createChildProcessSubagentRunnerFactory` / `IChildProcessSubagentRunnerOptions`. The concrete git
  default (`createGitWorktreeIsolationAdapter()`) has been removed — inject the adapter at the composition
  root. `@robota-sdk/agent-executor` no longer exports `GitWorktreeIsolationAdapter`,
  `createGitWorktreeIsolationAdapter`, or `IGitWorktreeIsolationAdapterOptions` (the
  `ISubagentWorktreeAdapter` port and `WorktreeSubagentRunner` remain). CLI runtime behavior is unchanged.

- 9814afc: Type-SSOT convergence (TYPE-003; re-audit CONTRACT-002/003/011/012 + RUNTIME-47 + STRUCT-04). Behavior is unchanged — this is a type-level refactor. `ITokenUsage` (agent-core) is confirmed as the usage-triple SSOT: `ISessionUsageTotals` and `IBackgroundTaskUsage` become aliases, and every inline `{ promptTokens; completionTokens; totalTokens }` copy (service/orchestration/executor/remote-client shapes) now references the SSOT (structurally identical → patch). The subagent-job contracts derive from the background-task SSOT — `TSubagentJobStatus = Exclude<TBackgroundTaskStatus, 'paused'>`, mode alias, and a `Pick`-projection `ISubagentJobState` — with a compile-enforced parity test so a drifting hand copy can no longer exist. `@robota-sdk/agent-session` is minor because the public `ISessionRecord` type is now the typed `IInteractiveSessionRecord` alias (previously a relaxed `unknown[]` mirror): runtime behavior of `SessionStore` is identical, but downstream code that assigned loose payloads to the record's fields may need explicit casts at its own trust boundary (the framework store facade's `as unknown as` cast bridge is deleted). agent-session's duplicate `@robota-sdk/agent-core` deps/devDeps declaration is also removed (STRUCT-04).
- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [37b4bd7]
- Updated dependencies [4eea54b]
- Updated dependencies [1698be4]
- Updated dependencies [a5961c9]
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
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-interface-transport@3.0.0-beta.80
  - @robota-sdk/agent-process@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79
- @robota-sdk/agent-interface-transport@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78
  - @robota-sdk/agent-interface-transport@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-process@3.0.0-beta.77
  - @robota-sdk/agent-interface-transport@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65

## 3.0.0-beta.64

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.64

## 3.0.0-beta.63

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.63

## 3.0.0-beta.62

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.62

## 3.0.0-beta.61

### Patch Changes

- d97bdf2: Add provider-owned model catalog metadata, route `/model` suggestions through the active provider, and make `cli:dev` resolve the CLI workspace dependency closure through source export conditions.
- Updated dependencies [1c0d44c]
- Updated dependencies [36eb7a9]
- Updated dependencies [d97bdf2]
  - @robota-sdk/agent-core@3.0.0-beta.61

## 3.0.0-beta.60

### Patch Changes

- Updated dependencies [7439391]
  - @robota-sdk/agent-core@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Refresh package docs and __PRODUCT_DISPLAY_NAME__.io content for the beta 57 feature set.
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.58

## 3.0.0-beta.57

### Minor Changes

- f61e2cb: Add Qwen provider-owned Responses API support for built-in web search/fetch tools and pass provider-owned profile options through generic CLI/runtime configuration.

### Patch Changes

- Updated dependencies [16c3b6f]
- Updated dependencies [f61e2cb]
  - @robota-sdk/agent-core@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.56

## 3.0.0-beta.55

- Initial runtime package for background task and subagent orchestration primitives.
