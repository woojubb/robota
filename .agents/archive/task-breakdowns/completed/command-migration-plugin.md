# Command Migration: `/plugin`

- **Status**: completed
- **Completed**: 2026-05-03
- **Branch**: feat/command-plugin-module

## What

Migrate `/plugin` from CLI host command grouping into a command-module owner with explicit host UI effects.

## Current Owner

- Implementation: `packages/agent-cli/src/commands/cli-host-command-module.ts`
- Host rendering: CLI `PluginTUI`

## Target Owner

Recommended: `@robota-sdk/agent-command-plugin` if plugin management should be composable beyond the default CLI; otherwise keep an isolated CLI-default command module that returns typed host effects.

## Migration Notes

- Preserve typed `plugin-tui-requested` effect.
- Plugin TUI rendering and keyboard handling stay in CLI.
- Plugin command metadata and execution should not live in generic slash routing.

## Acceptance Criteria

- [x] `/plugin` is provided by a command-module owner.
- [x] Host UI opening is a typed effect or injected host adapter.
- [x] CLI slash routing has no plugin-specific branch.

## Test Plan

- [x] Add command module tests for plugin manager effect.
- [x] Add CLI effect-handler tests for opening/closing PluginTUI.

## Result

- Added `@robota-sdk/agent-command-plugin`.
- Added SDK plugin command common APIs under `agent-sdk/src/command-api/plugin`.
- Moved plugin operation wiring into a CLI `ICommandPluginAdapter` implementation.
- Composed the plugin command module in the CLI product defaults.
- Removed `/plugin` from the CLI host command module and legacy slash plugin handlers.
