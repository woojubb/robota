# Command Migration: `/language`

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

- `/language` is provided by an injected `ICommandModule`.
- CLI/TUI applies only typed effects.
- No language command branch exists in slash routing.

## Test Plan

- Add command module tests for usage and language effects.
- Add CLI effect-handler tests for settings persistence and restart.
