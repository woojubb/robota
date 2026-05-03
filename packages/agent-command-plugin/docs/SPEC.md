# @robota-sdk/agent-command-plugin SPEC

## Status

- **Owner**: command module layer
- **Stability**: beta
- **Runtime**: Node.js

## Scope

`@robota-sdk/agent-command-plugin` owns the user-visible `/plugin` command. It packages command metadata, registry source, lifecycle policy, and execution in one injected command module.

The package is a plugin-management command owner. It consumes SDK-owned plugin command adapter APIs and returns typed host effects for UI work. It never imports CLI, TUI, React, plugin screen components, or filesystem-specific plugin wiring.

## Boundaries

- This package must not import CLI, TUI, React, process APIs, or local settings I/O.
- Plugin TUI rendering, keyboard handling, and local plugin store wiring remain host-owned.
- Plugin operations must use the SDK-owned `ICommandPluginAdapter` exposed through command host adapters.
- CLI products compose this module; CLI slash routing must not own `/plugin` behavior.
- The command must stay user-invocable only and must not be model-invocable.

## Architecture Overview

```text
createPluginCommandModule()
  ├── PluginManagerCommandSource
  │   └── createPluginCommandEntry()
  └── createPluginSystemCommand()
      └── executePluginCommand()
          ├── resolvePluginCommandAdapter()
          └── createPluginTuiRequestedEffect()
```

The module contributes one `ICommandSource` for autocomplete/palette metadata and one `ISystemCommand` for execution. The executable command declares `lifecycle: "inline"` because command work is local host adapter work and must not invoke the model.

## Type Ownership

This package does not define independent public data contracts. It consumes SDK-owned command contracts from `@robota-sdk/agent-sdk`.

| Type                    | Location                | Purpose                             |
| ----------------------- | ----------------------- | ----------------------------------- |
| `ICommandModule`        | `@robota-sdk/agent-sdk` | Command module composition contract |
| `ICommand`              | `@robota-sdk/agent-sdk` | Command palette/autocomplete entry  |
| `ISystemCommand`        | `@robota-sdk/agent-sdk` | Executable command contract         |
| `ICommandResult`        | `@robota-sdk/agent-sdk` | Command execution result            |
| `ICommandPluginAdapter` | `@robota-sdk/agent-sdk` | Host-provided plugin operations     |

## Public API

| Export                       | Kind     | Description                                                                                        |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `createPluginCommandModule`  | function | Returns an `ICommandModule` containing the `/plugin` command source and executable system command. |
| `createPluginCommandEntry`   | function | Returns the command palette entry for `/plugin`.                                                   |
| `PluginManagerCommandSource` | class    | Command source for command registry composition.                                                   |
| `executePluginCommand`       | function | Executes `/plugin` subcommands through host adapters and typed effects.                            |

## Command Contract

| Field            | Value                   |
| ---------------- | ----------------------- |
| Command          | `/plugin`               |
| Source           | `plugin-manager`        |
| Description      | `Manage plugins`        |
| User invocation  | enabled                 |
| Model invocation | disabled                |
| Lifecycle        | `inline`                |
| Effect           | `plugin-tui-requested`  |
| Adapter          | `ICommandPluginAdapter` |

Supported subcommands:

| Subcommand           | Behavior                                   |
| -------------------- | ------------------------------------------ |
| empty or `manage`    | Requests the host plugin manager UI        |
| `install <id>`       | Installs a plugin through the host adapter |
| `uninstall <id>`     | Uninstalls a plugin                        |
| `enable <id>`        | Enables a plugin                           |
| `disable <id>`       | Disables a plugin                          |
| `marketplace add`    | Adds a marketplace source                  |
| `marketplace remove` | Removes a marketplace source               |
| `marketplace update` | Updates a marketplace source               |
| `marketplace list`   | Lists configured marketplace sources       |

## Extension Points

Hosts extend behavior by implementing `ICommandPluginAdapter` in their composition root and by applying the SDK-owned `plugin-tui-requested` effect to their own UI shell.

## Error Taxonomy

This package defines no package-specific error classes. Adapter failures are reported as failed `ICommandResult` values with `Plugin error: <message>`.

## Dependencies

| Package                 | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `@robota-sdk/agent-sdk` | Command contracts, adapter APIs, and effects |

`@robota-sdk/agent-sdk` must not import this package.

## Test Strategy

| Test                                          | Purpose                                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/__tests__/plugin-command-module.test.ts` | Verifies command metadata, module composition, plugin manager effect output, adapter calls, usage, and failures. |

CLI routing tests in `@robota-sdk/agent-cli` verify that `/plugin` falls through to the injected command execution path rather than being owned by the CLI slash router.

## Class Contract Registry

| Class                        | Contract         | Notes                                                          |
| ---------------------------- | ---------------- | -------------------------------------------------------------- |
| `PluginManagerCommandSource` | `ICommandSource` | Provides the `/plugin` command entry for registry composition. |

## Verification

- Package build, typecheck, lint, and tests must pass.
- CLI tests must prove `/plugin` routes to the generic command execution path.
