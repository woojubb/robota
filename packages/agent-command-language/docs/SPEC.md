# @robota-sdk/agent-command-language SPEC

## Purpose

Own the user-visible `/language` command as a composable command module. The package supplies command metadata and execution together, while consuming SDK command common APIs as an external module.

## Ownership

- Owns `/language` descriptor metadata, recommended language subcommands, argument parsing, and effect production.
- Does not own settings file I/O, restart orchestration, or TUI rendering.
- Uses `@robota-sdk/agent-sdk` command contracts and language command common APIs.

## Public API

| Export                          | Purpose                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `createLanguageCommandModule()` | Create the command module for product composition roots. |
| `createLanguageCommandEntry()`  | Create descriptor metadata for `/language`.              |
| `executeLanguageCommand()`      | Execute `/language` against `ICommandHostContext`.       |
| `LanguageCommandSource`         | Command source used for slash palette metadata.          |

## Behavior

- `/language` with no argument returns usage.
- `/language <code>` returns a typed `language-change-requested` effect.
- `ko`, `en`, `ja`, and `zh` are exposed as recommended subcommands.
- Settings persistence and process restart remain host-applied effect behavior.

## Dependency Rules

- May import `@robota-sdk/agent-sdk`.
- Must not import `@robota-sdk/agent-cli`.
- Must not write settings files directly.

## Test Plan

- Module metadata and descriptor subcommands.
- Missing argument usage.
- Language change effect payload.
