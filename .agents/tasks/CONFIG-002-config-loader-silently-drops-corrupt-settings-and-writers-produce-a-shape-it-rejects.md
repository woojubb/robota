---
title: 'CONFIG-002: the 6-layer config loader silently treats a corrupt settings file as missing (reverting permissions to empty defaults) against its own CLI-069 fail-fast rule, and updateModelInSettings writes exactly the legacy shape the loader constitutionally rejects — bricking every subsequent session'
status: todo
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-cli
depends_on: []
---

# CONFIG-002: the loader and its writers disagree, and corruption silently widens permissions

## Problem

Two contradictions in `agent-framework/src/config` that both make a session start behave against its
documented contract. First, the layered loader — behind every `InteractiveSession` init — silently
drops a corrupt settings file and falls back to empty defaults, directly against the SPEC's CLI-069
"corrupt is never treated as missing" fail-fast rule; because a project `settings.json` can carry
`permissions.deny`, a corrupted file silently WIDENS permissions. Second, `updateModelInSettings`
writes a legacy flat `provider` shape that the same directory's loader hard-throws on, so writing a
model choice bricks every subsequent session against that file.

## Evidence (round-2 framework-subsystems audit, 2026-08-13)

- **Fail-fast violated (F3, high):** `packages/agent-framework/docs/SPEC.md:495-501` — "Settings files
  on the merge-chain paths are read fail-fast (CLI-069) … Corrupt is never treated as missing … the
  old warn-and-continue path is removed." But `packages/agent-framework/src/config/config-loader.ts:53-58`
  — `catch { // allow-fallback: corrupt config JSON … is treated as missing config; return undefined;
}`. `loadConfig` reads the same six merge-chain paths (`getSettingsPaths`, :224-234) and silently
  drops a corrupt file, reverting to `DEFAULTS` (:33-36) — including a project file carrying
  `permissions.deny`. `settings-io.readSettings` (:31-40) enforces the invariant; the layered loader
  does not.
- **Writer produces a loader-rejected shape (F2, medium):**
  `packages/agent-framework/src/config/settings-io.ts:64-68` — when no `currentProvider`,
  `updateModelInSettings` writes `settings.provider = { …, model }` (flat legacy form); exported
  (`src/index.ts:600`), documented (SPEC:282). `packages/agent-framework/src/config/config-loader.ts:169-173`
  — that exact shape makes `loadConfig` throw `'Legacy flat "provider" settings are not supported…'`.

## Direction

1. Make `readJsonFile` in `config-loader.ts` throw `SettingsParseError` (already defined in this
   directory) on a corrupt EXISTING file, matching `settings-io.ts` — never silently skip. A missing
   file stays missing; a corrupt file is an error, per CLI-069.
2. Make `updateModelInSettings`'s no-`currentProvider` branch synthesize a `currentProvider` +
   `providers` entry (or throw) instead of writing the legacy shape.

## Test Plan

- Red-first: `loadConfig` against a corrupt project `settings.json` throws `SettingsParseError` (fails
  today — returns defaults); a corrupt file carrying `permissions.deny` does NOT silently revert to
  empty permissions.
- Red-first: `updateModelInSettings` output round-trips through `loadConfig` without throwing (fails
  today).
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

**Applies** (settings.json is a user-editable product surface; model selection is a CLI action).

- Prerequisites: built CLI.
- Steps: (1) hand-corrupt a project `.robota/settings.json` (that carries a `permissions.deny` entry)
  and start the CLI; (2) on a fresh project with no `currentProvider`, select a model via the CLI, then
  restart.
- Expected (after fix): (1) the CLI reports a settings parse error rather than starting with widened
  permissions; (2) the model selection persists and the CLI restarts cleanly.
- Expected (before fix, contrast): (1) the CLI starts silently with empty-default permissions; (2) the
  next start throws "Legacy flat provider settings are not supported".
- Cleanup: restore/delete the settings files.
- Evidence (fill in after implementation): the CLI output for both cases.
