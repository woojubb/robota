# Agent CLI Composition Tree

Source-verified against `refactor/arch-002-slim-agent-cli` on 2026-05-17.

This document owns the concrete startup tree from `packages/agent-cli/src/bin.ts` through
interactive TUI and print-mode composition.

`cli.ts` is a pure composition root (~165 lines) — no function definitions, only
import-and-call. All behavior lives in dedicated startup modules, mode runners, and packages.

## CLI Composition Tree

```text
packages/agent-cli/src/bin.ts
`- startCli() from src/cli.ts  [pure composition root]
   |- parseCliArgs()  (utils/cli-args.ts)
   |- readVersion()  (startup/version.ts)
   |- update-check flags  (checkForCliUpdate from agent-framework)
   |- resetConfig()  (startup/reset-config.ts)
   |- runUserLocalDirectCommandIfRequested()  (user-local-direct-command.ts)
   |- buildCommandSetup()  (startup/command-setup.ts)
   |  |- commandHostAdapters
   |  |  |- settings adapter -> agent-framework settings-io
   |  |  `- plugin adapter -> plugins/plugin-command-adapter.ts
   |  |- providerDefinitions = DEFAULT_PROVIDER_DEFINITIONS  (utils/provider-default-definitions.ts)
   |  |  |- agent-provider-anthropic
   |  |  |- agent-provider-openai
   |  |  |- agent-provider-gemini
   |  |  |- agent-provider-gemma
   |  |  |- agent-provider-qwen
   |  |  `- agent-provider-deepseek
   |  |- commandModules (via createDefaultCommandModules() from agent-command)
   |  |  |- createSkillsCommandModule({ cwd })
   |  |  |- createHelpCommandModule()
   |  |  |- createAgentCommandModule()
   |  |  |- createModelCommandModule({ providerDefinitions })
   |  |  |- createPermissionsCommandModule()
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
   |  |  |- createStatusLineCommandModule()
   |  |  |- createPluginCommandModule()
   |  |  |- createProviderCommandModule({ providerDefinitions, settings adapter })
   |  |  `- options.commandModules (injected extras)
   |  `- startupUpdateNoticePromise (getStartupCliUpdateNotice from agent-framework)
   |- runInteractiveProviderSetup() / handleProviderConfigurationArgs() / ensureConfig()
   |- readProviderSettings() and createProviderFromSettings()  (agent-framework)
   |- createDefaultBackgroundTaskRunners()  (agent-executor)
   |- createChildProcessSubagentRunnerFactory()  (subagents/)
   |- createProjectSessionStore(cwd)  (agent-framework)
   |- if -p print mode
   |  `- runPrintMode()  (modes/print-mode.ts)
   |     |- new InteractiveSession({ cwd, provider, commandModules, commandHostAdapters, ... })
   |     |- createHeadlessTransport({ outputFormat, prompt })  (agent-transport/headless)
   |     |- session.attachTransport(transport)
   |     `- transport.start(); session.shutdown()
   `- otherwise interactive mode
      |- new TuiTransport({ cwd, provider, ..., transportRegistry, cliAdapter })
      |  |- transportRegistry = createDefaultTransportRegistry()  (transports/transport-registry.ts)
      |  `- cliAdapter = createDefaultTuiCliAdapter()  (agent-transport/tui)
      `- tuiTransport.start() -> renderApp()  (agent-transport-tui)
         `- App.tsx  (agent-transport-tui)
            |- useInteractiveSession()
            |  |- new InteractiveSession({ cwd, provider, commandModules, commandHostAdapters, ... })
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
