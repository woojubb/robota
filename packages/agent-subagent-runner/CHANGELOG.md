# @robota-sdk/agent-subagent-runner

## 3.0.0-beta.80

### Major Changes

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

- 0c07176: **BREAKING — ARCH-021: child-process subagents compose the PRODUCT's surface, not imported defaults.**

  The child-process worker built its surface from `createDefaultProviderDefinitions()` and `createDefaultTools()` — a fixed six-vendor registry and the framework's default tool tier — while the composition root had already handed the runner the fully composed surface and the runner dropped it. So a product's custom providers and pack-contributed tools reached an **in-process** subagent and not a **child-process** one, and ARCH-006's landed invariant "every tool robota runs comes from a pack" was **false in the child**: dropping a pack did not drop its tools.

  This is the second finding at that line. ARCH-010 — judged BLOCKER, a subagent `Read` returning `/etc/hostname` — patched one argument there and left the reconstruction standing.

  ```ts
  // the port: what the product composes, stated by the composition root
  export interface ISubagentWorkerComposition {
    createTools(context: { readonly cwd: string }): IToolWithEventService[];
    readonly providerDefinitions: readonly IProviderDefinition[];
  }

  export function runSubagentWorkerMain(composition: ISubagentWorkerComposition): void;
  ```

  **Why a recipe and not a broker.** A composition cannot be projected across a process boundary because it is _code_: `createProvider` is a function and a tool carries `execute`. The two sound answers are to proxy the instances or to stop expressing the contract as instances. Proxying loses on containment — a proxied tool executes in the **parent**, bound to the parent's checkout, while a worktree-isolated child's execution root is a different directory — and a prior-art sweep found **no specification that defines a per-call working root for a proxied tool invocation** (MCP roots are session-scoped and pull-based). So the recipe crosses and the child builds an equivalent surface at its own root, which is what every comparable product does.

  **Per package, classified against each barrel:**

  - **`agent-subagent-runner` (major)** — `runSubagentWorkerMain` gains a **required** parameter; `ISubagentWorkerComposition` is added to the barrel; `ISubagentWorkerReadyMessage` gains `composedToolNames?`; and the `@robota-sdk/agent-provider-defaults` **dependency edge is removed**.
  - **`agent-cli` (patch)** — composition-root wiring plus one new internal `product/` module; no barrel change.

  **The structural guarantee reaches one axis, and the document says so.** Deleting the manifest edge makes the **provider** axis a compile error, because that package solely owns `createDefaultProviderDefinitions`. The **tool** axis cannot be cut the same way: `createDefaultTools` is barrel-exported by `agent-framework`, which this package must keep for `createSubagentSession`. That axis is held by a new `harness:scan` check instead — and it is the axis with the failure history, so claiming compile-time enforcement across both would have been an overclaim exactly where it matters. The cause (no defaults-aggregator leaf for the tool surface) is tracked as ARCH-035.

  **Fail closed on what a recipe cannot reproduce.** A recipe carries anything that is a pure function of (execution root, serialized payload, ambient durable state) — not a live, unrepeatable handle. Today that is `sandboxClient`, and it is reachable with public code (`E2BSandboxClient` and `InMemorySandboxClient` are both on `agent-tools`' barrel). The composition root now **refuses** to select the child-process runner in that case, naming the capability, rather than yielding a sandboxed parent with a host-tool child. Projection is tracked as ARCH-033.

  **Verified per run, not by construction.** The child declares its composed tool names in `ready`, so the built binary can be asked what it actually composed. Measured on the real artifact: `["Shell","Bash","Read","Write","Edit","Glob","Grep","WebFetch","WebSearch","AskUserQuestion"]` — `pack-coding`'s surface, from the product's own packs.

  **Also filed rather than folded in:** ARCH-034 (in-process and child-process subagents get different tool surfaces), ARCH-036 (`deps.builtInAgents` is dropped by the child-process path), SEC-009 (`apiKey` rides in the IPC start payload; comparable products use the child's environment).

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

- 6fab98f: **BREAKING — DIST-006: the built `robota` binary could not spawn a subagent at all.**

  `/agent run` failed on every distributed build with `Subagent worker exited before result: exit code 1`. The child's real stderr was `Cannot find module '…/agent-cli/dist/node/child-process-subagent-worker.js'`. `getDefaultSubagentWorkerPath()` resolved the worker relative to its own `import.meta.url`; INFRA-028 bundles every workspace package into `agent-cli/dist/node/bin.js`, so at runtime that directory is **agent-cli's** dist, where the worker was never emitted. It worked from source, which is why nothing caught it.

  **Second occurrence of one cause.** `agent-subagent-runner/tsdown.config.ts` already carried a comment naming this exact failure: _"Without this entry the file never existed, so the child-process subagent silently failed from any dist build."_ That fix put the worker next to its OWN package's bundle; bundling then moved the resolver's notion of "next to me" one package along.

  **The defect was the function, not the missing file.** `getDefaultSubagentWorkerPath()` answered _"where is my worker file on disk?"_ from a library that cannot know — the answer is a property of the packaging step. Emitting the file where the resolver looks would have fixed **one of three shipped artifacts**: the npm bundle, but not the Bun single-file binaries published on every tag, nor the Electron desktop sidecar that embeds them. A compiled single-file executable has no sibling directory to emit into.

  ```ts
  // removed — a question no library can answer
  export function getDefaultSubagentWorkerPath(): string;

  // now: the composition root states how to start a copy of ITSELF
  export interface ISubagentWorkerEntry {
    readonly execPath: string;
    readonly args: readonly string[];
    readonly execArgv?: readonly string[];
  }
  ```

  `IChildProcessSubagentRunnerOptions.workerPath` → **`workerEntry`**, and the runner `spawn`s `execPath args… --__robota-subagent-worker` instead of forking a module path. `robota`'s own entry enters worker mode through the new `runSubagentWorkerMain()`, so **there is no second artifact and no path to get wrong**. The one seam satisfies all three shapes: a bundled Node build names the file it is executing, a `tsx` source run names the same and adds `--import tsx`, and a compiled binary names _nothing_ — `process.execPath` is the binary, and re-executing it re-enters its embedded entry.

  **Per package, classified against each barrel:**

  - **`agent-subagent-runner` (major)** — the barrel loses `getDefaultSubagentWorkerPath` (deleted, not renamed) and gains `SUBAGENT_WORKER_MODE_FLAG`, `isSubagentWorkerModeArgv`, `runSubagentWorkerMain`, `ISubagentWorkerEntry`. `IChildProcessSubagentRunnerOptions` renames `workerPath` → `workerEntry` and drops `execArgv` — it now has exactly one owner, on the entry descriptor. The separate `child-process-subagent-worker` bundle entry is gone.
  - **`agent-cli` (patch)** — composition-root wiring only; no barrel change.

  **Two things this also repairs, both found in review:**

  - **The child's stderr was discarded** (`stdio: [..., 'ignore', 'ipc']`), so a worker that died before its first IPC message reported only an exit code. That is why occurrence #2 had to be diagnosed by hand. It is now captured, bounded, and appended to the error, making the next occurrence self-reporting.
  - **A source run executed the BUILT worker, not the source worker**, because package `exports` resolve to `dist`. `resolveExecArgv`'s `--import tsx` branch was therefore dead code. Self-fork names the entry actually running, so source runs finally run source.

  **Verified against the artifacts, not from source:** the built `dist/node/bin.js` and a real `bun --compile` single-file binary each complete the worker IPC handshake (`{type:'ready'}`), each refuse a hand-typed flag with no IPC channel (exit 2, "Silence is not success" — measured on both), and the shipped bundle no longer contains the string `child-process-subagent-worker.js` — there is nothing left to look for.

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

- 7937c19: Split the `@robota-sdk/agent-provider` monolith into SDK-aligned leaf packages (ARCH-PROVIDER-002 Stage A). The single package that hard-bundled all three vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`) is **removed** and replaced by per-vendor leaves, each depending only on `@robota-sdk/agent-core` + its one SDK: `@robota-sdk/agent-provider-anthropic`, `@robota-sdk/agent-provider-openai`, `@robota-sdk/agent-provider-openai-compatible` (DeepSeek/Qwen/Gemma over the shared OpenAI-compatible base), `@robota-sdk/agent-provider-gemini` (+ a `./google` entry), and `@robota-sdk/agent-provider-bytedance` (media/video `IVideoGenerationProvider`). The aggregated `createDefaultProviderDefinitions()` now lives in the new `@robota-sdk/agent-builtin-providers` leaf.

  Migration: replace `@robota-sdk/agent-provider/<vendor>` imports with the corresponding `@robota-sdk/agent-provider-<vendor>` package (`/deepseek`, `/qwen`, `/gemma` → `@robota-sdk/agent-provider-openai-compatible`; `/google` → `@robota-sdk/agent-provider-gemini/google`), and import `createDefaultProviderDefinitions` from `@robota-sdk/agent-builtin-providers`. Consumers now pull only the vendor SDK(s) they actually use.

- c6c56a6: Move the concrete `GitWorktreeIsolationAdapter` (git CLI + filesystem I/O) out of the reusable
  `@robota-sdk/agent-executor` runtime-primitives package into the `@robota-sdk/agent-cli` composition
  root, restoring the executor's "creates no Git worktrees" boundary (ARL-02 / ARCH-FIX-024, INFRA-031).

  **Breaking (`@robota-sdk/agent-subagent-runner`):** `worktreeAdapter` is now a **required** option on
  `createChildProcessSubagentRunnerFactory` / `IChildProcessSubagentRunnerOptions`. The concrete git
  default (`createGitWorktreeIsolationAdapter()`) has been removed — inject the adapter at the composition
  root. `@robota-sdk/agent-executor` no longer exports `GitWorktreeIsolationAdapter`,
  `createGitWorktreeIsolationAdapter`, or `IGitWorktreeIsolationAdapterOptions` (the
  `ISubagentWorktreeAdapter` port and `WorktreeSubagentRunner` remain). CLI runtime behavior is unchanged.

### Patch Changes

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
    `.git`, `.robota`, `.claude`, `.agents`, `.mcp.json`, `.gitconfig`, `.npmrc` or a shell rc file.
    Files inside an isolated worktree (`.robota/worktrees/<name>/…`) are ordinary files. With no
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

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- Updated dependencies [9c19c50]
- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [08a9bd6]
- Updated dependencies [818f0c8]
- Updated dependencies [4eea54b]
- Updated dependencies [30e5e50]
- Updated dependencies [bb4696a]
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
- Updated dependencies [c6c56a6]
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
  - @robota-sdk/agent-framework@3.0.0-beta.80
  - @robota-sdk/agent-executor@3.0.0-beta.80
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-process@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79
- @robota-sdk/agent-executor@3.0.0-beta.79
- @robota-sdk/agent-framework@3.0.0-beta.79
- @robota-sdk/agent-interface-transport@3.0.0-beta.79
- @robota-sdk/agent-provider@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78
  - @robota-sdk/agent-provider@3.0.0-beta.78
  - @robota-sdk/agent-executor@3.0.0-beta.78
  - @robota-sdk/agent-framework@3.0.0-beta.78
  - @robota-sdk/agent-interface-transport@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-process@3.0.0-beta.77
  - @robota-sdk/agent-executor@3.0.0-beta.77
  - @robota-sdk/agent-framework@3.0.0-beta.77
  - @robota-sdk/agent-interface-transport@3.0.0-beta.77
  - @robota-sdk/agent-provider@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- Updated dependencies
- Updated dependencies [c0a6287]
- Updated dependencies [9df3a88]
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-framework@3.0.0-beta.76
  - @robota-sdk/agent-provider@3.0.0-beta.76
  - @robota-sdk/agent-executor@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.75
  - @robota-sdk/agent-core@3.0.0-beta.75
  - @robota-sdk/agent-executor@3.0.0-beta.75
  - @robota-sdk/agent-provider@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.74
  - @robota-sdk/agent-core@3.0.0-beta.74
  - @robota-sdk/agent-executor@3.0.0-beta.74
  - @robota-sdk/agent-provider@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73
- @robota-sdk/agent-executor@3.0.0-beta.73
- @robota-sdk/agent-framework@3.0.0-beta.73
- @robota-sdk/agent-provider@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.72
  - @robota-sdk/agent-core@3.0.0-beta.72
  - @robota-sdk/agent-executor@3.0.0-beta.72
  - @robota-sdk/agent-provider@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71
  - @robota-sdk/agent-executor@3.0.0-beta.71
  - @robota-sdk/agent-framework@3.0.0-beta.71
  - @robota-sdk/agent-provider@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.70
  - @robota-sdk/agent-core@3.0.0-beta.70
  - @robota-sdk/agent-executor@3.0.0-beta.70
  - @robota-sdk/agent-provider@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.69
  - @robota-sdk/agent-core@3.0.0-beta.69
  - @robota-sdk/agent-executor@3.0.0-beta.69
  - @robota-sdk/agent-provider@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68
- @robota-sdk/agent-executor@3.0.0-beta.68
- @robota-sdk/agent-framework@3.0.0-beta.68
- @robota-sdk/agent-provider@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- CLIR: agent-cli layer separation, agent-framework interactive session improvements, subagent runner fix, TUI interface README
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.67
  - @robota-sdk/agent-core@3.0.0-beta.67
  - @robota-sdk/agent-executor@3.0.0-beta.67
  - @robota-sdk/agent-provider@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.66
  - @robota-sdk/agent-core@3.0.0-beta.66
  - @robota-sdk/agent-executor@3.0.0-beta.66
  - @robota-sdk/agent-provider@3.0.0-beta.66
