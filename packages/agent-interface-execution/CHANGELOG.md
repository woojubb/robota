# @robota-sdk/agent-interface-execution

## 3.2.2
### Patch Changes

- 8d05c9b: Allow compatible SDK dependencies to update independently.

## 3.2.1
### Patch Changes

  - @robota-sdk/agent-core@3.2.1

## 3.2.0
### Minor Changes

- 12ab3f5: Follow a running fork without stopping its parent, steer its job, and continue its record after it ends.

### Patch Changes

- Updated dependencies [ffaf7d5]
  - @robota-sdk/agent-core@3.2.0

## 3.1.2
### Patch Changes

  - @robota-sdk/agent-core@3.1.2

## 3.1.1
### Patch Changes

  - @robota-sdk/agent-core@3.1.1

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
- b56b5a9: Ship one build per package. The platform-neutral entries moved from `dist/node` to `dist`, and the second
  `dist/browser` build of `@robota-sdk/agent-core`, `@robota-sdk/agent-transport`,
  `@robota-sdk/agent-ui-web` and `@robota-sdk/agent-transport-webrtc-web` is gone: a neutral entry runs
  unchanged in every runtime, so a subpath's `exports` map `import` and `require` to the same files and no
  longer a `node` or `browser` condition (a Node-only subpath keeps `"browser": null`). Import specifiers
  and the code behind them are unchanged; only a deep import of `dist/node/*` or `dist/browser/*` breaks.
  `@robota-sdk/agent-transport/client` also ships a CommonJS build now.

### Patch Changes

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
- Updated dependencies [bc8de21]
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
- Updated dependencies [44e9640]
- Updated dependencies [b56b5a9]
- Updated dependencies [1c19435]
  - @robota-sdk/agent-core@3.1.0

## 3.0.7
### Patch Changes

  - @robota-sdk/agent-core@3.0.7

## 3.0.6
### Patch Changes

  - @robota-sdk/agent-core@3.0.6

## 3.0.5
### Patch Changes

  - @robota-sdk/agent-core@3.0.5

## 3.0.4
### Patch Changes

  - @robota-sdk/agent-core@3.0.4

## 3.0.3
### Patch Changes

  - @robota-sdk/agent-core@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/agent-core@3.0.2

## 3.0.1
### Patch Changes

  - @robota-sdk/agent-core@3.0.1

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
- 2c612ba: Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- dfb9b15: Release the integrated provider credential isolation and consumer runtime and interaction composition updates.
- 9c6a8db: A background agent's tool call that needs approval now reaches a person instead of being refused
  automatically. The child process asks the parent session's own approver, identified as a background
  agent naming its task, and parks the call until an answer arrives; cancelling the task dismisses any
  still-parked ask immediately rather than leaving it outstanding. A parent with no approver attached
  (print mode, a truly headless run) still fails every such call closed, the same default as before.

  An agent task's result and its background-task-workspace entry now report how many of its tool calls
  were refused and why (denied by a person, no approver attached, the approver itself failed, or the
  task ended before an attached approver answered) — present only when at least one call was refused, so
  a task that finished as it always did carries no new field.

  A workspace entry for a `/loop`-managed iteration now carries a stable `loopId`, so a surface can stop
  the loop itself rather than only cancelling its disposable wake timer, and a snapshot can include a
  self-paced loop summary for an iteration that has no background-task entry of its own yet.
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
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
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
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [df02568]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9c6a8db]
- Updated dependencies [dfb9b15]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [d6b9404]
- Updated dependencies [62663ae]
- Updated dependencies [23a30cd]
- Updated dependencies [7d9cc66]
- Updated dependencies [9814afc]
- Updated dependencies [7d9cc66]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-core@3.0.0

## 3.0.0-beta.106
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.106

## 3.0.0-beta.105
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.105

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

- Updated dependencies [6f41c53]
  - @robota-sdk/agent-core@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

- Updated dependencies [62663ae]
  - @robota-sdk/agent-core@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.99

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.98

## 3.0.0-beta.97
### Patch Changes

- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [23a30cd]
  - @robota-sdk/agent-core@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.96

## 3.0.0-beta.95
### Patch Changes

- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-core@3.0.0-beta.95

## 3.0.0-beta.94
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.94

## 3.0.0-beta.93
### Patch Changes

- Release the integrated provider credential isolation and consumer runtime and interaction composition updates.
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.93

## 3.0.0-beta.92
### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.92

## 3.0.0-beta.91
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.91

## 3.0.0-beta.90
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.90

## 3.0.0-beta.89
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.88

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

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [41cca13]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
  - @robota-sdk/agent-core@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- 9c6a8db: A background agent's tool call that needs approval now reaches a person instead of being refused
  automatically. The child process asks the parent session's own approver, identified as a background
  agent naming its task, and parks the call until an answer arrives; cancelling the task dismisses any
  still-parked ask immediately rather than leaving it outstanding. A parent with no approver attached
  (print mode, a truly headless run) still fails every such call closed, the same default as before.

  An agent task's result and its background-task-workspace entry now report how many of its tool calls
  were refused and why (denied by a person, no approver attached, the approver itself failed, or the
  task ended before an attached approver answered) — present only when at least one call was refused, so
  a task that finished as it always did carries no new field.

  A workspace entry for a `/loop`-managed iteration now carries a stable `loopId`, so a surface can stop
  the loop itself rather than only cancelling its disposable wake timer, and a snapshot can include a
  self-paced loop summary for an iteration that has no background-task entry of its own yet.

- Updated dependencies [9f46375]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-core@3.0.0-beta.84

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

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81

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
