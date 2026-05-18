# Agent CLI Composition Tree

Source-verified against `develop` on 2026-05-18 (merged from `refactor/arch-002-slim-agent-cli`).

This document owns the concrete startup tree from `packages/agent-cli/src/bin.ts` through
interactive TUI and print-mode composition.

`cli.ts` is a pure composition root (98 lines) — no function definitions, only
import-and-call. All behavior lives in dedicated startup modules, mode runners, and packages.

## CLI Composition Tree

```text
packages/agent-cli/src/bin.ts  [1-line entry point]
`- startCli()  (src/cli.ts, 98 lines — pure composition root)

   Layer 0: Pre-flight — all early-exit commands in one place
   |- parseArgsOrExit()  (utils/cli-args.ts → parseCliArgs)
   |- readVersion()  (startup/version.ts)
   |- handlePreflightCommands(args, { version, terminal })  (startup/preflight.ts)
   |  `- early exit for --version, --help, reset, etc.

   Layer 1: arg → typed option boundary
   |- toConfigPhaseOptions(args)  (startup/args-to-options.ts)
   |- toSessionRunOptions(args)  (startup/args-to-options.ts)
   |- toUserLocalCommandOptions(args)  (startup/args-to-options.ts)
   |- toStartupUpdatePolicyOptions(args)  (startup/args-to-options.ts)
   |- runUserLocalDirectCommandIfRequested(...)  (user-local-direct-command.ts)

   Layer 2: sub-layer assembly (TTY detection + setup factories)
   |- isTTY = process.stdin.isTTY && process.stdout.isTTY
   |- createCommandSetup(cwd, options)  (startup/command-setup.ts)
   |  |- commandHostAdapters
   |  |  |- settings adapter -> agent-framework settings-io
   |  |  `- plugin adapter -> createDefaultPluginCommandAdapter()  (agent-command)
   |  |- commandModules via createDefaultCommandModules()  (agent-command)
   |  |  |- createSkillsCommandModule, createHelpCommandModule
   |  |  |- createAgentCommandModule, createModelCommandModule
   |  |  |- createPermissionsCommandModule, createLanguageCommandModule
   |  |  |- createBackgroundCommandModule, createMemoryCommandModule
   |  |  |- createUserLocalCommandModule, createCompactCommandModule
   |  |  |- createContextCommandModule, createExitCommandModule
   |  |  |- createSessionCommandModule, createResetCommandModule
   |  |  |- createRewindCommandModule, createStatusLineCommandModule
   |  |  |- createPluginCommandModule
   |  |  |- createProviderCommandModule({ providerDefinitions, settings adapter })
   |  |  `- options.commandModules (injected extras)
   |  `- reloadPluginCommandSource  (agent-command)
   |- handleConfigPhase(cwd, configPhaseOpts, commandSetup, terminal, isTTY)  (startup/config-phase.ts)
   |  `- early exit if provider setup required
   |- createProviderSetup(cwd, configPhaseOpts, commandSetup)  (startup/provider-setup.ts)
   |  |- createProviderFromSettings(cwd, model, opts)  (agent-framework)
   |  `- createSubagentSetup(...)  (startup/subagent-setup.ts)
   |     `- subagentRunnerFactory from agent-subagent-runner (opt-in)
   `- createSessionSetup(cwd, sessionOpts)  (startup/session-setup.ts)
      `- sessionStore = createProjectSessionStore(cwd)  (agent-framework)

   Layer 3: runtime assembly
   |- createAgentRuntime({ cwd, provider, commandModules, commandHostAdapters,
   |    reloadPluginCommandSource, subagentRunnerFactory, sessionStore,
   |    transportRegistry })  (agent-framework)
   |  `- createDefaultBackgroundTaskRunners()  (agent-executor, called internally)
   `- createDefaultTransportRegistry()  (agent-transport)

   Layer 4: mode / transport dispatch
   |- if -p / --print mode
   |  `- runPrintMode(sessionOpts, runtime)  (modes/print-mode.ts)
   |     |- session = runtime.createSession({ ... })  (IAgentRuntime.createSession)
   |     |- createHeadlessTransport({ outputFormat, prompt })  (agent-transport/headless)
   |     |- session.attachTransport(transport)
   |     `- transport.start(); session.shutdown()
   `- otherwise interactive TUI mode
      `- runTuiMode({ runtime, version, commandSetup, providerSetup,
           sessionSetup, sessionOpts, startupUpdateNotice })  (modes/tui-mode.ts)
         |- cliAdapter = createDefaultTuiCliAdapter(...)  (agent-transport/tui)
         `- new TuiTransport(options: ITuiRenderOptions)  (agent-transport/tui)
            `- tuiTransport.start() -> renderApp(options)  (agent-transport/tui/render.tsx)
               `- App.tsx  (agent-transport/tui)
                  |- <TuiCliAdapterProvider value={cliAdapter}>  (tui-cli-adapter-context.tsx)
                  |- usePluginCallbacks(cwd)  (hooks/usePluginCallbacks.ts)
                  |- useStatusLineSettings()  (hooks/useStatusLineSettings.ts)
                  |- useInteractiveSession(runtime, ...)  (hooks/use-interactive-session.ts)
                  |  `- initializeSession(runtime, ...)  (hooks/use-interactive-session-init.ts)
                  |     |- new InteractiveSession({ ... })  (agent-framework)
                  |     |- CommandRegistry  (agent-framework)
                  |     |- CommandEffectQueue  (tui/hooks/command-effect-queue.ts)
                  |     |- register injected command modules
                  |     |- PluginCommandSource reload
                  |     `- TuiStateManager event bridge
                  |        |- framework skill_activation -> MessageList system event
                  |        `- framework execution_workspace_event -> workspace render state
                  |- useSlashRouting()
                  |  |- non-slash input -> interactiveSession.submit()
                  |  `- slash input -> interactiveSession.executeCommand()
                  |- useSideEffects()
                  |  |- render generic ICommandInteraction prompts via ITuiCliAdapter
                  |  `- apply typed TCommandEffect values
                  |- <UpdateNotice>  (UpdateNotice.tsx)
                  |- <StreamingIndicator>  (StreamingIndicator.tsx)
                  |- <TransportTUI>  (TransportTUI.tsx) [conditional]
                  |- <SessionStatusBar>  (SessionStatusBar.tsx)
                  |  `- <StatusBar>  (StatusBar.tsx) [inside SessionStatusBar]
                  |- <InputArea>  (InputArea.tsx)
                  |  `- <SlashAutocomplete>  [inside InputArea]
                  `- Ink renderers (main content area)
                     |- <MessageList>
                     |- <ExecutionWorkspaceSwitcher> / <ExecutionWorkspaceDetailPane>
                     |- <BackgroundTaskPanel>
                     |- <PermissionPrompt>
                     |- <InteractivePrompt>
                     |- <ConfirmPrompt>
                     |- <PluginTUI>
                     `- <SessionPicker>
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
