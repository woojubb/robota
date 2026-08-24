---
title: 'CONFIG-002: the 6-layer config loader silently treats a corrupt settings file as missing (reverting permissions to empty defaults) against its own CLI-069 fail-fast rule, and updateModelInSettings writes exactly the legacy shape the loader constitutionally rejects — bricking every subsequent session'
status: todo
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-cli
depends_on: []
issue: https://github.com/woojubb/robota/issues/2023
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

## Measurement (issue #2023, re-derived at `2a76b3869`)

Issue #2023 was opened nine days after this record and names ONE file. The record's own evidence is
two sites. Enumerating from code instead of from either text finds **12 parse sites over
settings/policy/permission documents**, and the two axes the issue's title names must be judged
separately, because a site can be one without the other:

```
parse sites ............ 12   @2a76b3869
fail open ............... 5   @2a76b3869   (every one carries an allow-fallback marker)
silently drop ........... 4   @2a76b3869
validate shape .......... 4   @2a76b3869
```

`dag-cli/session/session-gate.ts` is the case that proves the axes are distinct: it fails open on a
malformed `DAG_SESSION_PERMISSIONS` and writes a warning to stderr. Open, and not silent.

**All five fail-opens are recorded decisions, not accidents** — each carries an `allow-fallback`
marker with a stated reason: "likely a crash during write", "must not crash CLI startup", "to allow
recovery", "open access is the safe default", "disables the feature gracefully". Every reason is an
availability argument, and none of them mentions that the document being dropped is a security
control. The decision was made; the consequence was not weighed in it.

### The sharpest form: one file, two readers, opposite verdicts

`config-loader.ts` and `command-api/provider/provider-merge.ts` both call `readSettingsSourceText`
over the same `TSettingsSource` — the same files on disk. On a corrupt one:

- `config-loader` caught and returned `undefined`, so the layer was dropped;
- `provider-merge` catches and throws `SettingsParseError`.

**The same corrupt file was fatal or ignored depending on which path reached it**, with both owners
inside `agent-framework`, four directories apart, over one shared reader. Issue #2023 predicts this
in the abstract ("different configuration owners may behave inconsistently if they parse files
separately"); it is concrete, and it is between two modules that already share the reader.

That also sharpens what "shape validation" means here. `loadConfig` DOES validate shape, with Zod,
and fails closed on it — but corrupt JSON returned `undefined` and was filtered out one line before
`safeParse` ran. **The fail-open path routed around the fail-closed one inside a single function.**

### Corrected: three claims of an earlier reconnaissance pass that were wrong

Recorded because the numbers were reported before they were checked, and a wrong measurement that
survives is worse than none:

- "10 parse sites" — the query returned 12 at both `81a4ab97c` and `2a76b3869`. Two sites were
  dropped from the write-up without being mentioned.
- "none of the sites validates shape" — four do, and for three others `TSettingsData` is
  `Record<string, TUniversalValue>`, an open map with no shape to validate. That was counting the
  absence of something those sites are not supposed to have.
- A cited path that does not exist (`config/provider/provider-merge.ts`; the file is under
  `command-api/`).

## Direction

1. **DONE (issue #2023).** `readJsonSource` in `config-loader.ts` throws `SettingsParseError` on a
   corrupt EXISTING file, matching `settings-io.ts` — never silently skip. A missing file stays
   missing; a corrupt file is an error, per CLI-069. An existing but EMPTY file is corrupt too:
   `settings-io.readSettings` reaches `JSON.parse('')` and throws for the same file, so "empty is
   missing" was this loader disagreeing with its neighbour rather than a considered policy. No
   product path writes an empty settings file — `robota init` always writes `JSON.stringify(...)`
   — so failing closed there costs nothing that existed.
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
