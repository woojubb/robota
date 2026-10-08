# @robota-sdk/agent-interface-execution

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
