# @robota-sdk/agent-command — Package Specification

## Scope

Consolidated command module for the Robota SDK CLI. Provides all slash-command implementations as a single importable package, replacing 20 individual `agent-command-*` packages. Also provides the `default/` assembly helper (`createDefaultCommandModules`) and the `plugins/` adapter layer (`createDefaultPluginCommandAdapter`, `reloadPluginCommandSource`) for binding provider setup and plugin management to the command system.

## Boundaries

**Out of scope:**

- Transport layer (WebSocket, TUI, headless) — owned by `agent-transport` (subpaths `/ws`, `/tui`, `/headless`)
- CLI entry point and argument parsing — owned by `agent-cli`
- Agent runtime and session management — owned by `agent-core` / `agent-framework`
- Command registration contracts (`ICommandModule`, `ICommandSource`, `ISystemCommand`) — defined in `agent-framework`
- Plugin infrastructure (`BundlePluginInstaller`, `BundlePluginLoader`, `MarketplaceClient`) — defined in `agent-framework`

## Architecture Overview

Each command domain lives in its own subdirectory (`src/<command>/`) with a consistent three-file pattern:

- `<command>-command-module.ts` — creates the `ICommandModule`, `ICommandSource`, and `ISystemCommand` objects; exports named factory functions and the `<Name>CommandSource` class.
- `<command>-command.ts` — contains the `execute<Name>Command` implementation logic; depends on `ICommandHostContext` from `agent-framework`.
- `index.ts` — re-exports public symbols for the command domain.

Two cross-cutting subdirectories:

- `src/default/` — `createDefaultCommandModules` assembles all 21 standard command modules into one `readonly ICommandModule[]` array. Consumers pass `cwd`, `providerDefinitions`, `providerSettingsAdapter`, and optional `orgPolicy`.
- `src/plugins/` — provides `createDefaultPluginCommandAdapter` (wires `BundlePluginInstaller`, `BundlePluginLoader`, `MarketplaceClient` into an `ICommandPluginAdapter`) and `reloadPluginCommandSource` (synchronously reloads plugin commands into a `CommandRegistry`).

The `agent` command module sets `sessionRequirements: ['agent-runtime']`, which signals to the session layer that this module must only be registered when an agent runtime is available.

## Dependencies

```
@robota-sdk/agent-core                workspace:*   (IProviderDefinition, ITerminalOutput, IProviderSetupStepDefinition, etc.)
@robota-sdk/agent-framework           workspace:*   (ICommandModule, ICommandSource, ISystemCommand, IOrgPolicy, ICommandPluginAdapter, BundlePluginInstaller, etc.)
@robota-sdk/agent-interface-transport workspace:*   (transport-side command/list contracts)
@robota-sdk/agent-preset              workspace:*   (listPresets, getPreset, resolvePreset — used by the `/preset` command)
```

No circular dependencies. This package does not depend on any other `agent-command-*` package.

## Type Ownership

Types defined (SSOT) in this package:

| Type                             | Location                                 | Purpose                                                  |
| -------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `IDefaultCommandModulesOptions`  | `src/default/default-command-modules.ts` | Options for `createDefaultCommandModules`                |
| `ISkillsCommandModuleOptions`    | `src/skills/skills-command-module.ts`    | Options for `createSkillsCommandModule` (requires `cwd`) |
| `IProviderSetupFlowState`        | `src/provider/provider-setup-flow.ts`    | Immutable state machine for the provider setup wizard    |
| `IProviderSetupFlowOptions`      | `src/provider/provider-setup-flow.ts`    | Initial options for `createProviderSetupFlow`            |
| `IProviderSetupPromptStep`       | `src/provider/provider-setup-flow.ts`    | One step in the provider setup wizard                    |
| `TProviderSetupFlowSubmitResult` | `src/provider/provider-setup-flow.ts`    | Union result of `submitProviderSetupValue`               |
| `TProviderSetupType`             | `src/provider/provider-setup-flow.ts`    | String alias for provider type identifier                |
| `TPromptInput`                   | `src/provider/provider-setup-flow.ts`    | Callback signature for interactive text prompts          |
| `IProviderStartupContext`        | `src/provider/provider-startup.ts`       | Context passed to `runProviderStartupSetup`              |
| `IEnsureProviderConfigOptions`   | `src/provider/provider-startup.ts`       | Options for `ensureProviderConfig`                       |
| `IUserLocalDirectCommandOptions` | `src/user-local/user-local-command.ts`   | Options for `executeUserLocalDirectCommand`              |

Types re-exported from `agent-framework` (not owned here):

| Re-exported Type                  | Source package                |
| --------------------------------- | ----------------------------- |
| `IProviderCommandModuleOptions`   | `@robota-sdk/agent-framework` |
| `IProviderCommandSettingsAdapter` | `@robota-sdk/agent-framework` |

