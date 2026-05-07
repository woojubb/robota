# @robota-sdk/agent-command-exit SPEC

## Status

- **Owner**: command module layer
- **Stability**: beta
- **Runtime**: Node.js

## Scope

`@robota-sdk/agent-command-exit` owns the user-visible `/exit` command. It packages command metadata, registry source, lifecycle policy, and execution in one injected command module.

The package is a process-control command owner. It returns a typed host-applied shutdown effect but never exits the process itself.

## Boundaries

- This package must not import CLI, TUI, React, process APIs, or local settings I/O.
- Actual shutdown, session persistence, and process exit remain host-owned.
- The command must stay user-invocable only and must not be model-invocable.
- CLI products compose this module; CLI slash routing must not own `/exit` behavior.

## Architecture Overview

```text
createExitCommandModule()
  ├── ExitCommandSource
  │   └── createExitCommandEntry()
  └── createExitSystemCommand()
      └── executeExitCommand()
          └── createSessionExitRequestedEffect()
```

The module contributes one `ICommandSource` for autocomplete/palette metadata and one `ISystemCommand` for execution. The executable command declares `lifecycle: "inline"` because it does not call the model, perform I/O, or manage a long-running operation.

## Type Ownership

This package does not define independent public data contracts. It consumes SDK-owned command contracts from `@robota-sdk/agent-sdk`.

| Type             | Location                | Purpose                                     |
| ---------------- | ----------------------- | ------------------------------------------- |
| `ICommandModule` | `@robota-sdk/agent-sdk` | Command module composition contract         |
| `ICommand`       | `@robota-sdk/agent-sdk` | Command palette/autocomplete entry          |
| `ISystemCommand` | `@robota-sdk/agent-sdk` | Executable command contract                 |
| `ICommandResult` | `@robota-sdk/agent-sdk` | Command execution result with typed effects |

## Public API

| Export                    | Kind     | Description                                                                                      |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `createExitCommandModule` | function | Returns an `ICommandModule` containing the `/exit` command source and executable system command. |
| `createExitCommandEntry`  | function | Returns the command palette entry for `/exit`.                                                   |
| `ExitCommandSource`       | class    | Command source for command registry composition.                                                 |
| `executeExitCommand`      | function | Returns a typed `session-exit-requested` effect.                                                 |

## Command Contract

| Field            | Value                    |
| ---------------- | ------------------------ |
| Command          | `/exit`                  |
| Source           | `exit`                   |
| Description      | `Exit CLI`               |
| User invocation  | enabled                  |
| Model invocation | disabled                 |
| Lifecycle        | `inline`                 |
| Effect           | `session-exit-requested` |

## Extension Points

There are no command-specific extension points. Hosts extend behavior by applying the SDK-owned `session-exit-requested` effect through their own shutdown adapters or UI shell.

## Error Taxonomy

This package defines no package-specific error classes. The command is deterministic and returns a successful `ICommandResult`.

## Dependencies

| Package                 | Purpose                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `@robota-sdk/agent-sdk` | Command contracts, command metadata types, and session-exit effect factory |

`@robota-sdk/agent-sdk` must not import this package.

## Test Strategy

| Test                                        | Purpose                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/__tests__/exit-command-module.test.ts` | Verifies command metadata, module composition, executable command registration, and `session-exit-requested` effect output. |

CLI routing tests in `@robota-sdk/agent-cli` verify that `/exit` falls through to the injected command execution path rather than being owned by the CLI slash router.

## Class Contract Registry

| Class               | Contract         | Notes                                                        |
| ------------------- | ---------------- | ------------------------------------------------------------ |
| `ExitCommandSource` | `ICommandSource` | Provides the `/exit` command entry for registry composition. |

## Verification

- Package build, typecheck, lint, and tests must pass.
- CLI tests must prove `/exit` routes to the generic command execution path.
