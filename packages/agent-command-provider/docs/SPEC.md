# SPEC.md — @robota-sdk/agent-command-provider

## Package Scope

`@robota-sdk/agent-command-provider` owns the composable `/provider` command module.

This package:

- exports a command module compatible with `@robota-sdk/agent-sdk`'s `ICommandModule` interface;
- owns `/provider` command palette metadata;
- owns `/provider` system command parsing and execution;
- consumes SDK provider common APIs for settings documents, setup-flow primitives, environment references, and profile probing.

This package does not own:

- provider construction or provider default definitions;
- settings file paths or concrete settings I/O;
- `InteractiveSession` lifecycle;
- TUI rendering or prompt components.

## Public API

```ts
import { createProviderCommandModule } from '@robota-sdk/agent-command-provider';
```

| Symbol                        | Kind     | Description                                          |
| ----------------------------- | -------- | ---------------------------------------------------- |
| `createProviderCommandModule` | function | Returns an `ICommandModule` for `/provider` support  |
| `createProviderCommandEntry`  | function | Returns command palette metadata for `/provider`     |
| `executeProviderCommand`      | function | Executes provider command arguments against adapters |
| `ProviderCommandSource`       | class    | Supplies slash palette metadata for `/provider`      |

## Composition Contract

Hosts compose this package by injecting provider definitions and a settings adapter.

```ts
const providerCommandModule = createProviderCommandModule({
  providerDefinitions,
  settings: {
    readMergedSettings,
    readTargetSettings,
    writeTargetSettings,
  },
});
```

The host owns provider definition selection and settings persistence. The command module owns command semantics and returns generic SDK command interactions/effects. Host UIs render those interactions and apply typed effects without importing provider setup logic.

## Command Behavior

| Command                    | Behavior                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/provider`                | Show current provider and subcommands                                                                                                                          |
| `/provider current`        | Show active profile, type, model, and baseURL                                                                                                                  |
| `/provider list`           | Show provider profiles from merged settings                                                                                                                    |
| `/provider use <profile>`  | Confirm, persist `currentProvider` through the injected settings adapter target that will win on next startup, and return a `session-restart-requested` effect |
| `/provider add`            | Start setup without a selected type and return a generic choice interaction generated from injected provider definitions                                       |
| `/provider add <type>`     | Start setup for the selected provider type                                                                                                                     |
| `/provider test [profile]` | Validate fields and optionally probe the endpoint through SDK provider common APIs                                                                             |

Provider setup owns defaults, required-field validation, environment-reference validation, masked-field metadata, settings patch construction, and restart effect emission. The command package does not choose settings file paths; the host adapter must expose the correct target document for the effective settings scope.

## Class Contract Registry

| Class/Function                | Implements/Uses                 | Notes                                      |
| ----------------------------- | ------------------------------- | ------------------------------------------ |
| `ProviderCommandSource`       | `ICommandSource`                | Supplies slash palette metadata            |
| `createProviderSystemCommand` | `ISystemCommand`                | Supplies executable command handler        |
| `createProviderCommandModule` | `ICommandModule`                | Composes source and command handler        |
| `executeProviderCommand`      | SDK provider command common API | Parses subcommands and builds interactions |

## Dependencies

| Package                  | Purpose                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `@robota-sdk/agent-core` | Provider definition lookup and supported-provider formatting           |
| `@robota-sdk/agent-sdk`  | Command contracts plus provider common APIs and profile probe defaults |

No dependency from `agent-sdk` or reusable CLI/TUI internals back into this package is allowed. Product composition roots such as the Robota CLI binary may import this package to make `/provider` available.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-provider test
pnpm --filter @robota-sdk/agent-command-provider typecheck
pnpm --filter @robota-sdk/agent-command-provider build
```
