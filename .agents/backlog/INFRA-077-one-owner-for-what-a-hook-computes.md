---
title: 'INFRA-077: five facts computed separately in four hooks, and the copies disagree'
status: todo
priority: high
urgency: soon
type: INFRA
area: .claude/hooks
created: 2026-08-01
depends_on: []
---

# INFRA-077 — the hooks recompute each other's facts, and get different answers

## Problem

An independent audit of `.claude/hooks/**` (2026-08-01) executed every hook against scratch
repositories and found five facts computed by separate code in two or more hooks. **The copies do
not agree**, and each disagreement is reachable from an ordinary command.

| Fact                                 | Copies                                                                                                                     | A measured disagreement                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the payload's `file_path`            | `post-tool-format`, `memory-mirror-reminder` hand-roll `grep -o '"file_path"…"[^"]*"'`; `hook_json_string` owns it         | `/tmp/a b/we\"ird.ts` truncates at the escaped quote, so the file is silently never formatted                                                                          |
| reading a JSON field at all          | `correction-detect`, `revert-detect`, `spec-first-gate` each carry an identical `read_json()` with **no python3 fallback** | with `jq` hidden, `spec-first-gate` prints nothing and `correction-detect` writes nothing, while `branch-guard` keeps working — same host, half the hooks silently off |
| which repository the command acts on | four resolutions, two rules — validate-then-fall-back vs first-non-empty                                                   | `git -C /no/such/dir reset --hard` is judged by one hook and waved through by another                                                                                  |
| the current branch                   | four copies, three fallback spellings                                                                                      | `eval-log-stop`'s `                                                                                                                                                    |     | echo unknown`is dead code:`branch --show-current`exits 0 with empty output on a detached HEAD, so every detached session logs`"branch": ""` |
| git invoked with a scrubbed env      | `git_project()` byte-identical in two hooks; ~20 bare `git -C` call sites elsewhere                                        | with `GIT_DIR` exported, `git -C <scratch>` reports the OUTER repo's branch — so a guard can judge a different repository than the one the command runs in             |

## Why one item

These are one defect with five faces: a hook needs a fact, the shared library either does not offer
it or the hook does not use it, so the hook writes its own. `lib/command-scan.sh` was created to end
exactly this for command parsing, and two hooks still hand-roll the very pattern its header names as
the reason it exists.

## Direction

Move each fact into `lib/command-scan.sh` (or a sibling) as one function, and route every hook
through it: `hook_json_string` for payload fields, `hook_effective_repo` for the checkout,
`hook_current_branch` with the default applied to the VALUE not the exit code, and a `hook_git`
wrapper that scrubs `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_PREFIX`.

Where the copies disagree, the consolidation is a DECISION, not a merge: `worktree-cwd-guard`'s
first-non-empty resolution is documented as a deliberate fail-safe, and `branch-guard`'s
`BASE_DIR` deliberately ignores `git -C`. Both must survive as named modes rather than be flattened.

## What has no test today

Stated because it changes the risk: **no test in `scripts/harness/__tests__/` sets `GIT_DIR`,
`GIT_WORK_TREE`, `GIT_INDEX_FILE` or `GIT_PREFIX` for any hook invocation**, none runs a hook with
`jq` absent, and none feeds an escaped or backslashed path. Every disagreement above is invisible to
the suite as it stands, so the consolidation must land with those cases or it lands unproven.

## Done when

- Each of the five facts has one implementation, and every hook uses it.
- A case exists for each disagreement above — the escaped path, the absent `jq`, the ambient
  `GIT_DIR`, the detached HEAD, the `git -C <nonexistent>` — and each fails before the fix.
- The deliberate divergences are named modes with their reason, not silently unified.