## Public API Surface

Single root entry point: `import { ... } from '@robota-sdk/agent-command'`

### Assembly helpers

| Export                              | Kind     | Description                                                                            |
| ----------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `createDefaultCommandModules`       | function | Assembles all 21 standard command modules into one array                               |
| `IDefaultCommandModulesOptions`     | type     | Options interface for `createDefaultCommandModules`                                    |
| `createDefaultPluginCommandAdapter` | function | Creates a production `ICommandPluginAdapter` wired to filesystem plugin infrastructure |
| `reloadPluginCommandSource`         | function | Synchronously reloads plugin commands into a `CommandRegistry`                         |

### Command module factories and sources

| Module      | Factory                          | Source class                 | Execute function                                                                                                                                                        |
| ----------- | -------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agent       | `createAgentCommandModule`       | `AgentCommandSource`         | `executeAgentCommand`                                                                                                                                                   |
| background  | `createBackgroundCommandModule`  | `BackgroundCommandSource`    | `executeBackgroundCommand`                                                                                                                                              |
| compact     | `createCompactCommandModule`     | `CompactCommandSource`       | `executeCompactCommand`                                                                                                                                                 |
| context     | `createContextCommandModule`     | `ContextCommandSource`       | `executeContextCommand`                                                                                                                                                 |
| exit        | `createExitCommandModule`        | `ExitCommandSource`          | `executeExitCommand`                                                                                                                                                    |
| help        | `createHelpCommandModule`        | `HelpCommandSource`          | `executeHelpCommand`                                                                                                                                                    |
| language    | `createLanguageCommandModule`    | `LanguageCommandSource`      | `executeLanguageCommand`                                                                                                                                                |
| memory      | `createMemoryCommandModule`      | `MemoryCommandSource`        | `executeMemoryCommand`                                                                                                                                                  |
| mode        | `createModeCommandModule`        | `ModeCommandSource`          | `executeModeCommand`                                                                                                                                                    |
| permissions | `createPermissionsCommandModule` | `PermissionsCommandSource`   | `executePermissionsCommand`                                                                                                                                             |
| plugin      | `createPluginCommandModule`      | `PluginManagerCommandSource` | `executePluginCommand`, `executeReloadPluginsCommand`                                                                                                                   |
| preset      | `createPresetCommandModule`      | `PresetCommandSource`        | `executePresetCommand` (the `/preset` list + live-switch command; calls `agent-preset` `listPresets`/`getPreset`/`resolvePreset` then framework `applyPresetToSession`) |
| provider    | `createProviderCommandModule`    | `ProviderCommandSource`      | `executeProviderCommand`                                                                                                                                                |
| reset       | `createResetCommandModule`       | `ResetCommandSource`         | `executeResetCommand`                                                                                                                                                   |
| rewind      | `createRewindCommandModule`      | `RewindCommandSource`        | `executeRewindCommand`                                                                                                                                                  |
| schedule    | `createScheduleCommandModule`    | `ScheduleCommandSource`      | `executeScheduleCommand`, `executeMonitorCommand` (recurring/one-shot wake + process-monitor wake; `sessionRequirements: ['agent-runtime']`)                            |
| session     | `createSessionCommandModule`     | `SessionCommandSource`       | `executeClearCommand`, `executeCostCommand`, `executeRenameCommand`, `executeResumeCommand`, `executeValidateSessionCommand`                                            |
| settings    | `createSettingsCommandModule`    | `SettingsCommandSource`      | (inline, no standalone export)                                                                                                                                          |
| skills      | `createSkillsCommandModule`      | `SkillsCommandSource`        | `executeSkillsCommand`                                                                                                                                                  |
| statusline  | `createStatusLineCommandModule`  | `StatusLineCommandSource`    | `executeStatusLineCommand`                                                                                                                                              |
| user-local  | `createUserLocalCommandModule`   | `UserLocalCommandSource`     | `executeUserLocalCommand`, `executeUserLocalDirectCommand`                                                                                                              |

### Provider setup flow (interactive UI helpers)

| Export                               | Kind     | Description                                                   |
| ------------------------------------ | -------- | ------------------------------------------------------------- |
| `createProviderSetupFlow`            | function | Creates initial `IProviderSetupFlowState`                     |
| `submitProviderSetupValue`           | function | Advances flow state; returns `TProviderSetupFlowSubmitResult` |
| `getProviderSetupStep`               | function | Returns the current step definition                           |
| `resolveProviderSetupSelection`      | function | Maps user selection string to provider type                   |
| `runProviderSetupPromptFlow`         | function | Runs the full interactive setup wizard                        |
| `formatProviderSetupSelectionPrompt` | function | Formats the provider selection prompt text                    |
| `formatProviderSetupChoiceLabel`     | function | Formats a single provider choice label                        |
| `formatProviderSetupHelpLinks`       | function | Formats help links for a provider                             |
| `formatProviderSetupPromptLabel`     | function | Formats the input prompt label for a setup step               |
| `validateProviderSetupValue`         | function | Validates a single setup step value                           |
| `ensureProviderConfig`               | function | Verifies provider config or prompts for setup                 |
| `runProviderStartupSetup`            | function | Runs full onboarding + provider setup at CLI start            |

