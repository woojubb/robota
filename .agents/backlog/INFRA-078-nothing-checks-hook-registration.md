---
title: 'INFRA-078: a hook can be wired to no event, or a matcher can name a deleted file, and everything stays green'
status: in-progress
priority: high
urgency: now
type: INFRA
area: .claude
created: 2026-08-01
depends_on: []
issue: https://github.com/woojubb/robota/issues/1552
---

# INFRA-078 — `.claude/settings.json` is read by nothing

## Problem

`hooks-have-execution-coverage` enumerates `.claude/hooks/*.sh` and requires a test to EXECUTE each
one. Nothing enumerates the same directory against `.claude/settings.json`, so:

- a hook file can exist, be tested, and be **registered to no event** — it never runs in a real
  session and every gate stays green;
- a matcher can name a **file that no longer exists** — the event fires and nothing happens.

Measured 2026-08-01: the only test that reads `settings.json` asserts one thing — that
`check-forbidden-patterns` is registered for `MultiEdit` (`hook-command-parsing.test.mjs:514`).
`scan-hook-catalog` is about the product's `THookEvent` union, not this file.

This is the third question of PROC-003 — _is it reached?_ — one step earlier than
`hooks-have-execution-coverage` asks it. That floor proves a hook CAN run. This one would prove the
deployment actually calls it.

## Not hypothetical

`revert-detect.sh` (137 lines) is referenced by **no matcher**. It is not dead — `eval-log-stop.sh`
shells out to it — but it is reachable only through another hook's body, which is a fact worth
being visible rather than discovered.

## Direction

A scan that parses `.claude/settings.json` and fails when a `.claude/hooks/*.sh` appears in no
matcher, or a matcher names a missing file. The one nuance to state rather than guess: a hook
invoked by another hook (like `revert-detect`) is legitimately unregistered — that needs a declared
form, not an exemption list, or the exemption becomes the hole.

## Done when

- A hook registered to no event fails a scan, and a matcher naming a missing file fails it.
- Red-proved both ways against the current tree.
- `revert-detect`'s indirect invocation is declared, so "unregistered" and "invoked by a sibling"
  are told apart mechanically rather than by memory.

## Implemented (branch `feat/infra-078-hook-registration`)

`scripts/harness/scan-hook-registration.mjs`, registered as `hook-registration`. Measured on this
tree: **12 hook files, 6 matchers, 12 registrations**.

Red-proved both ways before it was believed:

- The undeclared unregistered hook — run against the real tree it named
  `.claude/hooks/revert-detect.sh … carries no \`# invoked-by: <hook>.sh\` header`, exit 1. Adding
  the verified declaration to `revert-detect.sh` turned it green.
- The missing file — a matcher pointing at `deleted.sh` in a temp fixture reports
  `registers \`deleted.sh\` for PreToolUse, but .claude/hooks/deleted.sh does not exist`.
- Neither is accidentally green: reverse-applying rule A fails 4 tests, rule B fails its own test,
  and the correctly-registered fixture plus the real tree pass with an empty findings list.
