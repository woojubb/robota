# ARCH-002-p23: Move plugin-command-adapter and plugin-command-source-loader to agent-framework

## Status: todo

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

## Fix

1. Move `plugin-command-adapter.ts` to
   `packages/agent-framework/src/plugins/default-plugin-command-adapter.ts`
   - Rename `createCliPluginCommandAdapter` → `createDefaultPluginCommandAdapter`
2. Move `plugin-command-source-loader.ts` to
   `packages/agent-framework/src/plugins/default-plugin-command-source-loader.ts`
   - Keep `reloadPluginCommandSource` name (already generic)
3. Export both from `packages/agent-framework/src/index.ts`:
   ```typescript
   export { createDefaultPluginCommandAdapter } from './plugins/default-plugin-command-adapter.js';
   export { reloadPluginCommandSource } from './plugins/default-plugin-command-source-loader.js';
   ```
4. Update `packages/agent-cli/src/startup/command-setup.ts`:
   - Replace import of `createCliPluginCommandAdapter` from local with
     `createDefaultPluginCommandAdapter` from `@robota-sdk/agent-framework`
5. Update `packages/agent-cli/src/cli.ts`:
   - Replace import of `reloadPluginCommandSource` from local plugin loader with
     import from `@robota-sdk/agent-framework`
6. Delete `packages/agent-cli/src/plugins/plugin-command-adapter.ts` and
   `packages/agent-cli/src/plugins/plugin-command-source-loader.ts`
7. Delete `packages/agent-cli/src/plugins/` directory if empty
8. Build and typecheck both packages; run tests.

## Architecture map update

- Add `CLI-AUDIT-023` to layering-audit.md (new finding, immediately resolved)
- Update composition-tree.md: plugin adapter imported from `@robota-sdk/agent-framework`
