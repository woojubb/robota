# @robota-sdk/agent-command — Package Specification

## Scope

Consolidated command module for the Robota SDK CLI. Provides all slash-command implementations as a single importable package, replacing 20 individual `agent-command-*` packages. Also provides the `default/` assembly helper (`createDefaultCommandModules`) and the `plugins/` adapter layer (`createDefaultPluginCommandAdapter`, `reloadPluginCommandSource`) for binding provider setup and plugin management to the command system.

## Boundaries

**Out of scope:**

- Transport layer (WebSocket, TUI, headless) — owned by `agent-transport` (subpaths `/ws`, `/tui`, `/headless`)
- CLI entry point and argument parsing — owned by `agent-cli`
- Agent runtime and session management — owned by `agent-core` / `agent-framework`
- Command registration contracts (`ICommandModule`, `ICommandSource`, `ISystemCommand`) — defined in `agent-framework`
- Plugin infrastructure (`BundlePluginInstaller`, `BundlePluginLoader`, `MarketplaceClient`) — defined in `agent-framework`

## Architecture Overview

Each command domain lives in its own subdirectory (`src/<command>/`) with a consistent three-file pattern:

- `<command>-command-module.ts` — creates the `ICommandModule`, `ICommandSource`, and `ISystemCommand` objects; exports named factory functions and the `<Name>CommandSource` class.
- `<command>-command.ts` — contains the `execute<Name>Command` implementation logic; depends on `ICommandHostContext` from `agent-framework`.
- `index.ts` — re-exports public symbols for the command domain.

Two cross-cutting subdirectories:

- `src/default/` — `createDefaultCommandModules` assembles all 32 standard command modules and returns `IDefaultCommandModulesResult` (`{ modules, unknownModuleNames }`, INFRA-032). Consumers pass `cwd`, explicit `contributionSources`, `providerDefinitions`, `providerSettingsAdapter`, and optionally `enabledCommandModules` / `disabledCommandModules` (allow-then-deny module name filters). Skills discovery consumes only those sources; it never reconstructs project reads from `cwd`. The allow-then-deny filtering is delegated to agent-framework's `selectCommandModules` (the single filter implementation — the local `applyModuleSelection` is a thin delegator, INFRA-032), and `unknownModuleNames` is computed via the framework's `findUnknownModuleNames(builtModuleNames, enabled, disabled)`: any `enabled`/`disabled` name that matched no built module (a short form like `editor` instead of `agent-command-editor`, or a typo) is returned as data — not silently dropped — so the CLI startup path can surface a non-fatal notice. `orgPolicy` is not an option here — it is wired at the provider-command-module level via `createProviderCommandModule`.
- `src/doctor/` — owns the pre-session doctor (OBSERVABILITY-1991): the `IDoctorCheck` evidence model,
  the probes over `agent-framework`'s read-only inspection APIs, the single redaction boundary, the
  closed repair allowlist, `runDoctor(inputs, deps)`, the plain-text renderer, and the `/doctor` command
  module. The host (`agent-cli`) composes `IDoctorInputs` — the workspace composition it would have
  built, the plugin scope layout from `pluginScopeDirs`, and host-only checks — and either renders the
  report on its shell route or registers `/doctor` by passing `doctorInputs` to
  `createDefaultCommandModules`. See § Doctor below for the contract.
- `src/keybindings/` — owns `/keybindings` and only its consumer-side
  `IKeybindingsFilePort`. When that optional port is injected, the command asks it to atomically
  ensure the user document and opens the exact returned path through the existing terminal-handoff
  contract. It does not know the schema, defaults, contexts, watcher, or TUI implementation. Without
  the capability the default assembly does not register the command.
- `src/plugins/` — provides `createDefaultPluginCommandAdapter` (wires `BundlePluginInstaller`, `BundlePluginLoader`, `MarketplaceClient` into an `ICommandPluginAdapter`) and `reloadPluginCommandSource` (synchronously reloads plugin commands into a `CommandRegistry`).

The `agent` and `schedule` command modules set `sessionRequirements: ['agent-runtime']`, a demand switch (CMD-008): composing either module makes the session layer enable the agent runtime; it is not a gate on the runtime being available beforehand. The `output-style` module is operator-only and uses the injected provider-neutral style registry; it never reads style files itself.

## Dependencies

```
@robota-sdk/agent-core                workspace:*   (IProviderDefinition, ITerminalOutput, IProviderSetupStepDefinition, etc.)
@robota-sdk/agent-framework           workspace:*   (ICommandModule, ICommandSource, ISystemCommand, IOrgPolicy, ICommandPluginAdapter, BundlePluginInstaller, etc.)
@robota-sdk/agent-interface-transport workspace:*   (transport-side command/list contracts)
@robota-sdk/agent-preset              workspace:*   (listPresets, getPreset, resolvePreset — used by the `/preset` command)
```

No circular dependencies. This package does not depend on any other `agent-command-*` package.

## Type Ownership

Types defined (SSOT) in this package:

