# @robota-sdk/agent-command-help SPEC

## Status

- **Owner**: command module layer
- **Stability**: beta
- **Runtime**: Node.js

## Scope

`@robota-sdk/agent-command-help` owns the user-visible `/help` command. It packages command metadata, registry source, lifecycle policy, and execution in one injected command module.

The package consumes SDK-owned command listing and help formatting APIs. It does not own command registry infrastructure or any host UI rendering.

## Boundaries

- This package must not import CLI, TUI, React, process APIs, or local settings I/O.
- Command registry storage and session composition remain SDK-owned.
- CLI products compose this module; CLI slash routing must not own `/help` behavior.
- The command must stay user-invocable only and must not be model-invocable.

## Architecture Overview

```text
createHelpCommandModule()
  ├── HelpCommandSource
  │   └── createHelpCommandEntry()
  └── createHelpSystemCommand()
      └── executeHelpCommand()
          └── formatCommandHelpMessage(context)
```

The module contributes one `ICommandSource` for autocomplete/palette metadata and one executable `ISystemCommand`. The executable command declares `lifecycle: "inline"` because it only reads registered command descriptors.

## Type Ownership

This package does not define independent public data contracts. It consumes SDK-owned command contracts from `@robota-sdk/agent-sdk`.

| Type                  | Location                | Purpose                             |
| --------------------- | ----------------------- | ----------------------------------- |
| `ICommandModule`      | `@robota-sdk/agent-sdk` | Command module composition contract |
| `ICommand`            | `@robota-sdk/agent-sdk` | Command palette/autocomplete entry  |
| `ICommandSource`      | `@robota-sdk/agent-sdk` | Command source contract             |
| `ISystemCommand`      | `@robota-sdk/agent-sdk` | Executable command contract         |
| `ICommandHostContext` | `@robota-sdk/agent-sdk` | Host context used to list commands  |

## Public API Surface

| Export                    | Kind     | Description                                                               |
| ------------------------- | -------- | ------------------------------------------------------------------------- |
| `createHelpCommandModule` | function | Returns an `ICommandModule` containing `/help` metadata and execution.    |
| `createHelpCommandEntry`  | function | Returns the command palette entry for `/help`.                            |
| `HelpCommandSource`       | class    | Command source for command registry composition.                          |
| `executeHelpCommand`      | function | Renders registered commands by consuming SDK command help formatting API. |

## Command Contract

| Field            | Value                     |
| ---------------- | ------------------------- |
| Command          | `/help`                   |
| Source           | `help`                    |
| Description      | `Show available commands` |
| User invocation  | enabled                   |
| Model invocation | disabled                  |
| Lifecycle        | `inline`                  |

The output must start with `Available commands:` and then render the command list supplied by `ICommandHostContext.listCommands()`.

## Extension Points

Hosts extend the displayed command list by composing additional `ICommandModule` values into the SDK session and registry. This package does not provide host adapters.

## Error Taxonomy

This package defines no package-specific error classes.

## Dependencies

| Package                 | Purpose                              |
| ----------------------- | ------------------------------------ |
| `@robota-sdk/agent-sdk` | Command contracts and help formatter |

`@robota-sdk/agent-sdk` must not import this package.

## Test Strategy

| Test                                        | Purpose                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `src/__tests__/help-command-module.test.ts` | Verifies command metadata, module composition, and composed help output. |

CLI routing tests in `@robota-sdk/agent-cli` verify that `/help` falls through to injected command execution rather than being owned by the CLI slash router.

## Class Contract Registry

| Class               | Contract         | Notes                                           |
| ------------------- | ---------------- | ----------------------------------------------- |
| `HelpCommandSource` | `ICommandSource` | Provides `/help` command entry for composition. |

## Verification

- Package build, typecheck, lint, and tests must pass.
- SDK command API tests must prove help formatting is exposed without importing this command implementation.
- CLI tests must prove `/help` routes to the generic command execution path.
