# Agent CLI Composition Tree

Part of the [agent-cli composition map](../agent-cli-composition.md).

Source-verified against `develop` on 2026-07-12.

This document owns the concrete startup tree from `packages/agent-cli/src/bin.ts` through
interactive TUI and print-mode composition.

`cli.ts` is a composition root (329 lines) — it imports from startup modules / mode runners /
packages and wires them together inline. It defines one local composition helper,
`createDefaultTransportRegistry()` (`cli.ts:62-66`), which wires `WsTransport` (from
`@robota-sdk/agent-transport-ws`) into a `TransportRegistry` (from `@robota-sdk/agent-transport`);
choosing which concrete transports to pre-register is an app-assembly decision owned by the
composition root. All other behavior helpers live in `src/startup/*`, `src/modes/*`, and lower
packages. Early-exit gates (`--version`, `--help`, `--check-update`, `--reset`, `diagnose`,
`session analyze`, `init`, `--configure`), preset id selection, and provider/session/subagent
assembly are sequenced directly in `startCli()`.

## CLI Composition Tree

```text
packages/agent-cli/src/bin.ts
`- startCli() from src/cli.ts  [pure composition root]
   |- parseCliArgs()  (utils/cli-args.ts)
   |- readVersion()  (startup/version.ts)
   |- update-check flags  (checkForCliUpdate from agent-framework)
   |- resetConfig()  (startup/reset-config.ts)
   |- runUserLocalDirectCommandIfRequested()  (user-local-direct-command.ts)
   |- preset selection (thin shell — PRESET-002/004/007/011)
   |  |- readSettings(getUserSettingsPath()).preset -> settingsPreset  (agent-framework)
   |  |- loadExternalPresets()  (agent-preset) — register ~/.robota/presets/*.json; per-file errors non-fatal
   |  |- resolveCliPreset(args, settingsPreset)  (startup/preset-selection.ts)
   |  |  |- selectPresetId(args, settingsPreset)  (--preset > settings.preset > 'default')
   |  |  `- resolvePreset(id, { cliOverrides })  (agent-preset) — precedence merge owned by agent-preset
   |  `- selectedPresetId = selectPresetId(args, settingsPreset)  (PRESET-011 runtime active-preset state)
   |- buildCommandSetup()  (startup/command-setup.ts)
   |  |  (receives resolvedPreset.enabledCommandModules / disabledCommandModules selection delta)
   |  |- commandHostAdapters
   |  |  |- settings adapter -> agent-framework settings-io
   |  |  `- plugin adapter -> createDefaultPluginCommandAdapter()  (agent-command)
   |  |- providerDefinitions = createDefaultProviderDefinitions()  (agent-provider-defaults)
   |  |  |- createAnthropicProviderDefinition()  (agent-provider-anthropic)
   |  |  |- createOpenAIProviderDefinition()  (agent-provider-openai)
   |  |  |- createGeminiProviderDefinition()  (agent-provider-gemini)
   |  |  `- Gemma / Qwen / DeepSeek definitions  (agent-provider-openai-compatible)
   |  |- commandModules (via createDefaultCommandModules() from agent-command — default-command-modules.ts)
   |  |  |- createSkillsCommandModule({ cwd })
   |  |  |- createHelpCommandModule()
   |  |  |- createAgentCommandModule()
   |  |  |- createPermissionsCommandModule()
   |  |  |- createModeCommandModule()
   |  |  |- createPresetCommandModule()
   |  |  |- createLanguageCommandModule()
   |  |  |- createBackgroundCommandModule()
   |  |  |- createMemoryCommandModule()
   |  |  |- createUserLocalCommandModule()
   |  |  |- createCompactCommandModule()
   |  |  |- createContextCommandModule()
   |  |  |- createExitCommandModule()
   |  |  |- createSessionCommandModule()
   |  |  |- createResetCommandModule()
   |  |  |- createRewindCommandModule()
   |  |  |- createScheduleCommandModule()
   |  |  |- createStatusLineCommandModule()
   |  |  |- createPluginCommandModule()
   |  |  |- createSettingsCommandModule()
   |  |  `- createProviderCommandModule({ providerDefinitions, settings adapter })
   |  |     (the full set is then filtered by the preset enabled/disabled module selection delta)
   |  |- options.commandModules (injected extras, appended in buildCommandSetup after the defaults)
   |  `- startupUpdateNoticePromise (getStartupCliUpdateNotice from agent-framework)
   |- runInteractiveProviderSetup() / handleProviderConfigurationArgs() / ensureConfig()  (startup/provider-startup.ts)
   |- readProviderSettings() and createProviderFromSettings(cwd, resolvedPreset.model, ...)  (agent-framework)
   |  `- modelId = resolvedPreset.model ?? providerSettings.model  (preset model override wins)
   |- createDefaultBackgroundTaskRunners()  (agent-executor)
   |- createChildProcessSubagentRunnerFactory()  (agent-subagent-runner)
   |  `- workerPath = getDefaultSubagentWorkerPath()  (agent-subagent-runner)
   |- createProjectSessionStore(cwd)  (agent-framework)
   |- if -p print mode
   |  `- runPrintMode(..., presetOptions)  (modes/print-mode.ts)
   |     |  presetOptions = { agentName: resolvedPreset.agentName ?? DEFAULT_AGENT_NAME,
   |     |                    activePresetId: selectedPresetId, persona, permissionMode,
   |     |                    enableParallelSubagents, selfVerification }
   |     |- new HeadlessInteractionChannel({ cwd, provider, outputFormat, permissionMode,
   |     |    commandModules, commandHostAdapters, persona, agentName, activePresetId, ... })  (agent-transport/headless)
   |     `- channel.run(prompt); process.exit(channel.getExitCode())
   `- otherwise interactive mode
      `- renderApp({ cwd, provider, ..., transportRegistry, cliAdapter,
         |           agentName, activePresetId, persona, enableParallelSubagents, selfVerification })  (agent-transport-tui)
         |  |- transportRegistry = createDefaultTransportRegistry()  (LOCAL helper in cli.ts:62-66 —
         |  |     new TransportRegistry(...) from agent-transport, registers WsTransport from agent-transport-ws)
         |  |- cliAdapter = createDefaultTuiCliAdapter({ providerDefinitions, reloadPluginCommandSource })  (agent-transport-tui)
         |  |     `- reloadPluginCommandSource  (agent-command)
         |  `- agentName/activePresetId/persona forwarded from resolvedPreset + selectedPresetId
         `- App.tsx  (agent-transport-tui)  [createChannel factory -> TuiInteractionChannel]
            |- useTuiChannel()
            |  |- new TuiInteractionChannel({ cwd, provider, commandModules, commandHostAdapters,
            |  |    agentName, activePresetId, persona, ... })
            |  |- CommandRegistry
            |  |- CommandEffectQueue
            |  |- register injected command modules
            |  |- PluginCommandSource reload
            |  `- TuiStateManager event bridge
            |     |- SDK skill_activation -> MessageList system event
            |     `- SDK execution_workspace_event -> workspace snapshot render state
            |- useSlashRouting()
            |  |- non-slash input -> interactiveSession.submit()
            |  `- slash input -> interactiveSession.executeCommand()
            |- useSideEffects()
            |  |- render generic ICommandInteraction prompts via ITuiCliAdapter
            |  `- apply typed TCommandEffect values
            `- Ink renderers
               |- MessageList
               |- InputArea
               |- ExecutionWorkspaceSwitcher / ExecutionWorkspaceDetailPane
               |- BackgroundTaskPanel
               |- SessionStatusBar / StatusBar
               |- PermissionPrompt
               |- InteractivePrompt
               |- ConfirmPrompt
               |- PluginTUI
               `- SessionPicker
```

## Package name map (old → current)

When reading older branches or PRs, use this map.

| Old name (pre-2026-05) | Current name                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `agent-runtime`        | `agent-executor`                                                                                                |
| `agent-sessions`       | `agent-session`                                                                                                 |
| `agent-providers`      | `agent-provider-*` (per-vendor split; no bare `agent-provider` package)                                         |
| `agent-plugins`        | `agent-plugin`                                                                                                  |
| `agent-sdk`            | `agent-framework`                                                                                               |
| `agent-transport/ws`   | `agent-transport-ws` (separate package)                                                                         |
| `agent-transport/tui`  | `agent-transport-tui` (separate package)                                                                        |
| `agent-command-*`      | `agent-command`                                                                                                 |
| `agent-web`            | `agent-transport-gui` / `agent-transport-webrtc-web` (pkgs), `apps/agent-web-monitor` / `apps/agent-web` (apps) |

## Startup Module Boundary Map

Each startup module owns a distinct architectural concern. `startCli()` sequences the
early-exit gates, preset selection, and provider/session/subagent assembly inline; the
modules below hold the extracted behavior helpers (verified against `src/startup/`):

| Module                            | Concern                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `startup/preset-selection.ts`     | Preset id selection glue + `resolveCliPreset` (thin shell over agent-preset)     |
| `startup/command-setup.ts`        | Command modules + host adapters assembly (`buildCommandSetup`)                   |
| `startup/provider-startup.ts`     | Interactive provider config + `ensureConfig` / `handleProviderConfigurationArgs` |
| `startup/append-system-prompt.ts` | `buildAppendSystemPrompt` (task-file + flag composition)                         |
| `startup/reset-config.ts`         | `--reset` destructive-action flow (`runResetConfig`)                             |
| `startup/diagnose-command.ts`     | `robota diagnose` setup report (`runDiagnoseCommand`)                            |
| `startup/first-run.ts`            | First-run onboarding gate (`isFirstRun` / `printFirstRunWelcome`)                |
| `startup/terminal-check.ts`       | macOS Terminal.app warning (`warnIfTerminalAppOnMacOS`)                          |
| `startup/version.ts`              | Version string reading (`readVersion`)                                           |
