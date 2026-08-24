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

## Direction item 1, hooks and taskContext — delivered 2026-08-24

`mergeSettings` now merges `hooks` **per lifecycle event**, appending each layer's groups in layer
order, and merges `taskContext` field-wise. A later layer can ADD hooks and can never REMOVE one it
did not declare.

**Why per-event and not per-object.** Replacing the `PreToolUse` array wholesale is exactly as fatal
as replacing the whole `hooks` object, so an object-level merge would have looked like a fix and left
the same hole one level down. The same-event case is pinned by its own test.

**Why user-first ordering.** `runHooks` returns on the first `deny`, so a surviving user guard blocks
regardless of position — but ordering decides which hook gets to speak for non-deny decisions, and
the higher-trust layer should be the one that does.

**The codebase already knew.** `plugins/plugin-hooks-merger.ts`'s `mergeHooksIntoConfig` composes
plugin hooks with config hooks by concatenating per event, and always has. Settings-layer hooks were
the only hook composition in the package that replaced instead of merging.

Red-first, as the Test Plan above requires — all three fail on the property itself without the fix:

```
expected undefined to be 'user-guard'                       ← the guard was deleted
expected [ { matcher: 'Bash' } ] to have a length of 2       ← the same-event group was replaced
expected undefined to be false                              ← the user's taskContext.enabled was erased
```

`mergeSettings`/`mergeHooks`/`mergeProviders` moved to `config/config-merge.ts`: the loader READS and
RESOLVES, while what a later layer may do to an earlier one is a different question — and the one
with the security boundary in it.

The SPEC's "Higher layers override lower layers via deep merge" now states the hooks exception where
that claim is made, including that deliberate user-level _disable_ semantics are not defined and were
not invented inside a merge function.

### What this does NOT deliver

- **`transports`** (Direction item 2). Wholesale replacement is real but reaches no consumer:
  `toResolvedConfig` never populates it, so the merge behaviour of a field nothing reads was left
  alone rather than "fixed" invisibly. The delete-or-populate decision is still open.
- **`preset` routing**, same item.
- **`permissions.allow` / `.deny`.** Measured while here and NOT changed: both are field-level
  replacements (`layer.permissions?.deny ?? merged.permissions?.deny`), so a project layer declaring
  `deny` erases the user's. That is a **deliberate** line somebody wrote, unlike the hooks case which
  fell out of a spread, so it needs an argument rather than a correction — and `allow` needs a
  different argument from `deny`, because unioning a restriction is safe while unioning a grant is
  not. Raised separately.
- **Provenance diagnostics** and **explicit disable semantics** from issue #2024's acceptance list.
  Both are design decisions; this change deliberately makes neither.

### Issue #2024 is the same defect, narrower

Issue #2024 (2026-08-22) records the `hooks` half of this record (2026-08-13) with a reproduction and
an acceptance list. This record owns it — it is earlier and names all three fields. Issue #2024's acceptance
criteria are folded in above, and it closes when this record delivers.

## `permissions.deny` — delivered 2026-08-24

**Not a new rule. The repository's rule, applied at the one site that disagreed.**

`agent-core`'s `applyPresetToolLists` states and implements it for the preset layer:

> the allowlist REPLACES … the denylist UNIONS — a denial is not weakened by a later layer that
> forgot to repeat it.

`permission-enforcer.ts:126` cites the same rule when it explains why a newly applied denial outranks
an earlier "always allow". ARCH-040's completed record calls it **settled**.

`mergeSettings` was the exception: `layer.permissions?.deny ?? merged.permissions?.deny` meant a
project layer declaring ANY deny silently dropped every deny the user had configured. `deny` now
unions, deduplicated and order-preserving to match `applyPresetToolLists`.

**`allow` is deliberately unchanged, and that asymmetry is the rule rather than an oversight.** An
allowlist states the complete permitted set, so a later, more specific layer supersedes it; unioning
a GRANT would let a project widen what the user permitted — the same inverted trust direction the
deny fix closes. A test now pins it, so a future change that unions `allow` for symmetry goes red.

**What this was, versus the `hooks` half.** The hooks defect fell out of a top-level spread and the
code contradicted its own comment. This line was written on purpose. What makes it wrong is not that
nobody decided it, but that **the decision contradicts one the repository had already made
elsewhere** — which is why it needed a citation rather than an argument.

**Mitigation, stated because it bounds the severity without excusing it:** project settings sources
are read only when `projectAccess.status === 'trusted'`. Trusting a workspace means the user trusts
it to contribute settings; it does not mean they intended it to remove their own deny rules, and a
trusted workspace is still a cloned repository.

Each of the three tests is falsifiable by its own mutant, verified rather than assumed:

```
deny replaces (the defect)   → "expected [ 'Read(.env)' ] to include 'Bash(rm -rf *)'"
union without dedup          → "expected [ 'Bash(rm -rf *)', …(2) ] to deeply equal [ … ]"
allow unioned too            → "expected [ 'Bash(git *)', 'Read(**)' ] to deeply equal [ 'Read(**)' ]"
```

Only the first is red against `develop`; the other two are red against a mutant of this change, and
are characterisation rather than regression tests. Stated because "three red-first tests" would have
been the easier and wrong claim.