### Command entry builders (for programmatic registration)

| Export                                   | Kind     | Description                                                                                                                                      |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createAgentCommandEntry`                | function | Returns `ICommand` metadata for the `agent` command                                                                                              |
| `createAgentSystemCommand`               | function | Returns `ISystemCommand` for the `agent` command                                                                                                 |
| `createProviderCommandEntry`             | function | Returns `ICommand` metadata for `provider`                                                                                                       |
| `createPluginCommandEntry`               | function | Returns `ICommand` metadata for `plugin`                                                                                                         |
| `createReloadPluginsCommandEntry`        | function | Returns `ICommand` metadata for `reload-plugins`                                                                                                 |
| `createSessionCommandModule` sub-entries | function | `createClearCommandEntry`, `createCostCommandEntry`, `createRenameCommandEntry`, `createResumeCommandEntry`, `createValidateSessionCommandEntry` |

### Session command constants

| Export                             | Kind     | Description                                    |
| ---------------------------------- | -------- | ---------------------------------------------- |
| `CLEAR_COMMAND_MESSAGE`            | constant | Default message inserted on session clear      |
| `SKILLS_COMMAND_DESCRIPTION`       | constant | Canonical description for the `skills` command |
| `STATUSLINE_USAGE`                 | constant | Usage text for the `statusline` command        |
| `USER_LOCAL_COMMAND_ARGUMENT_HINT` | constant | Argument hint for `user-local`                 |
| `USER_LOCAL_COMMAND_DESCRIPTION`   | constant | Description for `user-local`                   |
| `USER_LOCAL_COMMAND_USAGE`         | constant | Usage text for `user-local`                    |

## Extension Points

- **`ICommandModule`** (from `agent-framework`): every command domain creates one via its factory function. Consumers can create additional `ICommandModule` values and register them alongside the defaults.
- **`ICommandSource`** (from `agent-framework`): each `*CommandSource` class implements `ICommandSource`. The skills module pushes a second source (`SkillCommandSource` from `agent-framework`) to expose file-based skills loaded from `cwd`.
- **`ICommandPluginAdapter`** (from `agent-framework`): `createDefaultPluginCommandAdapter` returns a production implementation. Consumers may supply a different adapter (e.g., in tests) that satisfies the same interface.
- **`IProviderCommandSettingsAdapter`** (from `agent-framework`): consumers implement this interface to connect provider command operations to their settings backend.
- **`IOrgPolicy`** (from `agent-framework`): passed to `createProviderCommandModule` and `createDefaultCommandModules`; gates provider switching and API key configuration per org policy.
- **`interactionHints`** on `ICommandModule` (from `agent-framework`): optional map of `commandName → ICommandInteractionHint`. When present, the TUI layer reads the hint for a given command and opens the appropriate interaction dialog (`picker` or `confirm`) before executing the command. Command modules that require disambiguation (e.g., `/mode`, `/provider switch`) declare their hints here; the CLI does not hard-code command-specific dialog logic.

### Org-policy enforcement in `provider`

`createProviderCommandModule` accepts `orgPolicy?: IOrgPolicy`. When present:

- **`allowedProviders`**: `buildProviderSwitch` rejects `/provider switch <name>` if the target profile name is not in the list, returning `{ success: false }` with a violation message before writing settings.
- **`requireApiKeyFromEnv`**: `completeProviderEdit` rejects a completed provider setup if `input.apiKey` is a plaintext value (does not start with `$ENV:`). The check runs before `buildProviderSetupPatch` is called.
- **`adminContact`**: appended to every violation message when set.

`InteractiveSession` (in `agent-framework`) handles `blockedCommands` and the `provider-hot-swap-requested` effect for `allowedProviders` checks at the session layer.

## Error Taxonomy

This package does not define custom error classes. All execution errors surface as `ICommandResult` values with `success: false` and a human-readable `message`. Thrown errors are limited to:

| Condition                                  | Throw site                                             | Recoverable               |
| ------------------------------------------ | ------------------------------------------------------ | ------------------------- |
| `agent-runtime` capability not available   | `getAgentHostContext` in `agent-command-module.ts`     | no (session config error) |
| Plugin ID not in `name@marketplace` format | `installPlugin` in `default-plugin-command-adapter.ts` | yes (user input error)    |

The `plugins/default-plugin-command-adapter.ts` allows fallback on marketplace manifest fetch failure (non-fatal, returns empty list). This is marked `// allow-fallback` inline.

