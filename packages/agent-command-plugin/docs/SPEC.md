# @robota-sdk/agent-command-plugin SPEC

## Status

- **Owner**: command module layer
- **Stability**: beta
- **Runtime**: Node.js

## Scope

`@robota-sdk/agent-command-plugin` owns the user-visible `/plugin` and `/reload-plugins` commands. It packages command metadata, registry source, lifecycle policy, and execution in one injected command module.

The package is a plugin-management command owner. It consumes SDK-owned plugin command adapter APIs and returns typed host effects for UI work. It never imports CLI, TUI, React, plugin screen components, or filesystem-specific plugin wiring.

## Boundaries

- This package must not import CLI, TUI, React, process APIs, or local settings I/O.
- Plugin TUI rendering, keyboard handling, and local plugin store wiring remain host-owned.
- Plugin operations must use the SDK-owned `ICommandPluginAdapter` exposed through command host adapters.
- CLI products compose this module; CLI slash routing must not own `/plugin` or `/reload-plugins` behavior.
- The command must stay user-invocable only and must not be model-invocable.

## Architecture Overview

```text
createPluginCommandModule()
  ├── PluginManagerCommandSource
  │   ├── createPluginCommandEntry()
  │   └── createReloadPluginsCommandEntry()
  ├── createPluginSystemCommand()
  │   └── executePluginCommand()
  │       ├── resolvePluginCommandAdapter()
  │       └── createPluginTuiRequestedEffect()
  └── createReloadPluginsSystemCommand()
      └── executeReloadPluginsCommand()
          ├── ICommandPluginAdapter.reloadPlugins()
          └── createPluginRegistryReloadRequestedEffect()
```

The module contributes one `ICommandSource` for autocomplete/palette metadata and executable `ISystemCommand` entries for plugin management. The executable commands declare `lifecycle: "inline"` because command work is local host adapter work and must not invoke the model.

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

| Export                            | Kind     | Description                                                                                   |
| --------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `createPluginCommandModule`       | function | Returns an `ICommandModule` containing plugin command sources and executable system commands. |
| `createPluginCommandEntry`        | function | Returns the command palette entry for `/plugin`.                                              |
| `createReloadPluginsCommandEntry` | function | Returns the command palette entry for `/reload-plugins`.                                      |
| `PluginManagerCommandSource`      | class    | Command source for command registry composition.                                              |
| `executePluginCommand`            | function | Executes `/plugin` subcommands through host adapters and typed effects.                       |
| `executeReloadPluginsCommand`     | function | Executes `/reload-plugins` through the host adapter and requests registry refresh.            |

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

| Field            | Value                              |
| ---------------- | ---------------------------------- |
| Command          | `/reload-plugins`                  |
| Source           | `plugin-manager`                   |
| Description      | `Reload all plugin resources`      |
| User invocation  | enabled                            |
| Model invocation | disabled                           |
| Lifecycle        | `inline`                           |
| Effect           | `plugin-registry-reload-requested` |
| Adapter          | `ICommandPluginAdapter`            |

`/reload-plugins` must call `ICommandPluginAdapter.reloadPlugins()` and must fail if the adapter reports a reload error. It must not return a placeholder success without exercising the host plugin loader.

## Extension Points

Hosts extend behavior by implementing `ICommandPluginAdapter` in their composition root and by applying SDK-owned effects to their own UI shell. `plugin-tui-requested` opens host plugin management UI. `plugin-registry-reload-requested` refreshes host command registry plugin sources after a successful reload.

## Error Taxonomy

This package defines no package-specific error classes. Adapter failures are reported as failed `ICommandResult` values with `Plugin error: <message>`.

## Dependencies

| Package                 | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `@robota-sdk/agent-sdk` | Command contracts, adapter APIs, and effects |

`@robota-sdk/agent-sdk` must not import this package.

## Test Strategy

| Test                                          | Purpose                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/__tests__/plugin-command-module.test.ts` | Verifies command metadata, module composition, plugin manager/reload effects, adapter calls, usage, and failures. |

CLI routing tests in `@robota-sdk/agent-cli` verify that `/plugin` and `/reload-plugins` fall through to the injected command execution path rather than being owned by the CLI slash router.

## Class Contract Registry

| Class                        | Contract         | Notes                                                                              |
| ---------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `PluginManagerCommandSource` | `ICommandSource` | Provides `/plugin` and `/reload-plugins` command entries for registry composition. |

## Verification

- Package build, typecheck, lint, and tests must pass.
- CLI tests must prove plugin commands route to the generic command execution path.
