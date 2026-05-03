# Command Migration: `/plugin`

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

- `/plugin` is provided by a command-module owner.
- Host UI opening is a typed effect or injected host adapter.
- CLI slash routing has no plugin-specific branch.

## Test Plan

- Add command module tests for plugin manager effect.
- Add CLI effect-handler tests for opening/closing PluginTUI.
