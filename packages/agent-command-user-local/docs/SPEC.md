# SPEC.md - @robota-sdk/agent-command-user-local

## Purpose

`@robota-sdk/agent-command-user-local` owns provider-free `user-local` command behavior for
inspecting Robota user-local state through SDK-owned contracts.

## Ownership

- Owns `user-local` command metadata, argument parsing, output formatting, and provider-free direct
  CLI command execution helpers.
- Consumes user-local storage and memory APIs from `@robota-sdk/agent-sdk`.
- Does not resolve storage roots, validate repo-outside paths, persist user-local items, read
  provider configuration, or render TUI screens.

## Public API

```ts
import {
  createUserLocalCommandModule,
  executeUserLocalDirectCommand,
} from '@robota-sdk/agent-command-user-local';
```

## Command Contract

- Command name: `user-local`
- Source: `user-local`
- User invocable: yes
- Model invocable: no
- Safety: `read-only` for storage inspection
- Argument hint: `storage list [--format json] | memory set/list/inspect/disable/delete`

## Behavior

- `user-local storage list --format json` prints the effective user-local root and stable category
  summaries using SDK projections.
- `user-local memory set <category> <key> <value> --summary <summary> --source <source>` stores
  an explicit display/navigation memory item through SDK user-local APIs.
- `user-local memory list --format json` prints inspectable memory item projections.
- `user-local memory inspect <category> <key> --format json` prints one item, including
  `displayNavigationRule` and `commandExecutionEffect: "none"`.
- `user-local memory disable <category> <key>` disables an item without deleting it.
- `user-local memory delete <category> <key>` deletes an item. A follow-up inspect for that item
  returns a user-readable not-found error.
- Storage inspection is provider-free and must run before provider setup is required.
- User-local memory commands are provider-free and must run before provider setup is required.
- The command must not create or reuse repository-local `.robota/` baseline workflow state.
- The command must not expose stored command strings as reusable execution preferences.

## Boundary Rules

- This package must not import `agent-cli` or TUI code.
- This package must not inspect or assemble storage paths directly; it calls SDK user-local APIs.
- CLI direct invocation may call this package's direct execution helper before provider setup.
- User-local memory inspection/delete/disable behavior stays in this package while persistence
  semantics remain in SDK user-local APIs.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-user-local build
pnpm --filter @robota-sdk/agent-command-user-local test
pnpm --filter @robota-sdk/agent-command-user-local typecheck
pnpm --filter @robota-sdk/agent-command-user-local lint
```
