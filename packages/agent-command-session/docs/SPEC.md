# SPEC.md - @robota-sdk/agent-command-session

## Purpose

`@robota-sdk/agent-command-session` owns composable session-management commands.

The package currently provides `/clear` and `/rename` command metadata and execution. It is the intended owner for additional session commands that share the same command-facing session APIs, such as session picker commands.

## Public API

```ts
import {
  SessionCommandSource,
  createClearCommandEntry,
  createRenameCommandEntry,
  createSessionCommandModule,
  executeClearCommand,
  executeRenameCommand,
} from '@robota-sdk/agent-command-session';
```

## Ownership

- Owns `/clear` command metadata and execution.
- Owns `/rename` command metadata and execution.
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

- a command source containing `/clear` and `/rename`;
- one executable `ISystemCommand` for `/clear`;
- one executable `ISystemCommand` for `/rename`;
- inline lifecycle behavior;
- user-only invocation policy.

`/clear` clears the SDK session history through the SDK session command API and emits `conversation-history-cleared` so hosts can clear rendered history consistently before showing the command result.

`/rename <name>` trims the provided name and emits `session-renamed` so hosts can update session title, status bar, and persistence through their own UI adapters. Missing names return `Usage: rename <name>` without emitting effects.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-session test
pnpm --filter @robota-sdk/agent-command-session typecheck
pnpm --filter @robota-sdk/agent-command-session build
```
