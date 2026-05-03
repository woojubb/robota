# SPEC.md - @robota-sdk/agent-command-session

## Purpose

`@robota-sdk/agent-command-session` owns composable session-management commands.

The package currently provides `/clear`, `/rename`, and `/resume` command metadata and execution. It is the intended owner for additional session commands that share the same command-facing session APIs.

## Public API

```ts
import {
  SessionCommandSource,
  createClearCommandEntry,
  createRenameCommandEntry,
  createResumeCommandEntry,
  createSessionCommandModule,
  executeClearCommand,
  executeRenameCommand,
  executeResumeCommand,
} from '@robota-sdk/agent-command-session';
```

## Ownership

- Owns `/clear` command metadata and execution.
- Owns `/rename` command metadata and execution.
- Owns `/resume` command metadata and execution.
- Consumes `@robota-sdk/agent-sdk` command contracts and session command common APIs.
- Emits typed host effects when a command requires host-rendered state updates.
- Leaves TUI history projection, process control, settings files, and session picker rendering to the host.

## Non-Goals

- Does not import `agent-cli` or TUI code.
- Does not mutate host settings files directly.
- Does not implement checkpoint/rewind behavior.
- Does not own provider or model selection.

## Command Contract

`createSessionCommandModule()` returns one `ICommandModule` with:

- a command source containing `/clear`, `/rename`, and `/resume`;
- one executable `ISystemCommand` for `/clear`;
- one executable `ISystemCommand` for `/rename`;
- one executable `ISystemCommand` for `/resume`;
- inline lifecycle behavior;
- user-only invocation policy.

`/clear` clears the SDK session history through the SDK session command API and emits `conversation-history-cleared` so hosts can clear rendered history consistently before showing the command result.

`/rename <name>` trims the provided name and emits `session-renamed` so hosts can update session title, status bar, and persistence through their own UI adapters. Missing names return `Usage: rename <name>` without emitting effects.

`/resume` emits `session-picker-requested` so hosts can show their own saved-session picker. It does not read session files or render picker UI.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-session test
pnpm --filter @robota-sdk/agent-command-session typecheck
pnpm --filter @robota-sdk/agent-command-session build
```
