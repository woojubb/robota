# Command Migration: `/reload-plugins`

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-reload-plugins-module
- **Scope**: packages/agent-command-plugin, packages/agent-cli, packages/agent-sdk

## Objective

Move `/reload-plugins` out of the CLI host command module and into the plugin command module owner. The command must call the injected plugin adapter so reload failures are visible instead of returning a no-op success.

## Plan

- [x] Confirm current `/reload-plugins` implementation and plugin adapter shape.
- [x] Extend SDK/plugin command contracts for reload semantics if needed.
- [x] Implement `/reload-plugins` in `@robota-sdk/agent-command-plugin`.
- [x] Remove CLI host ownership and update CLI tests/docs/backlog.
- [x] Run targeted and repository verification.
- [x] Prepare branch for PR, CI, and merge to `develop`.

## Progress

### 2026-05-03

- Started from `develop` on `feat/command-reload-plugins-module`.
- Confirmed the old CLI host command returned a placeholder success without calling plugin loader state.
- Added command-package ownership plus a typed registry reload effect so successful reloads refresh plugin-provided slash commands.
- Verified targeted package tests/build/typecheck/lint, root build/typecheck/test/lint, harness scan, docs build, and whitespace.

## Decisions

- Recommended approach: keep `/reload-plugins` with `@robota-sdk/agent-command-plugin` because it shares the same plugin adapter and command namespace as `/plugin`.
- `ICommandPluginAdapter.reloadPlugins()` returns a loaded plugin count so command tests can distinguish real loader execution from a no-op success.

## Test Plan

- Run `pnpm --filter @robota-sdk/agent-command-plugin test`, build, typecheck, and lint for the migrated command owner.
- Run SDK command API and command registry tests to verify the new reload result/effect and dynamic source replacement contracts.
- Run CLI slash routing, PluginTUI, build, typecheck, and lint to verify host adapter wiring and registry reload effect handling.
- Run root build, typecheck, test, lint, harness scan, docs build, and `git diff --check` before committing.

## Blockers

- None.

## Result

Implemented `/reload-plugins` in `@robota-sdk/agent-command-plugin`, removed the CLI host placeholder module, added SDK reload/effect contracts plus dynamic registry source replacement, and updated CLI registry reload handling and docs.