## Test Strategy

Test files: 22 (one per command module plus extras for `model-pricing`, `org-policy`, and `provider-setup-flow`).

```
src/agent/__tests__/agent-command.test.ts
src/background/__tests__/background-command-module.test.ts
src/compact/__tests__/compact-command-module.test.ts
src/context/__tests__/context-command-module.test.ts
src/exit/__tests__/exit-command-module.test.ts
src/help/__tests__/help-command-module.test.ts
src/help/__tests__/help-command.test.ts
src/language/__tests__/language-command-module.test.ts
src/memory/__tests__/memory-command-module.test.ts
src/mode/__tests__/mode-command-module.test.ts
src/permissions/__tests__/permissions-command-module.test.ts
src/plugin/__tests__/plugin-command-module.test.ts
src/provider/__tests__/org-policy.test.ts
src/provider/__tests__/provider-command-module.test.ts
src/provider/__tests__/provider-setup-flow.test.ts
src/reset/__tests__/reset-command-module.test.ts
src/rewind/__tests__/rewind-command-module.test.ts
src/session/__tests__/model-pricing.test.ts
src/session/__tests__/session-command-module.test.ts
src/skills/__tests__/skills-command-module.test.ts
src/statusline/__tests__/statusline-command-module.test.ts
src/user-local/__tests__/user-local-command.test.ts
```

Run:

```bash
pnpm --filter @robota-sdk/agent-command test
```

Coverage gaps: `src/default/` and `src/plugins/` subdirectories have no dedicated test files. Integration coverage comes from `agent-cli` and `agent-framework` tests.

## Class Contract Registry

| Class                        | Implements       | Defined In                                      |
| ---------------------------- | ---------------- | ----------------------------------------------- |
| `AgentCommandSource`         | `ICommandSource` | `src/agent/agent-command-module.ts`             |
| `BackgroundCommandSource`    | `ICommandSource` | `src/background/background-command-module.ts`   |
| `CompactCommandSource`       | `ICommandSource` | `src/compact/compact-command-module.ts`         |
| `ContextCommandSource`       | `ICommandSource` | `src/context/context-command-module.ts`         |
| `ExitCommandSource`          | `ICommandSource` | `src/exit/exit-command-module.ts`               |
| `HelpCommandSource`          | `ICommandSource` | `src/help/help-command-module.ts`               |
| `LanguageCommandSource`      | `ICommandSource` | `src/language/language-command-module.ts`       |
| `MemoryCommandSource`        | `ICommandSource` | `src/memory/memory-command-module.ts`           |
| `ModeCommandSource`          | `ICommandSource` | `src/mode/mode-command-module.ts`               |
| `PermissionsCommandSource`   | `ICommandSource` | `src/permissions/permissions-command-module.ts` |
| `PluginManagerCommandSource` | `ICommandSource` | `src/plugin/plugin-command-module.ts`           |
| `PresetCommandSource`        | `ICommandSource` | `src/preset/preset-command-module.ts`           |
| `ProviderCommandSource`      | `ICommandSource` | `src/provider/provider-command-module.ts`       |
| `ResetCommandSource`         | `ICommandSource` | `src/reset/reset-command-module.ts`             |
| `RewindCommandSource`        | `ICommandSource` | `src/rewind/rewind-command-module.ts`           |
| `ScheduleCommandSource`      | `ICommandSource` | `src/schedule/schedule-command-module.ts`       |
| `SessionCommandSource`       | `ICommandSource` | `src/session/session-command-module.ts`         |
| `SettingsCommandSource`      | `ICommandSource` | `src/settings/settings-command-module.ts`       |
| `SkillsCommandSource`        | `ICommandSource` | `src/skills/skills-command-module.ts`           |
| `StatusLineCommandSource`    | `ICommandSource` | `src/statusline/statusline-command-module.ts`   |
| `UserLocalCommandSource`     | `ICommandSource` | `src/user-local/user-local-command-module.ts`   |

## Migration

Consolidated from 20 individual per-command packages (v3.0.0-beta.63):

- the former `@robota-sdk/agent-command-<name>` packages (e.g. `<name>` = agent, background, provider, …) → all merged into `@robota-sdk/agent-command`

Consumers replace all 20 individual imports with a single dependency:

```json
"dependencies": {
  "@robota-sdk/agent-command": "workspace:*"
}
```

And update imports:

```typescript
// Before (one of the 20 former per-command packages)
import { Y } from '@robota-sdk/agent-command-<name>';

// After
import { Y } from '@robota-sdk/agent-command';
```
