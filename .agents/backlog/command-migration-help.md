# Command Migration: `/help`

## What

Migrate `/help` from SDK embedded system-command logic into a command-module owner that consumes the SDK command registry/common API.

## Current Owner

- Metadata/execution: `packages/agent-sdk/src/commands/system-command.ts`
- Palette derivation: `packages/agent-sdk/src/commands/builtin-source.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-help`, or a shared command help module if multiple command-only utilities are grouped later. The module must consume SDK registry/listing APIs as an external command package would.

## Migration Notes

- Preserve current output shape: `Available commands:` plus registered command names and descriptions.
- Do not let SDK core special-case help output beyond exposing command listing/common formatting APIs.
- Keep command metadata and execution together.

## Acceptance Criteria

- `/help` is provided by an injected `ICommandModule`.
- SDK exposes only generic command listing APIs needed by the module.
- CLI/TUI has no `/help` branch.
- Tests prove help output includes composed command modules.

## Test Plan

- Add module tests for output with SDK built-ins, CLI host modules, and optional command modules.
- Add registry integration tests proving `/help` sees composed commands.
