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
- Argument hint: `storage list [--format json]`

## Behavior

- `user-local storage list --format json` prints the effective user-local root and stable category
  summaries using SDK projections.
- Storage inspection is provider-free and must run before provider setup is required.
- The command must not create or reuse repository-local `.robota/` baseline workflow state.
- The command must not expose stored command strings as reusable execution preferences.

## Boundary Rules

- This package must not import `agent-cli` or TUI code.
- This package must not inspect or assemble storage paths directly; it calls SDK user-local APIs.
- CLI direct invocation may call this package's direct execution helper before provider setup.
- Future memory inspection/delete/disable behavior must stay in this package while persistence
  semantics remain in SDK user-local APIs.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-user-local build
pnpm --filter @robota-sdk/agent-command-user-local test
pnpm --filter @robota-sdk/agent-command-user-local typecheck
pnpm --filter @robota-sdk/agent-command-user-local lint
```
