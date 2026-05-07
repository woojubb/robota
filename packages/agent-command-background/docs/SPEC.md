# @robota-sdk/agent-command-background SPEC

## Status

- **Owner**: command module layer
- **Stability**: beta
- **Runtime**: Node.js

## Purpose

`@robota-sdk/agent-command-background` owns the user-visible `/background` command. It packages metadata, autocomplete subcommands, lifecycle policy, and execution in one injected command module.

## Public API

- `createBackgroundCommandModule()`: returns an `ICommandModule` containing the `/background` command source and executable system command.
- `createBackgroundCommandEntry()`: returns the command palette entry for `/background`.
- `BackgroundCommandSource`: command source for command registry composition.
- `executeBackgroundCommand(context, args)`: executes `/background` against SDK command host context APIs.

## Command Behavior

Supported forms:

- `/background list`: list current background tasks.
- `/background read <task-id> [offset]`: read a log page.
- `/background cancel <task-id> [reason]`: cancel a task.
- `/background close <task-id>`: dismiss a terminal task.

Aliases:

- `read`: `log`, `open`
- `cancel`: `stop`
- `close`: `dismiss`

## Boundaries

- This package must not import CLI, TUI, React, or local settings I/O.
- Background task state remains SDK/runtime owned.
- This package must consume SDK command-facing APIs through `@robota-sdk/agent-sdk`.
- CLI products compose this module; SDK core must not embed `/background` registration or execution.

## Dependencies

- Depends on `@robota-sdk/agent-sdk`.
- Must not be imported by `@robota-sdk/agent-sdk`.

## Verification

- Package build, typecheck, lint, and tests must pass.
- SDK command API tests must prove background common APIs are exposed without importing this command implementation.
- CLI composition tests must prove `/background` is provided as an injected command module.
