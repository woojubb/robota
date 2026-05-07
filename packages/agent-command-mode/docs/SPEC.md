# @robota-sdk/agent-command-mode SPEC

## Purpose

Own the legacy `/mode` command as an optional composable command module. The package supplies command metadata and execution together, while consuming SDK command common APIs as an external module. The default Robota CLI composition does not include this module; `/permissions` is the canonical permission-mode command.

## Ownership

- Owns optional `/mode` descriptor metadata, permission-mode subcommands, validation, and execution.
- Does not own permission storage, TUI rendering, or direct session internals.
- Uses `@robota-sdk/agent-sdk` command contracts and permission mode common APIs.

## Public API

| Export                      | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `createModeCommandModule()` | Create the command module for product composition roots. |
| `createModeCommandEntry()`  | Create descriptor metadata for `/mode`.                  |
| `executeModeCommand()`      | Execute `/mode` against `ICommandHostContext`.           |
| `ModeCommandSource`         | Command source used for slash palette metadata.          |

## Behavior

- `/mode` with no argument reports the current permission mode.
- `/mode plan`, `/mode default`, `/mode acceptEdits`, and `/mode bypassPermissions` update the permission mode.
- Invalid arguments fail with the SDK common valid-mode list.
- The command is user-invocable and not model-invocable when an application explicitly composes the module.
- Product CLIs should prefer `/permissions [mode]` and avoid composing `/mode` as a visible default command.

## Dependency Rules

- May import `@robota-sdk/agent-sdk`.
- Must not import `@robota-sdk/agent-cli`.
- Must not duplicate permission-mode constants owned by the SDK command API.

## Test Plan

- Module metadata and descriptor subcommands.
- Current mode display.
- Valid mode updates.
- Invalid mode rejection.
