# CLI Permissions Command Owns Permission Mode Setting

## Status

Completed.

## Created

2026-05-06

## Priority

P1 - command naming clarity and permission UX cleanup.

## Problem

The CLI currently splits permission behavior across two slash commands:

- `/permissions` shows permission state and session allow rules.
- `/mode [mode]` shows or changes the permission mode.

This split is confusing because `mode` reads like a generic model/provider behavior mode, such as
fast/smart/quality mode, while the command actually changes permission policy. Users reasonably
expect permission configuration to live under `/permissions`, not `/mode`.

## Current Code Confirmation

- `packages/agent-command-mode/src/mode-command.ts` parses permission-mode args and calls
  `writeCommandPermissionMode(context, arg)`.
- `packages/agent-command-mode/src/mode-command-module.ts` exposes `/mode` with permission-mode
  subcommands.
- `packages/agent-command-permissions/src/permissions-command.ts` currently ignores args and only
  returns `formatCommandPermissionsMessage(readCommandPermissionsState(context))`.
- `packages/agent-command-permissions/src/permissions-command-module.ts` exposes `/permissions`
  without subcommands.
- `packages/agent-cli/docs/SPEC.md` documents `/mode [mode]` as show/change permission mode and
  `/permissions` as permission rules.

## Scope

- `packages/agent-command-permissions/src/permissions-command.ts`
- `packages/agent-command-permissions/src/permissions-command-module.ts`
- `packages/agent-command-permissions/src/__tests__/permissions-command-module.test.ts`
- `packages/agent-command-mode/**` only for retirement, redirect, or removal behavior
- CLI command composition in `packages/agent-cli/src/cli.ts` if `/mode` is removed from defaults
- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-cli/README.md`
- `content/guide/cli.md`
- command autocomplete/menu tests if command listings change

## Recommended Direction

Make `/permissions` the canonical command for both viewing and setting permission mode:

- `/permissions` shows current permission state.
- `/permissions <mode>` sets the permission mode.
- `/permissions plan`, `/permissions default`, `/permissions acceptEdits`, and
  `/permissions bypassPermissions` are listed as subcommands.

Recommended `/mode` handling:

- Retire `/mode` from the default visible command list and autocomplete because the name is
  semantically ambiguous.
- Since the project is still beta and legacy compatibility is not required, prefer removing `/mode`
  from default CLI composition instead of keeping a long-term alias.
- If implementation risk or existing scripts make immediate removal too disruptive, keep `/mode` as
  a hidden compatibility alias that returns a short migration message and delegates to
  `/permissions`, then remove it in a follow-up. This should be a temporary fallback, not the target
  architecture.

## Constraints

- Permission-mode state remains SDK/session-owned; CLI must not mutate it directly.
- Command packages must use SDK permission-mode common APIs.
- Do not rename `TPermissionMode`; this backlog changes command UX, not permission contracts.
- Keep `--permission-mode` CLI flag unchanged unless a separate backlog decides otherwise.
- Keep status bar non-default permission mode display unchanged.

## Acceptance Criteria

- [x] `/permissions` with no args shows current permission state.
- [x] `/permissions <mode>` changes permission mode through SDK command common APIs.
- [x] `/permissions` autocomplete/subcommands list all supported permission modes.
- [x] `/mode` is removed from default visible command listings, or is explicitly implemented as a
      temporary hidden migration alias with tests.
- [x] Docs describe `/permissions [mode]` as the canonical permission mode command.
- [x] Docs no longer present `/mode` as the primary way to set permission mode.
- [x] Tests cover valid mode changes, invalid mode errors, no-arg state display, and `/mode`
      retirement/alias behavior.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-command-permissions test`
- `pnpm --filter @robota-sdk/agent-command-mode test` if `/mode` behavior changes
- `pnpm --filter @robota-sdk/agent-cli test -- slash command`
- `pnpm --filter @robota-sdk/agent-command-permissions typecheck`
- `pnpm --filter @robota-sdk/agent-cli typecheck`

## Result

Implemented `/permissions [mode]` as the canonical permission-mode command. `/permissions` now uses
SDK permission common APIs for validation, subcommand metadata, state reads, formatting, and mode
updates. The default Robota CLI composition no longer includes the legacy `/mode` module, while
`@robota-sdk/agent-command-mode` remains available as an optional legacy command module for
applications that explicitly compose it. Docs and headless command coverage were updated.
