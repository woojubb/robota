#!/usr/bin/env bash
# Run a command holding a lock shared by every worktree of this clone.
#
# WHY THIS EXISTS. `worktree-parallel-orchestration` runs several agents at once, each in its own
# worktree, and the isolation is real for the working tree and the index. It is NOT real for
# `refs/stash`, which is a single ref on the shared object store.
#
# `lint-staged` uses `git stash` INTERNALLY to back up unstaged changes for the duration of the
# pre-commit hook. Measured 2026-08-01, during a five-agent wave, in an agent that never invoked
# `git stash` itself:
#
#     [STARTED] Cleaning up temporary files...
#     [FAILED] lint-staged automatic backup is missing!
#     husky - pre-commit script failed (code 1)
#
# A concurrent stash operation in another worktree destroyed the backup ref. So the exposure is not
# "agents who type `git stash`" — it is every agent on every commit, and the thing at risk is exactly
# the uncommitted work `lint-staged` is holding on the author's behalf. That run recovered; "backup
# is missing" is the state in which it would not have. (INFRA-082)
#
# WHY A LOCK RATHER THAN `--no-stash`. `--no-stash` removes the backup instead of protecting it, so
# a failing task can lose unstaged work — trading a rare race for a routine one. The critical section
# here is seconds long and per-clone, so serialising it costs a wait and never a file.
#
# The lock lives beside the shared object store (`--git-common-dir`), because that is precisely the
# scope of what is shared: one lock per clone, held across all of its worktrees.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "[with-repo-lock] Blocked: no command given. Refusing rather than reporting success over nothing." >&2
  exit 2
fi

COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
if [[ -z "$COMMON_DIR" || ! -d "$COMMON_DIR" ]]; then
  # Fail closed. Running unserialised here would be the exact hazard this exists to remove, and a
  # command that cannot locate its repository has a bigger problem than the lock.
  echo "[with-repo-lock] Blocked: cannot resolve the shared git directory, so the lock has no home." >&2
  echo "[with-repo-lock] Run this inside a git repository." >&2
  exit 2
fi

LOCK_FILE="$COMMON_DIR/robota-hook.lock"

if ! command -v flock >/dev/null 2>&1; then
  # Stated limit, not a silent one: without flock the command still runs, because refusing every
  # commit on a host that lacks a util-linux tool is worse than the race it prevents. It says so, so
  # a "backup is missing" failure here is traceable to this line rather than mysterious.
  echo "[with-repo-lock] flock is unavailable — running WITHOUT the cross-worktree lock." >&2
  echo "[with-repo-lock] Concurrent commits in sibling worktrees can destroy each other's" >&2
  echo "[with-repo-lock] lint-staged backup. See INFRA-082." >&2
  exec "$@"
fi

# `-w` rather than a blocking wait: a lock that can hang forever turns one stuck hook into a stuck
# clone. Ten minutes is far beyond any observed lint-staged run and far below "someone will not
# notice".
exec flock -w 600 "$LOCK_FILE" "$@"
