---
title: 'CLI-069: Corrupt user-level settings.json is silently treated as missing (forbidden fallback)'
status: todo
created: 2026-06-11
priority: medium
urgency: soon
area: packages/agent-cli
depends_on: []
---

# CLI-069: Corrupt user settings silently swallowed

## Problem

Verified 2026-06-11 (L1): with `~/.robota/settings.json` containing invalid JSON,
`robota -p "hi"` degrades to "No provider configuration found" — the parse error is swallowed
and the file treated as absent. A user with a working config that becomes corrupted (partial
write, manual edit) loses their provider setup with no indication why. This is the
no-fallback rule violation class: an error condition masked as a default.

By contrast, diagnose correctly flags a corrupt **project** `.robota/settings.json` as
"invalid JSON" — the session-start path must do the same for both levels.

## Expected Behavior

Session start fails fast with an explicit error naming the corrupt file path and the JSON
parse error, and suggests `robota diagnose` / fixing or deleting the file. No silent
treat-as-missing.

## Test Plan

- Unit test on the settings-loading path: invalid JSON at user level → typed error with file
  path; same for project level; valid file unaffected.
- `pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Steps: write `{ broken` to `~/.robota/settings.json`; run `robota -p "hi"`; `echo $?`.
- Expected observable result: error names the corrupt file and exits non-zero; not "No
  provider configuration found".
- Evidence: (fill after implementation)
