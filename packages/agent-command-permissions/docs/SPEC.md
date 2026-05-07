# @robota-sdk/agent-command-permissions SPEC

## Purpose

Own the user-visible `/permissions` command as a composable command module. The package supplies command metadata and execution together, while consuming SDK permission command common APIs as an external module. `/permissions` is the canonical command for viewing permission state and changing permission mode.

## Ownership

- Owns `/permissions` descriptor metadata, permission-mode subcommands, validation, and execution.
- Does not own permission storage, permission prompts, TUI rendering, or direct session internals.
- Uses `@robota-sdk/agent-sdk` command contracts and permission command common APIs.

## Public API

| Export                             | Purpose                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| `createPermissionsCommandModule()` | Create the command module for product composition roots. |
| `createPermissionsCommandEntry()`  | Create descriptor metadata for `/permissions`.           |
| `executePermissionsCommand()`      | Execute `/permissions` against `ICommandHostContext`.    |
| `PermissionsCommandSource`         | Command source used for slash palette metadata.          |

## Behavior

- `/permissions` reports the current permission mode.
- `/permissions plan`, `/permissions default`, `/permissions acceptEdits`, and `/permissions bypassPermissions` update the permission mode.
- Invalid arguments fail with the SDK common valid-mode list.
- `/permissions` reports session-approved tools when present.
- `/permissions` reports that there are no session-approved tools when the session allowlist is empty.
- The command is user-invocable and not model-invocable.

## Dependency Rules

- May import `@robota-sdk/agent-sdk`.
- Must not import `@robota-sdk/agent-cli`.
- Must not duplicate permission-state formatting or permission-mode constants owned by the SDK command API.

## Test Plan

- Module metadata and user-only descriptor policy.
- Descriptor subcommands.
- Empty session-approved tool list.
- Non-empty session-approved tool list.
- Valid mode updates.
- Invalid mode rejection.
