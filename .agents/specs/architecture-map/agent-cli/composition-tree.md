# Agent CLI Composition Tree

Source-verified against `refactor/arch-002-slim-agent-cli` on 2026-05-17.

This document owns the concrete startup tree from `packages/agent-cli/src/bin.ts` through
interactive TUI and print-mode composition.

`cli.ts` is a pure composition root (196 lines) — no function definitions, only
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
   |  |  `- plugin adapter -> createDefaultPluginCommandAdapter()  (agent-command)
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
   |- createChildProcessSubagentRunnerFactory()  (agent-subagent-runner)
   |  `- workerPath = getDefaultSubagentWorkerPath()  (agent-subagent-runner)
   |- createProjectSessionStore(cwd)  (agent-framework)
   |- if -p print mode
   |  `- runPrintMode()  (modes/print-mode.ts)
   |     |- new InteractiveSession({ cwd, provider, commandModules, commandHostAdapters, ... })
   |     |- createHeadlessTransport({ outputFormat, prompt })  (agent-transport/headless)
   |     |- session.attachTransport(transport)
   |     `- transport.start(); session.shutdown()
   `- otherwise interactive mode
      |- new TuiTransport({ cwd, provider, ..., transportRegistry, cliAdapter })
      |  |- transportRegistry = createDefaultTransportRegistry()  (agent-transport)
      |  `- cliAdapter = createDefaultTuiCliAdapter({ providerDefinitions, reloadPluginCommandSource })  (agent-transport/tui)
      |     `- reloadPluginCommandSource  (agent-command)
      `- tuiTransport.start() -> renderApp()  (agent-transport/tui)
         `- App.tsx  (agent-transport/tui)
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

## Package name map (old → current)

When reading older branches or PRs, use this map.

| Old name (pre-2026-05) | Current name                                  |
| ---------------------- | --------------------------------------------- |
| `agent-runtime`        | `agent-executor`                              |
| `agent-sessions`       | `agent-session`                               |
| `agent-providers`      | `agent-provider`                              |
| `agent-plugins`        | `agent-plugin`                                |
| `agent-sdk`            | `agent-framework`                             |
| `agent-transport-ws`   | `agent-transport/ws`                          |
| `agent-transport-tui`  | `agent-transport/tui`                         |
| `agent-command-*`      | `agent-command`                               |
| `agent-web`            | `agent-web-ui` (pkg) / `apps/agent-web` (app) |

## Startup Module Boundary Map

Each startup module owns a distinct architectural concern:

| Module                       | Concern                                          |
| ---------------------------- | ------------------------------------------------ |
| `startup/preflight.ts`       | Early-exit gate (--version, --help, reset, etc.) |
| `startup/args-to-options.ts` | IParsedCliArgs → typed option objects boundary   |
| `startup/command-setup.ts`   | Command modules + host adapters assembly         |
| `startup/config-phase.ts`    | Interactive provider configuration flow          |
| `startup/provider-setup.ts`  | Provider + subagent runner factory               |
| `startup/subagent-setup.ts`  | agent-subagent-runner opt-in wiring              |
| `startup/session-setup.ts`   | Session store creation                           |
| `startup/update-notice.ts`   | CLI update notification resolution               |
| `startup/version.ts`         | Version string reading                           |
