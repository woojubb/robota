# @robota-sdk/agent-interface-command

The command contracts of the Robota SDK: what a slash command is, what it returns, how it is listed
to a surface and to the model, who runs it (the session's runtime or the client the user types
into), and the ports a command host exposes for skills, plugins and themes.

The package contains type declarations only, with no classes and no runtime code. It declares what
a command is; it decides nothing about what any command does. Its only dependency is
`@robota-sdk/agent-core`, for a few shared value types.

## Installation

```bash
npm install @robota-sdk/agent-interface-command
```

## Usage

A command module offers its commands through an `ICommandSource`:

```ts
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

const greet: ICommand = {
  name: 'greet',
  description: 'Say hello to someone',
  source: 'greeting',
  argumentHint: '<name>',
  modelInvocable: false,
  safety: 'read-only',
};

export const greetingCommands: ICommandSource = {
  name: 'greeting',
  getCommands: () => [greet],
};
```

A surface that runs a command gets back an `ICommandResult` and renders it:

```ts
import type { ICommandResult, TCommandUiIntent } from '@robota-sdk/agent-interface-command';

function showResult(result: ICommandResult, open: (intent: TCommandUiIntent) => void): string {
  for (const intent of result.uiIntents ?? []) open(intent); // e.g. { type: 'show-settings' }
  return result.success ? result.message : `Error: ${result.message}`;
}
```

## What it defines

| Area                       | Main types                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands                   | `ICommand`, `ICommandSource`, `TCommandInvocationSource`, `TCommandRunner`, `TCommandSurface`                                                                                            |
| Results                    | `ICommandResult`, `TCommandResultDataValue`, `TCommandHostAction` (applied by the session before the result returns), `TCommandUiIntent` (rendered by the surface that sent the command) |
| Listings                   | `ICommandListEntry`, `ICommandSubcommandEntry`, `ICommandSkillListEntry`                                                                                                                 |
| Capability descriptors     | `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety` — what the model is told about a command, skill, agent or tool                                                           |
| Skills                     | `ISkillExecutionPort`, `ISkillResolutionResult`                                                                                                                                          |
| Plugins                    | `ICommandPluginAdapter`, `ICommandInstalledPlugin`, `ICommandAvailablePlugin`, `ICommandMarketplaceSource`, `ICommandPluginReloadResult`, `TPluginInstallScope`                          |
| Status line and appearance | `IStatusLineCommandSettings`, `IAppearanceSettings`, their `T…Patch` types, `TReducedMotionOverride`                                                                                     |
| Theme catalogue            | `IThemeCataloguePort`, `IThemeCatalogueEntry`, `IThemeAppearanceState`                                                                                                                   |

`ICommandListEntry.modelInvocable` and `runner` are required, so a surface never has to guess
whether a missing value means "no" or "not stated".

## Where it sits

- Depends on `@robota-sdk/agent-core` (types only) and on no other `agent-interface-*` package.
- `@robota-sdk/agent-command` implements the built-in command modules as `ICommandSource`s;
  `@robota-sdk/agent-framework` owns the command registry, the model-facing capability
  descriptors, and the `ISkillExecutionPort` implementation.
- `@robota-sdk/agent-ui-terminal` implements `IThemeCataloguePort` (`createThemeCataloguePort`),
  which the `/theme` command reads; the reference CLI, `@robota-sdk/agent-cli`, supplies the
  `ICommandPluginAdapter` that the `/plugin` command drives.
- `@robota-sdk/agent-interface-session` names these types in the session contract;
  `@robota-sdk/agent-transport`, `@robota-sdk/agent-ui-terminal` and `@robota-sdk/agent-ui-web` use
  them to list commands and render results. The DAG skill node consumes `ISkillExecutionPort`.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the contract, the boundaries, and the layering decisions.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
