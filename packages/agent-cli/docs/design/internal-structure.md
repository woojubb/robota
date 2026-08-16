# agent-cli — source layout

> Whitebox design for `@robota-sdk/agent-cli`. The blackbox contract lives in
> [`../SPEC.md`](../SPEC.md); nothing here is a promise to a consumer. Placement follows the
> consumer-impact test in
> [`design-doc-authoring`](../../../../.agents/skills/design-doc-authoring/SKILL.md).

## Context & Goal

The directory tree of `packages/agent-cli/src`. Consumers import from the package root; no outside
code and no user depends on where a file sits.

## Constraints

- File-size limits from `REFACTOR-025` apply to every file listed here.
- Layer direction: components → hooks → services → SDK. A reverse edge is a defect.

## Internal Structure

```
src/
├── bin.ts                                        ← Binary entry point; top-level uncaughtException handler for IME errors
├── cli.ts                                        ← Lifecycle owner: arg parsing, layered assembly, mode dispatch
├── constants.ts                                  ← AGENT_CLI_BIN ('robota')
├── index.ts                                      ← Public CLI entry exports (startCli only)
├── user-local-direct-command.ts                  ← Direct user-local command handler (no provider)
├── init/
│   └── init-command.ts                           ← `robota init` — creates AGENTS.md + .robota/settings.json
├── modes/
│   ├── print-mode.ts                             ← Headless/print mode runner (-p flag); uses HeadlessInteractionChannel
├── session-analyzer/
│   └── session-analyze-command.ts                ← `robota session analyze` — thin wiring: loads records via framework session stores, delegates analysis/formatting to `@robota-sdk/agent-session-analytics`
├── eval/
│   └── eval-command.ts                           ← `robota eval <definition>` (SELFHOST-011) — thin wiring: loads a consumer eval definition, builds the default runFn from the resolved provider (`createSessionRunFn`), delegates scoring to `@robota-sdk/agent-framework` `runEval`; returns exit 0 (pass) / 1 (metric breach) — the CI gate
└── startup/
    ├── append-system-prompt.ts                   ← Builds appendSystemPrompt string from session options
    ├── command-setup.ts                           ← buildCommandSetup() — command modules, adapters, provider definitions
    ├── diagnose-command.ts                        ← runDiagnoseCommand() — `robota diagnose` 6-check setup report
    ├── first-run.ts                               ← isFirstRun() / markOnboarded() / printFirstRunWelcome(terminal)
    ├── preset-selection.ts                        ← selectPresetId() / resolveShellPreset() — the shell's single preset resolution over agent-preset's per-call registry
    ├── provider-startup.ts                        ← runInteractiveProviderSetup() — interactive provider config
    ├── reset-config.ts                            ← Deletes user settings file on --reset
    ├── terminal-check.ts                          ← warnIfTerminalAppOnMacOS(terminal) — macOS Terminal.app CJK warning
    └── version.ts                                 ← readVersion() — reads package.json version
```

All pre-session commands (`init`, `diagnose`, `session analyze`, `eval`, `user-local`, `--help`,
`--version`, `--check-update`, `--reset`, `--configure`) are dispatched inline by `startCli()` in
`src/cli.ts` — the composition root owns the single dispatch table. `eval` (like `session analyze`) is
intercepted on `process.argv` before the strict global `parseCliArgs()` because it carries a definition path

- `--threshold` the global parser would reject; its returned count maps to `process.exitCode` (0/1). In the TUI path, `startCli()`
  emits the macOS Terminal.app warning and the first-run welcome banner (creating the onboarded
  marker) immediately before `renderApp()`.

**Note:** `print-terminal.ts` and `types.ts` have been removed from `src/`. `ITerminalOutput` and
`ISpinner` are owned by `@robota-sdk/agent-core`; import them directly from that package. All Ink
TUI components, hooks, flows, `TuiStateManager`, and TUI-specific utilities are owned by
`@robota-sdk/agent-transport-tui`. The CLI's `src/` contains only the lifecycle assembly, local host
adapters, and settings/provider utilities.

**Note:** `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource`, `PluginCommandSource`, `SystemCommandExecutor`, `ICommand`, `ICommandSource`, and `executeSkill()` are owned by `@robota-sdk/agent-framework`. The CLI does not use `SystemCommandExecutor` directly; slash command execution goes through `session.executeCommand(name, args)`. The CLI has no `src/commands/` compatibility surface. Plugin command discovery uses the SDK-owned `PluginCommandSource`; plugin command execution lives in `@robota-sdk/agent-command`. The CLI's `src/index.ts` exports only `startCli`.

## Key Flows

Not applicable — this file describes layout, not behaviour. Behavioural flows live in the sibling
design docs and the contract lives in [`../SPEC.md`](../SPEC.md).

## Test Approach

Enforced structurally rather than by test: the file-size scan and the layer-direction check in
`pnpm harness:scan`.
