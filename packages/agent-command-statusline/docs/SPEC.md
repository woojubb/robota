# @robota-sdk/agent-command-statusline SPEC

## Purpose

Own the user-visible `/statusline` command as a composable command module. The package supplies command metadata and execution together, while consuming SDK statusline command common APIs as an external module.

## Ownership

- Owns `/statusline` descriptor metadata and command execution.
- Does not own status bar rendering, settings file I/O, or TUI state updates.
- Emits SDK `statusline-settings-patch` effects for host application.
- Uses `@robota-sdk/agent-sdk` command contracts and statusline command common APIs.

## Public API

| Export                            | Purpose                                                  |
| --------------------------------- | -------------------------------------------------------- |
| `createStatusLineCommandModule()` | Create the command module for product composition roots. |
| `createStatusLineCommandEntry()`  | Create descriptor metadata for `/statusline`.            |
| `executeStatusLineCommand()`      | Execute `/statusline` against `ICommandHostContext`.     |
| `StatusLineCommandSource`         | Command source used for slash palette metadata.          |

## Behavior

- `/statusline on` requests `enabled=true`.
- `/statusline off` requests `enabled=false`.
- `/statusline reset` requests default status line fields.
- `/statusline git on` requests `gitBranch=true`.
- `/statusline git off` requests `gitBranch=false`.
- Unsupported arguments return usage text without effects.
- The command is user-invocable and not model-invocable.

## Dependency Rules

- May import `@robota-sdk/agent-sdk`.
- Must not import `@robota-sdk/agent-cli`.
- Must not read or write settings directly.
- Must not render status bar output directly.
- Git/statusline context fields must follow
  [../../../.agents/specs/repository-situational-awareness.md](../../../.agents/specs/repository-situational-awareness.md):
  they may surface bounded SDK/host-adapter projections such as branch or dirty summary, but must
  not infer commands, package managers, readiness, or setup profiles.

## Test Plan

- Module metadata and user-only descriptor policy.
- All supported subcommands and emitted effect patches.
- Unsupported argument usage result.
