# Agent CLI Composition Tree

Source-verified against `develop` on 2026-05-11.

This document owns the concrete startup tree from `packages/agent-cli/src/bin.ts` through
interactive TUI and print-mode composition.

## CLI Composition Tree

```text
packages/agent-cli/src/bin.ts
`- startCli() from src/cli.ts
   |- parseCliArgs()
   |- readVersion(), update-check flags, reset/configure flags
   |- build commandHostAdapters
   |  |- settings adapter -> settings-io.ts
   |  `- plugin adapter -> plugins/plugin-command-adapter.ts
   |- providerDefinitions = DEFAULT_PROVIDER_DEFINITIONS
   |  |- agent-provider-anthropic
   |  |- agent-provider-openai
   |  |- agent-provider-gemini
   |  |- agent-provider-gemma
   |  |- agent-provider-qwen
   |  `- agent-provider-deepseek
   |- commandModules (via createDefaultCliCommandModules())
   |  |- createSkillsCommandModule({ cwd })
   |  |- createHelpCommandModule()
   |  |- createAgentCommandModule()
   |  |- createModelCommandModule({ providerDefinitions })
   |  |- createPermissionsCommandModule()
   |  |- createLanguageCommandModule()
   |  |- createBackgroundCommandModule()
   |  |- createMemoryCommandModule()
   |  |- createUserLocalCommandModule()
   |  |- createCompactCommandModule()
   |  |- createContextCommandModule()
   |  |- createExitCommandModule()
   |  |- createSessionCommandModule()
   |  |- createResetCommandModule()
   |  |- createRewindCommandModule()
   |  |- createStatusLineCommandModule()
   |  |- createPluginCommandModule()
   |  |- createProviderCommandModule({ providerDefinitions, settings adapter })
   |  `- options.commandModules (injected extras)
   |- ensureConfig() / provider setup
   |- readProviderSettings() and createProviderFromSettings()
   |- create runtime adapters
   |  |- managed shell background runner
   |  `- child-process subagent runner factory
   |- createProjectSessionStore(cwd) from SDK for resume/persistence facade
   |- if -p print mode
   |  |- new InteractiveSession({ cwd, provider, commandModules, commandHostAdapters, ... })
   |  |- createHeadlessTransport({ outputFormat, prompt })
   |  |- session.attachTransport(transport)
   |  `- transport.start(); session.shutdown()
   `- otherwise interactive mode
      |- new TuiTransport({ cwd, provider, ..., transportRegistry, cliAdapter })
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
