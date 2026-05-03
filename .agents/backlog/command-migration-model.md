# Command Migration: `/model`

## What

Migrate `/model` into a command-module owner that requests model-change effects through the SDK command contract.

## Current Owner

- Metadata/execution: `packages/agent-sdk/src/commands/system-command.ts`
- Model subcommands: `packages/agent-sdk/src/commands/system-command-metadata.ts`
- Host application: CLI applies `model-change-requested`

## Target Owner

Recommended: `@robota-sdk/agent-command-model`, consuming SDK model registry/common APIs.

## Migration Notes

- Preserve model subcommands from the model registry.
- Preserve typed `model-change-requested` effect.
- Resolve the known restart/apply issue as part of migration: selected model must be applied to the next session after restart.

## Acceptance Criteria

- `/model` is provided by an injected `ICommandModule`.
- Model metadata and command execution are not split.
- Host model change is represented only as typed command effects/adapters.
- Regression test covers restart and selected model application.

## Test Plan

- Add command module tests for usage, valid model request, and descriptor generation.
- Add CLI/TUI integration test proving generic effects start restart flow and preserve selected model.
