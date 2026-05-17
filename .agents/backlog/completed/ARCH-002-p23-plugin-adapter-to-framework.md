---
title: 'ARCH-002-p23: Move plugin-command-adapter and plugin-command-source-loader out of agent-cli'
status: done
---

# ARCH-002-p23: Move plugin-command-adapter and plugin-command-source-loader out of agent-cli

## Problem

`packages/agent-cli/src/plugins/plugin-command-adapter.ts` (160 lines) implements
`ICommandPluginAdapter` and `packages/agent-cli/src/plugins/plugin-command-source-loader.ts`
(35 lines) implements `reloadPluginCommandSource`. Both files:

- Use only `@robota-sdk/agent-framework` classes (`BundlePluginInstaller`, `BundlePluginLoader`,
  `MarketplaceClient`, `PluginSettingsStore`, `CommandRegistry`, `PluginCommandSource`)
- Use only Node.js stdlib (`execSync`, `homedir`, `join`)
- Have **zero CLI-specific type dependencies** (no `IParsedCliArgs`, no TUI types)
- Implement interface contracts (`ICommandPluginAdapter`) owned by `agent-framework`

Plugin management — install, uninstall, enable, disable, list, marketplace operations,
source reload — is a framework-level concern. Applications embedding the SDK without the
TUI/CLI must be able to manage plugins. Currently they cannot, because the concrete adapter
is trapped in agent-cli.

Per CLI-AUDIT-009 and the Composable-material-first rule: these are reusable SDK capabilities,
not CLI-specific adapters.

## Design decision (revised from original)

Original plan was to move to `agent-framework`. Revised to `agent-command` because:

- These adapters bridge BundlePlugin (agent-framework) → CommandSource (agent-command)
- `agent-command` already depends on `agent-framework` → no new circular deps
- `agent-framework` cannot import from `agent-command` (it's above in the stack)
- "How plugins are loaded" (agent-framework) vs "How plugin commands are exposed" (agent-command)
  are separate concerns

## Fix (implemented)

1. Created `packages/agent-command/src/plugins/default-plugin-command-adapter.ts`
   - Renamed `createCliPluginCommandAdapter` → `createDefaultPluginCommandAdapter`
2. Created `packages/agent-command/src/plugins/default-plugin-command-source-loader.ts`
   - Kept `reloadPluginCommandSource` name (already generic)
3. Exported both from `packages/agent-command/src/index.ts`
4. Updated `packages/agent-cli/src/startup/command-setup.ts`:
   - Replaced `createCliPluginCommandAdapter` (local) with `createDefaultPluginCommandAdapter`
     from `@robota-sdk/agent-command`
5. Updated `packages/agent-cli/src/cli.ts`:
   - Replaced local import of `reloadPluginCommandSource` with `@robota-sdk/agent-command`
6. Deleted `packages/agent-cli/src/plugins/plugin-command-adapter.ts`,
   `packages/agent-cli/src/plugins/plugin-command-source-loader.ts`, and the `plugins/` directory

## Architecture map update

- Added `CLI-AUDIT-023` to layering-audit.md (resolved)
- Updated composition-tree.md: plugin adapter imported from `@robota-sdk/agent-command`
