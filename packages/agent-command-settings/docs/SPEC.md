# agent-command-settings Specification

## Scope

Provides the `/settings` built-in command module for Robota sessions. When invoked, emits a
`settings-tui-requested` effect that the CLI renders as an interactive transport settings overlay.

## Boundaries

- Owns the `/settings` command definition and its `ICommandModule` factory.
- Does not own the TUI rendering — that belongs to `agent-cli`.
- Does not own `TransportRegistry` or settings I/O — those belong to `agent-cli`.
- Does not own the `settings-tui-requested` effect type — that belongs to `agent-sdk/command-api/effects.ts`.

## Public API Surface

| Export                        | Kind     | Description                                  |
| ----------------------------- | -------- | -------------------------------------------- |
| `createSettingsCommandModule` | Function | Factory for the `/settings` ICommandModule   |
| `createSettingsCommandEntry`  | Function | Factory for the ICommand descriptor entry    |
| `SettingsCommandSource`       | Class    | ICommandSource exposing the settings command |

## Command Contract

- **Name:** `settings`
- **User invocable:** yes
- **Model invocable:** no
- **Effect emitted:** `{ type: 'settings-tui-requested' }`
- **Lifecycle:** `inline` (no long-running side effects in the command itself)
