---
title: 'INFRA-077: five facts computed separately in four hooks, and the copies disagree'
status: in-progress
priority: high
urgency: now
type: INFRA
area: .claude/hooks
created: 2026-08-01
depends_on: []
issue: https://github.com/woojubb/robota/issues/1551
---

# INFRA-077 — the hooks recompute each other's facts, and get different answers

## Problem

An independent audit of `.claude/hooks/**` (2026-08-01) executed every hook against scratch
repositories and found five facts computed by separate code in two or more hooks. **The copies do
not agree**, and each disagreement is reachable from an ordinary command.

| Fact                                 | Copies                                                                                                                     | A measured disagreement                                                                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the payload's `file_path`            | `post-tool-format`, `memory-mirror-reminder` hand-roll `grep -o '"file_path"…"[^"]*"'`; `hook_json_string` owns it         | `/tmp/a b/we\"ird.ts` truncates at the escaped quote, so the file is silently never formatted                                                                                                               |
| reading a JSON field at all          | `correction-detect`, `revert-detect`, `spec-first-gate` each carry an identical `read_json()` with **no python3 fallback** | with `jq` hidden, `spec-first-gate` prints nothing and `correction-detect` writes nothing, while `branch-guard` keeps working — same host, half the hooks silently off                                      |
| which repository the command acts on | four resolutions, two rules — validate-then-fall-back vs first-non-empty                                                   | `git -C /no/such/dir reset --hard` is judged by one hook and waved through by another                                                                                                                       |
| the current branch                   | four copies, three fallback spellings                                                                                      | `eval-log-stop`'s `\|\| echo unknown` default is dead code: `branch --show-current` exits 0 with EMPTY output on a detached HEAD, so the default never fires and every detached session logs `"branch": ""` |
| git invoked with a scrubbed env      | `git_project()` byte-identical in two hooks; ~20 bare `git -C` call sites elsewhere                                        | with `GIT_DIR` exported, `git -C <scratch>` reports the OUTER repo's branch — so a guard can judge a different repository than the one the command runs in                                                  |

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

## Decision

`lib/hook-facts.sh` — a SIBLING of `lib/command-scan.sh`, not an extension of it.
`command-scan.sh` owns what a payload SAYS: the command, the tool name, which part of it is a
command rather than text. The new file owns what the ENVIRONMENT says: which file is being written,
which repository a command acts on, which branch that repository is on, and how git must be invoked
for those answers to be about the repository the command actually runs in. Each file stays
answerable for one question, and `hook-facts.sh` sources `command-scan.sh`, so a hook needs one
source line rather than two.

**The consolidation is a decision, not a merge.** Two divergences survive as NAMED MODES of
`hook_effective_repo`, each carrying the measurement behind it:

- `first-nonempty` — `worktree-cwd-guard`'s deliberate fail-safe. That guard blocks only on POSITIVE
  confirmation that the command lands in the main checkout, so naming an unresolvable `-C` target
  and then declining to block IS the correct outcome. Validating instead would silently retarget the
  guard at the session repository and block a destructive command aimed somewhere else. It has no
  `.` fallback because that fallback once resolved to the hook's OWN checkout and blocked there.
- `session` — `branch-guard`'s `BASE_DIR` deliberately ignores `git -C`, because a branch lands where
  the session is and in a compound command the `-C` usually belongs to some other invocation
  (`git checkout -b feat/x && git -C <other> status`).

The third mode, `validated`, is what `branch-guard` and `pre-push-check` take: they must name SOME
repository, because their verdict is about the branch it is on.

`hook_current_branch` applies its default to the VALUE, and takes the default from the CALLER —
callers need different ones. An eval log wants a word a reader can see; `branch-guard` and
`pre-push-check` KEY ON EMPTINESS to recognise a detached HEAD and must be able to ask for `""`. A
reader that imposed a word would have silently disabled both of those checks.

`hook_json_object` gives the record WRITERS the same jq → python3 → refuse ladder as the readers.
Repairing only the read would have left the metrics just as empty on a host without jq, because two
of the three hooks also wrote their record with `jq -cn`.

`branch-guard` now fails CLOSED when no repository can be read at all. Previously the branch came
back empty, an empty branch matched no protected name, and the hook exited 0 — "I could not verify"
wearing the costume of "I verified this is fine", which the hook protocol reads as a pass. A
detached HEAD is deliberately NOT that case and still falls through.

## Stated limits

- The transcript queries in `correction-detect` and `revert-detect` stay on jq. They are jq PROGRAMS
  over a JSONL file, not payload field reads, so without jq those hooks are degraded rather than
  silent — which is the distinction the payload read got wrong.
- `hook_effective_repo session` judges `git -C <other> checkout -b` against the session repository.
  That over-permits a rare form instead of refusing a common one, and is the pre-existing choice
  being preserved rather than a new one.

## Test Plan

`scripts/harness/__tests__/hook-facts.test.mjs` — 23 cases. 19 of the first 21 failed against the
hooks as they stood; the two that passed are deliberate controls, so a green run cannot mean the
probe never ran (the formatter shim is wired, and the PATH farm really does hide jq while keeping
python3). Per fact:

1. **file_path** — a name containing an escaped quote and a name containing a backslash both reach
   the formatter, with an ordinary path as the control; plus a source-level floor that no hook
   hand-rolls a `file_path` grep.
2. **reading a JSON field** — `spec-first-gate` still injects its reminder and `correction-detect`
   still writes its record on a PATH farm from which jq is genuinely ABSENT (a symlink farm, not a
   failing shim: a present-but-broken tool exercises a path a tool-less host never takes); plus a
   floor that no hook carries its own `read_json()`.
3. **which repository** — the three named modes pinned individually, including that `validated` is
   not fooled by an ambient `GIT_DIR` and that `first-nonempty` keeps naming an unvalidated `-C`
   target; `branch-guard` judging the session repository when the `-C` target is not one; the
   fail-closed refusal, with the detached-HEAD pass-through pinned beside it so the refusal cannot
   swallow it later; plus a floor that no hook hand-rolls the validation ladder.
4. **the current branch** — the default applied to the value, the empty default a guard needs, and
   `eval-log-stop` recording a named branch for a detached session.
5. **scrubbed git** — `branch-guard` still refusing a commit and a push on `main` with `GIT_DIR`,
   `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_PREFIX` exported at another checkout;
   `worktree-cwd-guard` still seeing the MAIN checkout when `GIT_DIR` names a worktree; plus a floor
   that no hook calls `git -C` directly.

Full suite: `npx vitest run scripts/harness/__tests__/ --reporter=basic`, `pnpm harness:scan`, and
`bash -n` over every hook.

## User Execution Test Scenarios

Not applicable — this changes agent-harness hooks only. The hooks are invoked by the tool host
around the agent's own tool calls and deliver no runnable user-facing behaviour, so there is no
product surface to execute. Verification lives in `## Test Plan`, where every case runs the real
hook against a scratch repository rather than inspecting its source.
