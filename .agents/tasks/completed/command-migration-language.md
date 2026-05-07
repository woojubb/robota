# Command Migration: `/language`

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-language-module
- **Scope**: packages/agent-command-language, packages/agent-sdk, packages/agent-cli

## What

Migrate `/language` into a command-module owner that requests language-change effects through the SDK command contract.

## Current Owner

- Metadata/execution: `packages/agent-sdk/src/commands/system-command.ts`
- Host application: CLI persists language settings and restarts

## Target Owner

Recommended: `@robota-sdk/agent-command-language`.

## Migration Notes

- Preserve subcommands: `ko`, `en`, `ja`, `zh`.
- The command module should return a typed `language-change-requested` effect.
- Concrete settings persistence remains a host adapter effect, not command implementation file I/O unless an injected settings adapter is supplied.

## Acceptance Criteria

- [x] `/language` is provided by an injected `ICommandModule`.
- [x] CLI/TUI applies only typed effects.
- [x] No language-specific command branch exists in slash routing.

## Test Plan

- [x] Add command module tests for usage and language effects.
- [x] Add CLI effect-handler tests for settings persistence and restart.

## Progress

### 2026-05-03

- Promoted backlog item to an active task.
- Selected `@robota-sdk/agent-command-language` because `/language` owns user-visible command metadata and should only emit typed effects for host application.
- Added SDK language command common APIs, a dedicated command module package, CLI module composition, and slash routing tests that prove `/language` now routes through the generic registry command path.
- Completed implementation and full PR verification.

## Decisions

- Preserve existing behavior that accepts any non-empty language code while exposing `ko`, `en`, `ja`, and `zh` as recommended subcommands.

## Blockers

- None.

## Result

Completed `/language` migration into `@robota-sdk/agent-command-language`. The CLI now composes the command module and applies typed `language-change-requested` effects through the existing side-effect bridge, while slash routing uses the generic registry path instead of a language-specific branch.
