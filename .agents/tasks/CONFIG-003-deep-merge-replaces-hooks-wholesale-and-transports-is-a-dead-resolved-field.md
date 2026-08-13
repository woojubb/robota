---
title: 'CONFIG-003: the config loader documents "deep merge" but replaces hooks/taskContext/transports wholesale (a project hook silently deletes user-global guard hooks), and IResolvedConfig.transports is a schema-validated field the loader never populates while the live consumer reads only the user-global file'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-cli
depends_on: []
---

# CONFIG-003: merge semantics and a dead resolved field

## Problem

Two contradictions in the settings merge model. The SPEC says higher layers override lower via deep
merge, but `hooks` (and `taskContext`, `transports`) are replaced wholesale — so a project settings
file declaring one hook silently deletes every user-global hook, including security guard hooks. And
`IResolvedConfig.transports` is a schema-validated, resolved field that the loader never populates and
nothing reads; the live consumer bypasses the layered model entirely and reads only the user-global
file (same for the `preset` key).

## Evidence (round-2 framework-subsystems audit, 2026-08-13)

- **Wholesale replace (F4):** `packages/agent-framework/docs/SPEC.md:2024` — "Higher layers override
  lower layers via deep merge." But `config-loader.ts:117-148` `mergeSettings` deep-merges only
  `provider`/`permissions`/`env`/`providers`/`enabledPlugins`; `hooks` (and `taskContext`,
  `transports`) fall through the plain `{...merged, ...layer}` spread, so any layer defining `hooks`
  replaces the entire lower-layer hooks object. A project `.robota/settings.json` `PostToolUse` hook
  silently deletes a user-global `~/.claude/settings.json` `PreToolUse` guard.
- **Dead resolved field (F5):** `config-types.ts:161-162,208-209` — `transports` is validated by
  `SettingsSchema` and declared on `IResolvedConfig` ("Transport enable/disable + options"), and the
  6-layer model (SPEC:2013-2024) covers all schema keys. But `config-loader.ts:202-219`
  `toResolvedConfig` never maps `merged.transports` (repo-wide: zero readers of `config.transports`);
  the only real consumer reads the user-global file only —
  `agent-cli/src/remote-control/index.ts:25-26,38-39` (`readSettings(getUserSettingsPath())`). Same
  for the schema's `preset` key (read only from the user file, `agent-cli/src/cli.ts:182-183`).

## Direction

1. Decide `hooks` merge semantics: per-event deep-merge (code-side, matches the SPEC and the Claude
   Code hook-compat intent — a project hook should ADD to, not replace, user-global guards), or narrow
   the SPEC sentence to name which keys deep-merge and which replace, and warn on wholesale hook
   replacement. Do the same for `taskContext`/`transports`.
2. Either populate `transports` (and route `preset`) in `toResolvedConfig` so they honor the layered
   precedence and the consumers read the resolved config, or delete `transports` from `IResolvedConfig`
   and document `transports`/`preset` as user-global-only keys.

## Test Plan

- Red-first: a user-global hook + a project hook of a different event both survive the merge (fails
  today — project replaces user); a project `transports.webrtc.options` entry is honored (or the field
  is removed and documented user-global-only).
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

**Applies** (hooks and transport settings are user-configurable via settings.json).

- Prerequisites: built CLI; a user-global `settings.json` with a `PreToolUse` guard hook and a project
  `.robota/settings.json` with a `PostToolUse` hook.
- Steps: start the CLI in that project and trigger a tool call; check whether the user-global guard
  still fires.
- Expected (after fix): both hooks fire.
- Expected (before fix, contrast): only the project hook fires; the user-global guard is silently
  gone.
- Cleanup: remove the fixture hooks.
- Evidence (fill in after implementation): logs showing both hooks executed.
