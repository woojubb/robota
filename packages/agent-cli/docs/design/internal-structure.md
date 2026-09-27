# agent-cli — source layout

> Whitebox design for `@robota-sdk/agent-cli`. The blackbox contract lives in
> [`../SPEC.md`](../SPEC.md); nothing here is a promise to a consumer.

## Context & Goal

A map of `packages/agent-cli/src` for contributors. Consumers import from the package root; no outside
code and no user depends on where a file sits.

## Constraints

- The public surface is `src/index.ts`: `startCli` and the `IStartCliOptions` type.
- The CLI holds no Ink components, hooks or render state. Those belong to
  `@robota-sdk/agent-ui-terminal`. Only `src/cli.ts` imports the terminal UI as values; the shared
  startup path (`src/cli-core.ts`) and the headless entry refer to it only through types, so the
  headless build carries no TUI.
- Command execution, the command registry and skill execution belong to
  `@robota-sdk/agent-framework`; command behaviour belongs to the `@robota-sdk/agent-command*`
  packages. The CLI has no `src/commands/` directory and never instantiates `SystemCommandExecutor`.

## Internal Structure

### Top-level files

| File                           | Role                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin.ts`                       | `robota` binary entry: installs the diagnostics sink and the last-resort crash policy, runs the subagent worker when asked, otherwise calls `startCli()` |
| `headless-bin.ts`              | Presentation-free entry for the desktop app's runtime; accepts only `--serve`                                                                            |
| `cli.ts`                       | `startCli()`: hands the terminal presentation to `startCliCore()`                                                                                        |
| `cli-core.ts`                  | `startCliCore()`: the shell — argument parsing, settings reads, product assembly, mode dispatch                                                          |
| `index.ts`                     | Package exports                                                                                                                                          |
| `bootstrap-diagnostics.ts`     | Routes agent-core diagnostics (warnings and errors) to stderr                                                                                            |
| `process-guards.ts`            | TUI-only last-resort guards that report uncaught errors into the live session instead of exiting                                                         |
| `print-terminal.ts`            | `PrintTerminal`, the `ITerminalOutput` used outside the TUI                                                                                              |
| `cli-input.ts`                 | Masked raw-mode prompt used by `init` and provider setup                                                                                                 |
| `user-local-direct-command.ts` | `robota user-local …`, run without a provider                                                                                                            |
| `constants.ts`                 | `AGENT_CLI_BIN` (`'robota'`)                                                                                                                             |

### Directories

| Directory            | Role                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product/`           | Robota's identity as data: the product profile (`robota-profile.ts`), transport and runtime plumbing (`robota-plumbing.ts`), packs and the subagent runner (`robota-subagent-composition.ts`), and robota's paths, settings layers, roots, presets, sandbox and permission baseline |
| `startup/`           | Startup steps called by `cli-core.ts`: command setup, preset selection, provider setup, workspace trust, MCP client composition, `doctor`, host-action adapters, and the inputs the TUI is rendered with                                                                            |
| `modes/`             | Print mode (`-p`, `--goal`), the `--serve` runtime host with its monitor UI and session directory, and `robota mcp serve`                                                                                                                                                           |
| `session-inventory/` | `session list`, `view`, `attach`, `start` and the per-workspace `daemon`: supervised background sessions                                                                                                                                                                            |
| `remote-control/`    | `/remote-control` over WebRTC, the host identity, and local peer discovery and messaging                                                                                                                                                                                            |
| `devices/`           | `/devices`: device identity, enrollment and the device mesh                                                                                                                                                                                                                         |
| `handoff/`           | Moving a session to another session or device                                                                                                                                                                                                                                       |
| `peer-files/`        | Files sent between peers: checks before sending, consent and quarantine on receipt                                                                                                                                                                                                  |
| `external-events/`   | External-event grants and their HTTP endpoint for the TUI                                                                                                                                                                                                                           |
| `credentials/`       | The host credential store: OS keychain, or an owner-only file                                                                                                                                                                                                                       |
| `subagents/`         | `GitWorktreeIsolationAdapter` and the self-fork worker entry (see [`subagent-wiring.md`](subagent-wiring.md))                                                                                                                                                                       |
| `plugins/`           | The `ICommandPluginAdapter` implementation and the plugin command-source loader                                                                                                                                                                                                     |
| `launch-intent/`     | `robota open <url>` deep links                                                                                                                                                                                                                                                      |
| `telemetry/`         | Opt-in live telemetry export (OTLP or console)                                                                                                                                                                                                                                      |
| `usage/`             | `robota usage`, `usage export`, and the usage reporters the transports serve                                                                                                                                                                                                        |
| `init/`              | `robota init`                                                                                                                                                                                                                                                                       |
| `eval/`              | `robota eval`                                                                                                                                                                                                                                                                       |
| `session-analyzer/`  | `robota session analyze`                                                                                                                                                                                                                                                            |
| `update-check/`      | The npm update check and its cache                                                                                                                                                                                                                                                  |
| `testing/`           | `createBinaryAgentDriver()`, which drives the built binary in the `*.bintest.ts` suites                                                                                                                                                                                             |
| `utils/`             | Argument parsing (`parseCliArgs`), help text, MCP HTTP flags                                                                                                                                                                                                                        |

### Where a command is dispatched

`startCliCore()` settles an invocation in this order:

1. `robota open <url>` is applied before anything reads the working directory.
2. `runPreparsedCliCommand()` (`startup/preparsed-command-routing.ts`) handles the subcommands whose
   flags the strict global parser would reject: `doctor` (aliases `checkup`, `diagnose`), `trust`,
   `daemon`, `--attach`, `session list|view|attach|start|stop|rename|events|link-pr|unlink-pr|analyze`,
   `usage`, `mcp login|logout` and `eval`.
3. After `parseCliArgs()`: `--help`, `--version`, `--check-update`, `--reset` and `user-local`.
4. After the command setup: `routeProjectSetup()` handles `init`, `--configure` and the
   provider-configuration flags, and makes sure a usable provider is configured.
5. Mode dispatch: print mode, `mcp serve`, `--serve`, or the TUI. Before `renderApp()` the TUI path
   warns about macOS Terminal.app and shows the first-run welcome.

## Key Flows

Not applicable — this file describes layout. Startup order is in
[`composition.md`](composition.md).

## Test Approach

No test pins the layout. Tests sit beside the code in `__tests__/` folders, and
`src/__tests__/` holds the cross-cutting startup, composition and boundary tests.
