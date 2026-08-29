---
title: "PLG-021: /plugin disable writes enablement state that no loader reads (a disabled plugin's hooks/commands/skills keep loading every session), and project-scope plugin install writes to .robota/plugins/ that nothing loads or lists — both bundle-plugin contract halves are dead end-to-end"
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2487#issuecomment-5460706799
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-command
depends_on: []
---

# PLG-021: plugin enable/disable and project scope are silent no-ops

## Problem

Two end-to-end dead paths in the bundle-plugin system. `/plugin disable` persists an `enabledPlugins`
map and the list view shows the disabled state, but every loader ignores the map — a disabled plugin's
hooks, commands, and skills keep loading every session. And project-scope install writes to
`.robota/plugins/`, which no loader or lister ever reads, and the shipped command never even passes the
scope parameter.

## Evidence (round-2 framework-subsystems audit, 2026-08-13)

- **enabledPlugins gates nothing (F6):** `docs/SPEC.md:2067` — installer "Handles enable/disable state
  per plugin"; `config-types.ts:155-156,199-200` "Plugin enablement map"; the loader implements the
  gate (`bundle-plugin-loader.ts:90-92,114-123`). But all three production constructions pass NO
  enablement map: `interactive-session-init.ts:104` (`new BundlePluginLoader(pluginsDir)` — disabled
  plugins' hooks still merged, :107-116), `agent-command/src/plugins/default-plugin-command-adapter.ts:48`,
  `default-plugin-command-source-loader.ts:16`. `/plugin disable` writes `enabledPlugins`
  (`bundle-plugin-installer.ts:139-142` → `plugin-settings-store.ts:76-82`) and the list path DISPLAYS
  the disabled state (`default-plugin-command-adapter.ts:63-74`), but the LOAD paths ignore it;
  `IResolvedConfig.enabledPlugins` (`config-loader.ts:214`) has no consumer.
- **Project scope is a dead end (F7):** `docs/SPEC.md:2065` — "Installs bundles to `~/.robota/plugins/`
  (user) or `.robota/plugins/` (project)"; contract `agent-interface-transport/src/command-contracts.ts:204`
  (`install(pluginId, scope?)`); implementation `default-plugin-command-adapter.ts:108-123`. But every
  loader reads only the user dir (`interactive-session-init.ts:103-104`,
  `default-plugin-command-adapter.ts:31,48`, `default-plugin-command-source-loader.ts:15-16`); the only
  `<cwd>/.robota/plugins` reference is the installer's write path. And the shipped command never passes
  scope: `agent-command/src/plugin/plugin-command.ts:134` — `await adapter.install(targetPluginId)`.

## Direction

1. Thread the enablement map (from `PluginSettingsStore.getEnabledPlugins()` or `config.enabledPlugins`)
   into every `BundlePluginLoader` construction so `/plugin disable` actually stops a plugin's hooks/
   commands/skills from loading.
2. Either wire project-dir loading (session init + command source + list read `<cwd>/.robota/plugins`)
   and pass `scope` from `/plugin install`, or remove the project scope from the installer, the
   `install(pluginId, scope?)` contract, and the SPEC. Silent no-op is the wrong state.

## Test Plan

- Red-first: a disabled plugin's hooks and commands do NOT load in a new session (fails today); a
  project-scope install is loaded and listed (or the scope is removed and no code references
  `.robota/plugins` for install).
- `pnpm harness:verify -- --scope packages/agent-framework` and `--scope packages/agent-command` green.

## User Execution Test Scenarios

**Applies** (`/plugin` is a user-facing command).

- Prerequisites: built CLI; a bundle plugin installed that contributes an observable command or hook.
- Steps: (1) run `/plugin disable <name>`, restart, check whether the plugin's command/hook is still
  active; (2) install a plugin at project scope and check whether it loads in that project.
- Expected (after fix): (1) the disabled plugin is inert after restart; (2) the project-scope plugin
  loads (or project scope is no longer offered).
- Expected (before fix, contrast): (1) the disabled plugin still works; (2) the project-scope install
  writes files nothing loads.
- Cleanup: uninstall the fixture plugin.
- Evidence (fill in after implementation): before/after command availability for the disabled plugin.

## Resolution

Skipped and archived as a split disposition: the enable/disable half landed in [PR #2278](https://github.com/woojubb/robota/pull/2278), while the
project-scope install/load dead path remains unresolved. That residual is now owned by [issue #2487](https://github.com/woojubb/robota/issues/2487), with the exact handoff comment recorded there. A fresh Task must be created from that issue when implementation is selected.