| Type                             | Location                                        | Purpose                                                                                                                                               |
| -------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IDefaultCommandModulesOptions`  | `src/default/default-command-modules.ts`        | Options for `createDefaultCommandModules`                                                                                                             |
| `ISkillsCommandModuleOptions`    | `src/skills/skills-command-module.ts`           | Options for `createSkillsCommandModule` (explicit contribution sources)                                                                               |
| `IProviderSetupFlowState`        | `src/provider/provider-setup-flow.ts`           | Immutable state machine for the provider setup wizard                                                                                                 |
| `IProviderSetupFlowOptions`      | `src/provider/provider-setup-flow.ts`           | Initial options for `createProviderSetupFlow`                                                                                                         |
| `IProviderSetupPromptStep`       | `src/provider/provider-setup-flow.ts`           | One step in the provider setup wizard                                                                                                                 |
| `TProviderSetupFlowSubmitResult` | `src/provider/provider-setup-flow.ts`           | Union result of `submitProviderSetupValue`                                                                                                            |
| `TProviderSetupType`             | `src/provider/provider-setup-flow.ts`           | String alias for provider type identifier                                                                                                             |
| `TPromptInput`                   | `src/provider/provider-setup-flow.ts`           | Callback signature for interactive text prompts                                                                                                       |
| `IDoctorCheck`                   | `src/doctor/doctor-types.ts`                    | One doctor finding: stable `id`, `status`, exact `path`, structured `cause`, optional `repair` id                                                     |
| `IDoctorReport`                  | `src/doctor/doctor-types.ts`                    | Every check plus `failCount`, `warnCount`, repairable ids and the `exitCode` (`fail` alone raises it)                                                 |
| `IDoctorInputs`                  | `src/doctor/doctor-types.ts`                    | What the host composes for the runner: sources, access, definitions, env, plugin dirs, the product's user settings path / storage layout, host checks |
| `IDoctorDeps`                    | `src/doctor/doctor-types.ts`                    | Injected side effects: endpoint probe, path facts, PATH resolution, owner-only guarantee                                                              |
| `TDoctorCheckStatus`             | `src/doctor/doctor-types.ts`                    | `ok \| warn \| fail \| not-configured \| not-probed`; `not-probed` is the closed list `TDoctorNotProbed`                                              |
| `IDoctorRepairPlan`              | `src/doctor/doctor-repair.ts`                   | An allowlisted repair the current state admits: id, description, target path                                                                          |
| `IKeybindingsFilePort`           | `src/keybindings/keybindings-command-module.ts` | Minimal consumer-owned capability that ensures and returns the user keybindings path                                                                  |
| `IProviderStartupContext`        | `src/provider/provider-startup.ts`              | Context passed to `runProviderStartupSetup`                                                                                                           |
| `IEnsureProviderConfigOptions`   | `src/provider/provider-startup.ts`              | Options for `ensureProviderConfig`                                                                                                                    |
| `IUserLocalDirectCommandOptions` | `src/user-local/user-local-command.ts`          | Options for `executeUserLocalDirectCommand`                                                                                                           |

Types re-exported from `agent-framework` (not owned here):

| Re-exported Type                  | Source package                |
| --------------------------------- | ----------------------------- |
| `IProviderCommandModuleOptions`   | `@robota-sdk/agent-framework` |
| `IProviderCommandSettingsAdapter` | `@robota-sdk/agent-framework` |

## Public API Surface

Single root entry point: `import { ... } from '@robota-sdk/agent-command'`

### Assembly helpers

| Export                              | Kind     | Description                                                                                                                                                                         |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createDefaultCommandModules`       | function | Assembles all 32 standard command modules; returns `{ modules, unknownModuleNames }`                                                                                                |
| `IDefaultCommandModulesOptions`     | type     | Options interface for `createDefaultCommandModules`                                                                                                                                 |
| `IDefaultCommandModulesResult`      | type     | Return shape of `createDefaultCommandModules` (`modules` + INFRA-032 `unknownModuleNames`)                                                                                          |
| `createHandoffCommandModule`        | function | HANDOFF-001 (issue #1864) — the `/handoff` module: move this session to another machine                                                                                             |
| `createHandoffCommandEntry`         | function | The `/handoff` command entry; `modelInvocable: false` — giving a session away is the operator's decision                                                                            |
| `HandoffCommandSource`              | class    | Command source exposing `/handoff`                                                                                                                                                  |
| `executeHandoffCommand`             | function | Runs `/handoff`: names what stays behind, asks, and always states where the session is now                                                                                          |
| `createOutputStyleCommandModule`    | function | CLI-1988 `/output-style` module for listing and selecting provider-neutral response styles                                                                                          |
| `createOutputStyleCommandEntry`     | function | Operator-only `/output-style` command entry                                                                                                                                         |
| `OutputStyleCommandSource`          | class    | Command source exposing `/output-style`                                                                                                                                             |
| `executeOutputStyleCommand`         | function | Lists styles or emits a validated `output-style-change` host action                                                                                                                 |
| `createEffortCommandModule`         | function | Creates the `/effort` command module for showing or changing the active model effort                                                                                                |
| `createEffortCommandEntry`          | function | The `/effort` command entry with `auto` and the core-owned effort levels                                                                                                            |
| `EffortCommandSource`               | class    | Command source exposing `/effort`                                                                                                                                                   |
| `executeEffortCommand`              | function | Applies or reports effort through the injected live-session and settings adapters; `auto` remains the session selection instead of being replaced by a resolved concrete level      |
| `createMCPActivationCommandModule`  | function | MCP-2520 `/mcp` module for status and explicit trust decisions through the injected host adapter                                                                                    |
| `createMCPActivationCommandEntry`   | function | The operator-only `/mcp` command entry                                                                                                                                              |
| `MCPActivationCommandSource`        | class    | Command source exposing `/mcp`                                                                                                                                                      |
| `executeMCPActivationCommand`       | function | Lists secret-free MCP status or requests approve/reject/revoke via the host adapter; never connects a server                                                                        |
| `runDoctor`                         | function | Runs every doctor probe over `IDoctorInputs` and returns the redacted `IDoctorReport` (OBSERVABILITY-1991)                                                                          |
| `renderDoctorReport`                | function | Renders a report as the plain-text lines both `robota doctor` and `/doctor` print                                                                                                   |
| `applyDoctorRepair`                 | function | Plan → confirm → re-plan → write for one allowlisted repair id; refuses everything else with no write                                                                               |
| `planDoctorRepair`                  | function | Re-reads the state and says whether a repair id is admissible now; never writes                                                                                                     |
| `createNodeDoctorDeps`              | function | Node defaults for `IDoctorDeps` (TCP connect probe, path facts, PATH resolution)                                                                                                    |
| `redactDiagnosticText`              | function | The rendering boundary: masks known secret values, URL userinfo, bearer tokens and vendor-key shapes                                                                                |
| `collectSettingsSecrets`            | function | Gathers literal credentials and env-referenced values from parsed settings layers to feed the redactor                                                                              |
| `createDoctorCommandModule`         | function | Creates the `/doctor` command module over host-composed `IDoctorInputs`                                                                                                             |
| `createDoctorCommandEntry`          | function | The operator-only `/doctor` command entry                                                                                                                                           |
| `DoctorCommandSource`               | class    | Command source exposing `/doctor`                                                                                                                                                   |
| `doctorRepairAllowlist`             | function | The closed allowlist for one composition: the host's user settings layer id (`settings.user.<family>`) and `storage.user`                                                           |
| `STORAGE_REPAIR_ID`                 | const    | `'storage.user'` — the storage repair id                                                                                                                                            |
| `isDoctorRepairId`                  | function | Whether an id is in the composition's allowlist                                                                                                                                     |
| `buildDoctorReport`                 | function | Aggregates checks into `IDoctorReport` (`fail` alone raises the exit code)                                                                                                          |
| `resolveCommandOnPath`              | function | `PATH` resolution used by the hook and MCP probes (bare name via `PATH`; path form must exist)                                                                                      |
| `IDoctorCheck`                      | type     | One doctor finding                                                                                                                                                                  |
| `IDoctorReport`                     | type     | The aggregated report                                                                                                                                                               |
| `IDoctorInputs`                     | type     | Host-composed inputs (sources, access, definitions, env, plugin dirs, product layout, host checks)                                                                                  |
| `IDoctorDeps`                       | type     | Injected side effects                                                                                                                                                               |
| `IDoctorEndpointProbeResult`        | type     | Result of one TCP reachability probe                                                                                                                                                |
| `IDoctorPathFacts`                  | type     | Read-only facts about one path                                                                                                                                                      |
| `IDoctorRepairPlan`                 | type     | An admissible repair: id, description, target path                                                                                                                                  |
| `TDoctorCheckStatus`                | type     | `ok \| warn \| fail \| not-configured \| not-probed`                                                                                                                                |
| `TDoctorNotProbed`                  | type     | The closed `not-probed` list                                                                                                                                                        |
| `TDoctorRepairOutcome`              | type     | `applied` with its plan, or refused with the reason                                                                                                                                 |
| `TDoctorRepairPlanResult`           | type     | `ok` with a plan, or refused with the reason                                                                                                                                        |
| `pluginScopeDirs`                   | function | The plugin scope directories (project first, then user) the plugin loader reads; consumed by the doctor so the layout has one owner                                                 |
| `createGitCommandModule`            | function | BEHAVIOR-2437 — the `/git` module (`status` \| `diff` \| `commit`); `{ port }` injects the process seam, `createGitProcess()` by default                                            |
| `createGitCommandEntry`             | function | The operator-only `/git` command entry with the three verbs as descriptive `subcommands`                                                                                            |
| `GitCommandSource`                  | class    | Command source exposing `/git`                                                                                                                                                      |
| `executeGitCommand`                 | function | Parses the verb and runs `status`, `diff` or `commit` over `getCwd()` and the ask port; `commit` confirms before writing                                                            |
| `createGitProcess`                  | function | The production `IGitProcessPort`: argv-only `execFile` (`shell: false`), stdin closed, 16 MiB output cap, timeout, typed outcomes                                                   |
| `gitEnvironment`                    | function | The child environment: the source minus the repository-redirecting `GIT_*` variables git exports into hooks                                                                         |
| `IGitProcessPort`                   | type     | `run(args, { cwd, timeoutMs?, signal? })` → `TGitProcessOutcome`; injected for tests                                                                                                |
| `IGitProcessRunOptions`             | type     | Per-run options: `cwd`, optional `timeoutMs` (120 s default) and `signal`                                                                                                           |
| `ICreateGitProcessOptions`          | type     | `executable` (default `git`) and `env` (default the process environment) for `createGitProcess`                                                                                     |
| `TGitProcessOutcome`                | type     | `exited` with `stdout`/`stderr`/`exitCode` as data, or `failed` with a `TGitProcessFailureReason`                                                                                   |
| `TGitProcessFailureReason`          | type     | `not-found \| timeout \| aborted \| output-too-large`                                                                                                                               |
| `IGitCommandModuleOptions`          | type     | `{ port?: IGitProcessPort }` for `createGitCommandModule`                                                                                                                           |
| `TGitCommandContext`                | type     | What `executeGitCommand` needs from the host: `getCwd()` and `getUserInteraction()`                                                                                                 |
| `createKeybindingsCommandModule`    | function | Creates the `/keybindings` command module for opening or initializing the user keybindings document                                                                                 |
| `createKeybindingsCommandEntry`     | function | The operator-only `/keybindings` command entry                                                                                                                                      |
| `KeybindingsCommandSource`          | class    | Command source exposing `/keybindings`                                                                                                                                              |
| `IKeybindingsFilePort`              | type     | Consumer-injected capability interface for resolving and initializing the user keybindings file path                                                                                |
| `createDefaultPluginCommandAdapter` | function | Creates a production `ICommandPluginAdapter` wired to filesystem plugin infrastructure                                                                                              |
| `reloadPluginCommandSource`         | function | Synchronously reloads plugin commands into a `CommandRegistry` from `~/.robota/plugins` and, when `cwd` is given, `<cwd>/.robota/plugins` (project scope wins by name; issue #2487) |

### Command module factories and sources

| Module         | Factory                            | Source class                 | Execute function                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agent          | `createAgentCommandModule`         | `AgentCommandSource`         | `executeAgentCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| background     | `createBackgroundCommandModule`    | `BackgroundCommandSource`    | `executeBackgroundCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| compact        | `createCompactCommandModule`       | `CompactCommandSource`       | `executeCompactCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| context        | `createContextCommandModule`       | `ContextCommandSource`       | `executeContextCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| editor         | `createEditorCommandModule`        | `EditorCommandSource`        | `executeEditorCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| effort         | `createEffortCommandModule`        | `EffortCommandSource`        | `executeEffortCommand` (FLOW-008: `/effort [auto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | low             | medium                                                                                                                                                                                                 | high                                                                                                                                 | xhigh | max]` reports or changes the live effort; the picker is optional, settings persistence is adapter-owned, and the result includes requested/effective/source/disposition metadata) |
| exit           | `createExitCommandModule`          | `ExitCommandSource`          | `executeExitCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| fork           | `createForkCommandModule`          | `ForkCommandSource`          | `executeForkCommand` (CLI-1994, issue #1994: `/fork [name] [--same-dir]` copies THIS conversation into a background session and keeps the current one interactive. It calls the host's `forkSession` to write a COPY as a new session record — fresh id, distinct name, the parent's messages and assembled system message — then spawns a background agent job carrying only that `resumeSessionId`, so the conversation never crosses the child-process wire (ARCH-044). **A fork is a copy**: work in it never reaches this session and never merges back; attaching to it later is a **view switch, not a merge**. The job declares `isolation: 'worktree'` by default so filesystem work cannot collide with the parent's cwd, and `--same-dir` is the explicit opt-out. `userInvocable`, `modelInvocable: false` — duplicating the operator's conversation spends a second session's budget and is the operator's call — with `sessionRequirements: ['agent-runtime']`. A `forkSession` rejection is reported and NO job is spawned; a spawn failure still names the written record so it can be resumed by hand) |
| git            | `createGitCommandModule`           | `GitCommandSource`           | `executeGitCommand` (BEHAVIOR-2437: `/git status` \| `diff [--staged \| <rev> \| <a>..<b>] [-- <path> ...]` \| `commit [<subject>]`; see § `/git`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| goal           | `createGoalCommandModule`          | `GoalCommandSource`          | `executeGoalCommand` (GOAL-001: `/goal <objective>` \| `status` \| `cancel`; delegates to the framework goal controller via `ICommandHostContext.setGoal`/`getGoalState`/`cancelGoal`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| plan           | `createPlanCommandModule`          | PlanCommandSource            | executePlanCommand (SELFHOST-002: `/plan <objective>` \| `status` \| `approve` \| `revert`; delegates to the framework PlanController via ICommandHostContext.setPlan/getPlanState/approvePlan/revertPlan)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| help           | `createHelpCommandModule`          | `HelpCommandSource`          | `executeHelpCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| doctor         | `createDoctorCommandModule`        | `DoctorCommandSource`        | `executeDoctorCommand` (OBSERVABILITY-1991: `/doctor` renders the shared runner's report; `/doctor repair <check-id>` confirms through the CMD-004 ask seam and applies one allowlisted writer; never creates a provider turn)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| keybindings    | `createKeybindingsCommandModule`   | `KeybindingsCommandSource`   | `executeKeybindingsCommand` (BEHAVIOR-2003: `/keybindings` opens or initializes the user keybindings document via the host-injected file port)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| language       | `createLanguageCommandModule`      | `LanguageCommandSource`      | `executeLanguageCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| memory         | `createMemoryCommandModule`        | `MemoryCommandSource`        | `executeMemoryCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| output-style   | `createOutputStyleCommandModule`   | `OutputStyleCommandSource`   | `executeOutputStyleCommand` (CLI-1988: `/output-style list` or a style id lists/selects the host-resolved provider-neutral output-style catalog; no-argument invocation uses the existing structured picker; operator-only and emits a typed `output-style-change` host action)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| mcp            | `createMCPActivationCommandModule` | `MCPActivationCommandSource` | `executeMCPActivationCommand` — `/mcp status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | approve         | reject                                                                                                                                                                                                 | revoke`; reads and requests typed decisions through the injected `mcpActivation` adapter, never constructs or connects an MCP client |
| mode           | `createModeCommandModule`          | `ModeCommandSource`          | `executeModeCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| permissions    | `createPermissionsCommandModule`   | `PermissionsCommandSource`   | `executePermissionsCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| plugin         | `createPluginCommandModule`        | `PluginManagerCommandSource` | `executePluginCommand`, `executeReloadPluginsCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| peers          | `createPeersCommandModule`         | `PeersCommandSource`         | `executePeersCommand` (PEER-004: `/peers` lists the other live sessions on this host, read through the injected `localPeers` adapter; `dead` entries are debris and are not shown, `unknown` liveness is printed rather than rounded to alive. PEER-006: `/peers send <session-id> <message>` addresses one of them through the adapter's optional `send`; `pending` is reported as waiting rather than delivered, because a message queued behind a running turn is a wait the operator can act on)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| handoff        | `createHandoffCommandModule`       | `HandoffCommandSource`       | `executeHandoffCommand` (HANDOFF-001, issue #1864: `/handoff [device-id]` moves this session to another machine, read through the injected `handoff` adapter. Holds no protocol — the carrier, the wire composition and the device identity belong to the composition root. The consent names what will NOT travel (uncommitted changes, running subprocesses, and the provider credential, which is never transferred) BEFORE it asks, and a dismissed or absent prompt is a decline, never a yes. Every outcome states where the session is now, because that is the one thing the operator has to know)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| preset         | `createPresetCommandModule`        | `PresetCommandSource`        | `executePresetCommand` (the `/preset` list + live-switch command; calls `agent-preset` `listPresets`/`getPreset`/`resolvePreset` then framework `applyPresetToSession`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| provider       | `createProviderCommandModule`      | `ProviderCommandSource`      | `executeProviderCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| remote-control | `createRemoteControlCommandModule` | `RemoteControlCommandSource` | `executeRemoteControlCommand` (REMOTE-008: `/remote-control` enable/stop/status — a declarative trigger returning `remote-control-enable`/`-stop` host actions; status via the injected `remoteControl` adapter)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| reset          | `createResetCommandModule`         | `ResetCommandSource`         | `executeResetCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| rewind         | `createRewindCommandModule`        | `RewindCommandSource`        | `executeRewindCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| schedule       | `createScheduleCommandModule`      | `ScheduleCommandSource`      | `executeScheduleCommand`, `executeMonitorCommand` (recurring/one-shot wake + process-monitor wake; `sessionRequirements: ['agent-runtime']`). SELFHOST-012: `/schedule` also dispatches `list \| pause <id> \| resume <id> \| edit <id> <spec>` over the existing scheduler (mirror `/background`); a create spec begins with `in`/`cron`, so the keywords never collide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| session        | `createSessionCommandModule`       | `SessionCommandSource`       | `executeClearCommand`, `executeCostCommand`, `executeRenameCommand`, `executeResumeCommand`, `executeValidateSessionCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| settings       | `createSettingsCommandModule`      | `SettingsCommandSource`      | (inline, no standalone export)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| shell          | `createShellCommandModule`         | `ShellCommandSource`         | `executeShellCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| skills         | `createSkillsCommandModule`        | `SkillsCommandSource`        | `executeSkillsCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| statusline     | `createStatusLineCommandModule`    | `StatusLineCommandSource`    | `executeStatusLineCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| theme          | `createThemeCommandModule`         | `ThemeCommandSource`         | `executeThemeCommand` (SCREEN-2002: `/theme` opens the picker, `list` reports the catalogue and the live appearance, `<id> [syntax on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | off] [motion on | off]`switches. Behind an injected`IThemeCataloguePort`— no port, no command. Emits at most ONE`appearance-settings-patch`, and an unknown id writes nothing, not even the toggles submitted beside it) |
| user-local     | `createUserLocalCommandModule`     | `UserLocalCommandSource`     | `executeUserLocalCommand`, `executeUserLocalDirectCommand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Fixed in-session repeat (`/loop`, #2726 / historical #2005)

The schedule module also registers a provider-neutral `/loop` command over the existing
`spawnScheduledWake` and session turn queue. This first slice accepts either
`/loop <N><s|m|h|d> <prompt>` or `/loop <prompt> every <N> <unit>` (unit names may be written out).
The prompt is submitted as an ordinary `agent-wakeup` turn under the session's existing permission
policy. `/loop list` shows active loop schedules; `/loop stop <task-id>` cancels only the selected
loop's timer and queued wake through the session's targeted cancellation path. A turn already running
may finish. Non-loop schedules cannot be stopped through `/loop`.

Supported requested intervals are positive and at most one day. Calendar-aligned cron steps divide
60 seconds, 60 minutes, or 24 hours; a request between steps rounds **up** to the next supported
cadence, which is reported in the creation receipt together with the next fire time when available.
The first clock-aligned fire may occur sooner than one full requested interval after creation.
Distinct loop wake sources do not replace one another in the bounded session queue; repeated
in-flight wakes from the same scheduled task coalesce, so missed fires do not form a catch-up burst.
The task ID is the live session's stop handle. Existing schedule restoration can create a new task
ID on resume; `/loop list` reveals that new ID. A durable loop ID, persistence guarantees, a
seven-day expiry, jitter, Esc handling, self-paced/default-prompt modes, and prompt overrides are
**not yet delivered**. This slice does not complete the historical #2005 checklist or #2726.

### Provider setup flow (interactive UI helpers)

| Export                               | Kind     | Description                                                   |
| ------------------------------------ | -------- | ------------------------------------------------------------- |
| `createProviderSetupFlow`            | function | Creates initial `IProviderSetupFlowState`                     |
| `submitProviderSetupValue`           | function | Advances flow state; returns `TProviderSetupFlowSubmitResult` |
| `getProviderSetupStep`               | function | Returns the current step definition                           |
| `resolveProviderSetupSelection`      | function | Maps user selection string to provider type                   |
| `runProviderSetupPromptFlow`         | function | Runs the full interactive setup wizard                        |
| `formatProviderSetupSelectionPrompt` | function | Formats the provider selection prompt text                    |
| `formatProviderSetupChoiceLabel`     | function | Formats a single provider choice label                        |
| `formatProviderSetupHelpLinks`       | function | Formats help links for a provider                             |
| `formatProviderSetupPromptLabel`     | function | Formats the input prompt label for a setup step               |
| `validateProviderSetupValue`         | function | Validates a single setup step value                           |
| `ensureProviderConfig`               | function | Verifies provider config or prompts for setup                 |
| `runProviderStartupSetup`            | function | Runs full onboarding + provider setup at CLI start            |

### Command entry builders (for programmatic registration)

| Export                                   | Kind     | Description                                                                                                                                      |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createAgentCommandEntry`                | function | Returns `ICommand` metadata for the `agent` command                                                                                              |
| `createAgentSystemCommand`               | function | Returns `ISystemCommand` for the `agent` command                                                                                                 |
| `createProviderCommandEntry`             | function | Returns `ICommand` metadata for `provider`                                                                                                       |
| `createPluginCommandEntry`               | function | Returns `ICommand` metadata for `plugin`                                                                                                         |
| `createReloadPluginsCommandEntry`        | function | Returns `ICommand` metadata for `reload-plugins`                                                                                                 |
| `createSessionCommandModule` sub-entries | function | `createClearCommandEntry`, `createCostCommandEntry`, `createRenameCommandEntry`, `createResumeCommandEntry`, `createValidateSessionCommandEntry` |
| `createThemeCommandEntry`                | function | Returns `ICommand` metadata for `theme`                                                                                                          |
| `createThemeCommandModule`               | function | Returns the `/theme` `ICommandModule`, bound to an injected `IThemeCataloguePort`                                                                |
| `executeThemeCommand`                    | function | Parses `/theme` arguments; emits at most one appearance patch or the picker intent                                                               |
| `ThemeCommandSource`                     | class    | Command source contributing `/theme`                                                                                                             |
| `IThemeCataloguePort`                    | type     | Re-export of the contract a composition root injects — the surface's theme catalogue                                                             |
| `IThemeCatalogueEntry`                   | type     | Re-export: one catalogue row — identity and source, never a colour                                                                               |
| `IThemeAppearanceState`                  | type     | Re-export: the persisted appearance plus the tier that pinned reduced motion, if any                                                             |
| `TReducedMotionOverride`                 | type     | Re-export: which tier decided reduced motion for this run                                                                                        |

### Session command constants

| Export                             | Kind     | Description                                    |
| ---------------------------------- | -------- | ---------------------------------------------- |
| `CLEAR_COMMAND_MESSAGE`            | constant | Default message inserted on session clear      |
| `SKILLS_COMMAND_DESCRIPTION`       | constant | Canonical description for the `skills` command |
| `STATUSLINE_USAGE`                 | constant | Usage text for the `statusline` command        |
| `USER_LOCAL_COMMAND_ARGUMENT_HINT` | constant | Argument hint for `user-local`                 |
| `USER_LOCAL_COMMAND_DESCRIPTION`   | constant | Description for `user-local`                   |
| `USER_LOCAL_COMMAND_USAGE`         | constant | Usage text for `user-local`                    |

## Extension Points

The shipped executable commands declare framework-owned semantic roles beside their owner ids:
`skills` declares `skillActivation`, `compact` declares `contextReduction`, and `agent` declares
`subagentSpawn`. These declarations are metadata on the actual `ISystemCommand` values; this package
does not maintain a parallel role-to-name registry. Renaming an owner command therefore changes only
that command value, while the framework projection follows the declaration.

- **`ICommandModule`** (from `agent-framework`): every command domain creates one via its factory function. Consumers can create additional `ICommandModule` values and register them alongside the defaults.
- **`ICommandSource`** (from `agent-framework`): each `*CommandSource` class implements `ICommandSource`. The skills module pushes a second source (`SkillCommandSource` from `agent-framework`) to expose file-based skills from explicit host or authority-backed contribution sources.
- **`ICommandPluginAdapter`** (from `agent-framework`): `createDefaultPluginCommandAdapter` returns a production implementation. Consumers may supply a different adapter (e.g., in tests) that satisfies the same interface.
- **`IProviderCommandSettingsAdapter`** (from `agent-framework`): consumers implement this interface to connect provider command operations to their settings backend. Startup helpers additionally accept discriminated `settingsSources` and `settingsStores`; project writes require an authority-backed store, while an unavailable requested project-local target fails with `WorkspaceAuthorityRequiredError` rather than deriving a path from `cwd`.
- **`IOrgPolicy`** (from `agent-framework`): passed to `createProviderCommandModule` and `createDefaultCommandModules`; gates provider switching and API key configuration per org policy.
- **CMD-004 ask seam** (`context.getUserInteraction()?.ask(IActionRequest)`, contract owned by `agent-core`): a command that needs input (mode/preset/language selection, the provider setup/edit/duplicate/delete wizard, exit/clear confirmation) asks for it inline at the top of `execute`. The host renders the `IActionRequest` per-environment; with no interactive renderer attached (headless/automation), `getUserInteraction()` returns `undefined` and the command takes its explicit no-human path. The CLI does not hard-code command-specific dialog logic.

### `/git` (BEHAVIOR-2437)

`/git` is ONE `ISystemCommand` whose `execute` parses its verb — `status` | `diff` | `commit` — with
the three verbs on `subcommands` for `/help` and autocomplete only. It is host-only
(`modelInvocable: false`), `lifecycle: 'blocking'`, and registered in `pack-coding` beside `/shell`
and `/editor`, mirrored in `createDefaultCommandModules()`.

- **Seam.** Every verb runs git through `IGitProcessPort` (`src/git/git-process.ts`); the production
  `createGitProcess()` is argv-only `execFile` (`shell: false`), closes stdin at once (a hook that
  reads it sees EOF), caps output at 16 MiB and bounds the child by a timeout (120 s by default), and
  returns a typed `TGitProcessOutcome` — `exited` with the exit code as DATA, or `failed` with
  `not-found` | `timeout` | `aborted` | `output-too-large`. It never throws. `gitEnvironment()` strips
  the repository-redirecting variables git exports into hooks (`GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`,
  `GIT_PREFIX`, `GIT_NAMESPACE`) and preserves everything else — identity, `GIT_CONFIG_GLOBAL`,
  `GPG_TTY`, `SSH_AUTH_SOCK`. The port is injectable through `createGitCommandModule({ port })`.
- **`status`** — `status --porcelain=v2 -z --branch`, parsed into the branch and the staged, unstaged,
  untracked (and conflicted) paths; a rename record keeps its pair; `-z` keeps a path with a space,
  a quote or a non-ASCII character one element. Exit 128 (not a repository) and a spawn failure are
  reported with git's own reason.
- **`diff`** — a closed grammar: bare, `--staged`, `<rev>`, `<a>..<b>`, each optionally followed by
  `-- <path> ...`. Every revision is verified with `rev-parse --verify --quiet --end-of-options
<rev>^{commit}` before any diff runs and an unknown one is refused by name; any other `-` token is
  refused with the usage line. In the argv git receives, `--end-of-options` precedes every revision
  and `--` every path.
- **`commit`** — the staged set only (never `-a`, never `add`, no paths). Nothing staged answers with
  guidance carrying the unstaged and untracked counts. The subject (inline, one matching pair of
  outer quotes stripped; or asked for as free text) is held to the Conventional Commits v1.0.0 MUST
  rules (`<type>[(scope)][!]: <description>`); the commitlint conventions (type list, 72 characters,
  no trailing period) are warnings shown in the confirmation, never refusals. The confirmation
  (`confirmAction`) lists the message and exactly the files `diff --cached --name-status` reports; an
  absent `IUserInteraction` is a cancellation with a message (the `/doctor repair` precedent), never a
  guess. Only after "Yes" does exactly `commit -m <subject>` run.
- **Known limits.** The slash tokeniser splits on whitespace with no quoting, so a path containing a
  space cannot be expressed by any slash command today, and the inline subject cannot carry a body.
  The timeout kills the direct `git` child only: a hook's grandchildren that keep the output pipes
  open delay the `timeout` outcome until they exit.

### Doctor (OBSERVABILITY-1991)

**Check model.** `IDoctorCheck { id, label, status, path?, cause?, detail?, repair? }` with
`status ∈ ok | warn | fail | not-configured | not-probed`. `fail` is the only status that raises the
report's `exitCode` to `1` (the CLI-067 contract). `not-configured` names an absent optional
capability out loud. `not-probed` is the **closed** list `TDoctorNotProbed` — `mcp-connection`,
`hook-execution`, `owner-only-mode` (on a platform whose guarantee is not `posix-mode`); an
unexpected inability to probe is `warn` with its reason. A probe that throws becomes a `fail` check
carrying the owner's error class and path — never a default value. Every check carries the exact
`path` and a `cause` built from owner-reported facts (a state word, an issue path, an errno).

**Probes and their owners.** Settings layers, per-key provenance, and each effective settings-layer hook's event/type/source in merge order — `inspectSettingsLayers` (`settings.<scope>.<robota|claude>`,
`settings.merge`). Disabled settings hooks are absent; plugin-contributed hook provenance is outside this settings view. The `settings.merge` provenance lines never render hook commands or prompts. A broken
layer makes this healthy-layer view partial and the merge check `warn`. Provider resolution — `readProviderSettings`
(`provider.resolution`); reachability — a TCP connect to the host derived from the resolved profile
`baseURL`, else the definition's `defaults.baseURL`, else the definition's diagnostic-only
`endpoint`, else `warn` (`provider.reachability`; an unreachable host is `warn`, so an offline
doctor exits `0`); credential quarantine (`provider.security`); workspace trust with the owner's
`cause` (`workspace.trust`); user and project storage — existence, `W_OK`, owner-only mode
(`storage.user`, `storage.project`); plugins — `inspectPluginsSync` per scope (`plugins`,
`plugin.<id>` `fail` for a plugin that cannot load, `plugin.<id>.hooks` `warn` report-only); skills
and commands — `inspectSkillSources` (`skills`, `skill.<path>`); hooks — every `command` hook's
executable on `PATH` (`hooks`, `hooks.execution` `not-probed`); MCP — the activation adapter when the
host supplies one (`mcp.activation`, `mcp.<serverId>`) and plugin-declared servers with a structural
check at `warn` severity (`mcp.plugin.<id>.<server>`), plus `mcp.connection` `not-probed`.

**Redaction.** Two layers: the inspection APIs return facts, never file content; and every rendered
string passes `redactDiagnosticText` with the secrets `collectSettingsSecrets` gathered (every
literal `apiKey` in any layer, every `$ENV:`-referenced value, every `env` map value) plus the
resolved credential. URL userinfo, bearer tokens and vendor-key shapes are masked unconditionally.

**Repair.** The allowlist (`doctorRepairAllowlist(inputs)`) is closed and product-neutral: the host's
own user settings layer (`inputs.userSettingsPath`, id `settings.user.<family>`) when it is `empty`
(`writeSettings(path, {})`) and `storage.user` when the host's `inputs.userStorage` root or sessions
directory is missing or not owner-only (`ensureOwnerOnlyDirectory`). `applyDoctorRepair` plans, confirms through
the caller's prompt, **re-plans immediately before writing**, and refuses an unknown id, a
non-repairable state, a state that changed, or an already-clean check — with no write.

**Read-only claim, stated honestly.** The doctor performs no write of its own outside an explicit
repair; the host's trust-store read that precedes it tightens the store's mode (SEC-020), which is
the host's pre-existing behaviour, not the doctor's.

### Org-policy enforcement in `provider`

`createProviderCommandModule` accepts `orgPolicy?: IOrgPolicy`. When present:

- **`allowedProviders`**: `buildProviderSwitch` rejects `/provider switch <name>` if the target profile name is not in the list, returning `{ success: false }` with a violation message before writing settings.
- **`requireApiKeyFromEnv`**: `completeProviderEdit` rejects a completed provider setup if `input.apiKey` is a plaintext value (does not start with `$ENV:`). The check runs before `buildProviderSetupPatch` is called.
- **`adminContact`**: appended to every violation message when set.

`InteractiveSession` (in `agent-framework`) handles `blockedCommands` and the `provider-hot-swap-requested` effect for `allowedProviders` checks at the session layer.

### `/context` reports what the tool schemas cost (CLI-1990)

`formatFullContextBreakdown` renders a **Tool schemas (sent every turn)** section beside the system
prompt one, listing the offered tool names and their estimated token cost
(`estimateToolSchemaTokens` over `ICommandSessionRuntime.getOfferedToolSchemas()`), and returns the
figure as `data.toolSchemaTokens` so a caller can compare configurations without parsing the
message back out.

It reads the **offered** set, not the registered one: with deferral engaged (agent-core
`docs/SPEC.md` § Tool Residency and Tool Search), a tool declaring `deferLoading` that the model has
not yet loaded through `ToolSearch` never reaches the request, so it is not counted, and the figure
falls. That fall is the point — before this line, nothing
separated the tool schemas from the system prompt they are billed alongside
(`estimateSerializedContextTokens` covers messages only, and the existing tool line counts tool
_results_), so the saving deferral exists to produce had no observable at all.

Contract test: `src/context/__tests__/context-command-module.test.ts` § CLI-1990 TC-12.

## Error Taxonomy

This package does not define custom error classes. All execution errors surface as `ICommandResult` values with `success: false` and a human-readable `message`. Thrown errors are limited to:

| Condition                                  | Throw site                                             | Recoverable               |
| ------------------------------------------ | ------------------------------------------------------ | ------------------------- |
| `agent-runtime` capability not available   | `getAgentHostContext` in `agent-command-module.ts`     | no (session config error) |
| Plugin ID not in `name@marketplace` format | `installPlugin` in `default-plugin-command-adapter.ts` | yes (user input error)    |

The `plugins/default-plugin-command-adapter.ts` allows fallback on marketplace manifest fetch failure (non-fatal, returns empty list). This is marked `// allow-fallback` inline.

## Test Strategy

The maintained public-SDK scenario
`examples/verify-semantic-command-roles.ts` verifies the three shipped declarations, alternate command
ids, unannotated coincidental names, independent role omission as it reaches subagent tool filtering
and the context-capacity hint, and typed duplicate rejection with atomic preservation.
`scenario:verify:semantic-command-roles` runs it offline and `scenario:record` owns
`examples/scenarios/semantic-command-roles.record.json` as its canonical observable.

**What this scenario deliberately does NOT cover, and where it moved.** Assertions about the system
message an assembled session composes for a role projection — alternate id gains skill metadata, a
coincidental name does not, single-role omission at the prompt level, and a session assembled with no
projection at all — now live in
`packages/agent-framework/src/__tests__/semantic-role-projection-in-assembled-session.test.ts`, except
the subagent-spawn half of that last one, which
`packages/agent-framework/src/__tests__/create-subagent-session.test.ts` already covered independently. They
are agent-framework behaviour end to end: no command module takes part in them. Proving them from
here required reaching the framework's `createSession` assembly factory through its package root,
which is the only reason that factory was ever exported (issue #2270). The framework test reaches it
by relative import, so the behaviour stays pinned without a public surface.

Test files: 22 (one per command module plus extras for `model-pricing`, `org-policy`, and `provider-setup-flow`).

```
src/agent/__tests__/agent-command.test.ts
src/background/__tests__/background-command-module.test.ts
src/compact/__tests__/compact-command-module.test.ts
src/context/__tests__/context-command-module.test.ts
src/exit/__tests__/exit-command-module.test.ts
src/help/__tests__/help-command-module.test.ts
src/help/__tests__/help-command.test.ts
src/language/__tests__/language-command-module.test.ts
src/memory/__tests__/memory-command-module.test.ts
src/mode/__tests__/mode-command-module.test.ts
src/permissions/__tests__/permissions-command-module.test.ts
src/plugin/__tests__/plugin-command-module.test.ts
src/provider/__tests__/org-policy.test.ts
src/provider/__tests__/provider-command-module.test.ts
src/provider/__tests__/provider-setup-flow.test.ts
src/reset/__tests__/reset-command-module.test.ts
src/rewind/__tests__/rewind-command-module.test.ts
src/session/__tests__/model-pricing.test.ts
src/session/__tests__/session-command-module.test.ts
src/skills/__tests__/skills-command-module.test.ts
src/statusline/__tests__/statusline-command-module.test.ts
src/user-local/__tests__/user-local-command.test.ts
```

Run:

```bash
pnpm --filter @robota-sdk/agent-command test
```

Coverage gaps: `src/default/` and `src/plugins/` subdirectories have no dedicated test files. Integration coverage comes from `agent-cli` and `agent-framework` tests.

## Class Contract Registry

| Class                        | Implements       | Defined In                                            |
| ---------------------------- | ---------------- | ----------------------------------------------------- |
| `AgentCommandSource`         | `ICommandSource` | `src/agent/agent-command-module.ts`                   |
| `BackgroundCommandSource`    | `ICommandSource` | `src/background/background-command-module.ts`         |
| `DoctorCommandSource`        | `ICommandSource` | `src/doctor/doctor-command-module.ts`                 |
| `CompactCommandSource`       | `ICommandSource` | `src/compact/compact-command-module.ts`               |
| `ContextCommandSource`       | `ICommandSource` | `src/context/context-command-module.ts`               |
| `EditorCommandSource`        | `ICommandSource` | `src/editor/editor-command-module.ts`                 |
| `ExitCommandSource`          | `ICommandSource` | `src/exit/exit-command-module.ts`                     |
| `GitCommandSource`           | `ICommandSource` | `src/git/git-command-module.ts`                       |
| `GoalCommandSource`          | `ICommandSource` | `src/goal/goal-command-module.ts`                     |
| `HelpCommandSource`          | `ICommandSource` | `src/help/help-command-module.ts`                     |
| `LanguageCommandSource`      | `ICommandSource` | `src/language/language-command-module.ts`             |
| `MemoryCommandSource`        | `ICommandSource` | `src/memory/memory-command-module.ts`                 |
| `MCPActivationCommandSource` | `ICommandSource` | `src/mcp-activation/mcp-activation-command-module.ts` |
| `ModeCommandSource`          | `ICommandSource` | `src/mode/mode-command-module.ts`                     |
| `PermissionsCommandSource`   | `ICommandSource` | `src/permissions/permissions-command-module.ts`       |
| `PluginManagerCommandSource` | `ICommandSource` | `src/plugin/plugin-command-module.ts`                 |
| `PresetCommandSource`        | `ICommandSource` | `src/preset/preset-command-module.ts`                 |
| `ProviderCommandSource`      | `ICommandSource` | `src/provider/provider-command-module.ts`             |
| `RemoteControlCommandSource` | `ICommandSource` | `src/remote-control/remote-control-command-module.ts` |
| `ResetCommandSource`         | `ICommandSource` | `src/reset/reset-command-module.ts`                   |
| `RewindCommandSource`        | `ICommandSource` | `src/rewind/rewind-command-module.ts`                 |
| `ScheduleCommandSource`      | `ICommandSource` | `src/schedule/schedule-command-module.ts`             |
| `SessionCommandSource`       | `ICommandSource` | `src/session/session-command-module.ts`               |
| `SettingsCommandSource`      | `ICommandSource` | `src/settings/settings-command-module.ts`             |
| `ShellCommandSource`         | `ICommandSource` | `src/shell/shell-command-module.ts`                   |
| `SkillsCommandSource`        | `ICommandSource` | `src/skills/skills-command-module.ts`                 |
| `StatusLineCommandSource`    | `ICommandSource` | `src/statusline/statusline-command-module.ts`         |
| `UserLocalCommandSource`     | `ICommandSource` | `src/user-local/user-local-command-module.ts`         |

## Migration

Consolidated from 20 individual per-command packages (v3.0.0-beta.63):

- the former `@robota-sdk/agent-command-<name>` packages (e.g. `<name>` = agent, background, provider, …) → all merged into `@robota-sdk/agent-command`

Consumers replace all 20 individual imports with a single dependency:

```json
"dependencies": {
  "@robota-sdk/agent-command": "workspace:*"
}
```

And update imports:

```typescript
// Before (one of the 20 former per-command packages)
import { Y } from '@robota-sdk/agent-command-<name>';

// After
import { Y } from '@robota-sdk/agent-command';
```
