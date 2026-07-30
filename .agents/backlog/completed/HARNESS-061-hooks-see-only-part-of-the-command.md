---
title: 'HARNESS-061: every command hook reads only up to the first escaped quote'
status: done
priority: high
urgency: soon
type: INFRA
area: .claude/hooks
created: 2026-07-28
completed: 2026-07-30
depends_on: [INFRA-067]
---

# HARNESS-061 — the shared extraction truncates the thing being judged

## Problem

Every command hook extracts the command from its JSON payload with the same line:

```sh
grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"'
```

`[^"]*` stops at the first `"` — and the payload is JSON, so an embedded quote arrives escaped as
`\"`. A command containing any quoted string is therefore seen **only up to that point**. Everything
after it is invisible to every check the hook performs.

The hook-reachability agent ranked this the highest-value remaining item after fixing the anchors,
and it is the same class: the guard runs, believes it examined the command, and examined a prefix.

It is arguably worse than the anchor bug, because the anchor produced total silence — obvious once
looked for — while this produces a **partial** read that behaves correctly on simple commands and
silently stops mid-way on the ones most likely to be doing something interesting. A `git push`
after a `--body "…"` is exactly the shape that disappears.

## Why it was not caught

Every hook test constructs its payload from a simple command with no embedded quotes. The fixtures
never contain the input that breaks it — the same reason `worktree-cwd-guard`'s ten tests passed
over a dead guard (`INFRA-068`) and `check-forbidden-patterns`' fixture never placed a file in a
worktree.

## Proposed direction

Extract with a JSON-aware read rather than a substring match — `jq` where available, with a
fail-closed path when it is not, since two hooks already fail open silently on a missing `jq` and
that is its own finding.

Whatever replaces it, the contract is: the hook sees the **whole** command or refuses to judge.
Seeing part of it and acting is the failure being removed.

## Done when

- A command whose text contains an escaped quote followed by a guarded verb is intercepted, proven
  RED against the current extraction and GREEN after.
- Every command hook uses the shared extraction — one implementation, so the next fix cannot reach
  some hooks and miss others.
- A missing `jq` fails closed, proven, rather than silently permitting.
- The reachability suite gains a case whose payload contains embedded quotes, so this fixture gap
  cannot reopen.

## GATE-COMPLETE (2026-07-30)

Closed by PR #1514 (the shared command parser) plus one fixture added here.

- A command whose text contains an escaped quote followed by a guarded verb is intercepted:
  `echo "starting release" && git push origin main` on a protected branch measured **exit 0 before,
  exit 2 after**, pinned by `hook-command-parsing.test.mjs`.
- Every command hook uses the shared extraction: `lib/command-scan.sh` is the single owner, and the
  test `every hook ... does not re-implement the command decode` enumerates `.claude/hooks/*.sh`
  rather than a hand-written list. It caught two surviving copies while being written.
- A missing decoder fails closed, proven: with neither `jq` nor `python3` on PATH the hooks exit 2
  naming the reason (`refuses rather than falls silent when it cannot decode`).
- The reachability suite now carries a compound form with embedded quotes, so the fixture gap that
  hid this cannot reopen.
