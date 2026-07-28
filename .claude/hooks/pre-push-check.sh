#!/bin/bash
# pre-push-check.sh
# Before git push: cheap, fast branch-hygiene + lockfile gates ONLY.
# 1. Branch-base hygiene (no foreign merge commits over origin/develop)
# 2. Verify pnpm-lock.yaml is committed and in sync
# The heavy typecheck/lint/test re-runs were removed (HARNESS-DIET-006):
# .husky/pre-push (harness:pre-push) and CI already own those gates.
# Runs as a PreToolUse hook on Bash tool calls.

set -euo pipefail

INPUT=$(cat)

# One parser, not four. `command-scan.sh` explains what each hand-rolled copy got wrong; the short
# version is that the old `grep -o '"command"…"[^"]*"' ` stopped at the first quote inside the
# command, so everything after `-m "…"` — including the verb being guarded — was never examined.
# shellcheck source=lib/command-scan.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/command-scan.sh"

TOOL_NAME=$(hook_tool_name_of "$INPUT")

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

if ! COMMAND=$(hook_command_of "$INPUT"); then
  echo "[pre-push-check] Blocked: the tool command could not be decoded, so the push cannot be judged." >&2
  echo "[pre-push-check] Install jq or python3 so this guard can read what it is judging." >&2
  exit 2
fi

# Heredoc bodies and comments are text; only the rest is a command. Shared with the other Bash
# hooks so all three answer "what will run" the same way.
COMMAND_EXEC=$(hook_executable_part "$COMMAND")
COMMAND_VERBS=$(hook_verb_scan "$COMMAND")

# Only intercept git push commands (tolerating env prefixes + global git flags like `git -C <path>`).
#
# Matched at any STATEMENT boundary, not only at the start of the command. The `^`-anchored version
# fired only when the whole command began with `git push`, so every compound form slipped past it
# silently — and `cd <repo> && git push`, or a multi-line block whose push is on a later line, is how
# a push is normally written here. Measured 2026-07-27: EVERY push in a long session bypassed this
# guard, which is why the branch-hygiene rule it enforces kept being violated. The guard existed, was
# registered, and was unreachable from the way commands are actually issued — enforcement that no
# real invocation can reach is indistinguishable from no enforcement.
#
# Boundaries are STATEMENT separators only — line start, `;`, `&&`, `||`, `|`, `(`, and the literal
# `\n` that survives JSON extraction. Bare whitespace is NOT a boundary, deliberately: with it,
# `gh pr create --body "… git push …"` and `git commit -m "fix: git push guard"` both match, and a
# guard that blocks ordinary work is one that gets switched off.
#
# THE CEILING, stated rather than discovered later. This is `grep` over a command string; it does not
# understand shell quoting, so a separator INSIDE a quoted argument —
# `git commit -m 'note: cd x; git push'` — reads as a real one and the hook runs. That is a genuine
# false positive and the trade is deliberate: a missed push cost a promotion-ancestry break, while a
# spurious run costs one lockfile check and passes silently on a clean branch. Understanding quoting
# needs the shell-aware extraction filed as HARNESS-061, not a longer regex.
#
# That false positive does not reproduce today only because the shared COMMAND extraction truncates
# at the first escaped quote, so the text after `--body \"` is never seen (HARNESS-061). It would
# come alive the moment that extraction is repaired — so it is excluded here rather than left as a
# trap for whoever fixes it.
# `\n` appears as the two literal characters backslash-n: the command arrives as JSON and is read
# with grep, not a JSON parser, so a multi-line block keeps its escapes. That form — `cd <repo>` on
# one line, `git push` on the next — is exactly the one that slipped through, so it is a boundary too.
# A quote is a boundary too. `bash -c "git push origin main"` really runs a push, and
# hook_blank_quoted_args deliberately leaves that string intact — but the character before the
# verb is then `"`, so without this the preserved string matched nothing and the exception was
# decorative. Elsewhere quoted content is already blanked, so this cannot resurrect the
# false positive it sits next to.
printf '%s' "$COMMAND_VERBS" | grep -qE '(^|[;&|({"'"'"'])[[:space:]]*(\S+=\S+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+\S+[[:space:]]+)*push([[:space:]]|$)' || exit 0

# Worktree-aware context resolution (parallel-wave lesson): judge the repo the command actually runs
# in — `git -C <path>` in the command > hook-input `cwd` > project dir — never blindly the main clone.
HOOK_CWD=$(hook_cwd_of "$INPUT" || true)
# One extractor, matched against a masked command so a quoted mention of `git -C` cannot
# redirect this guard at another repository. See lib/command-scan.sh.
GIT_C_PATH=$(hook_git_c_path "$COMMAND_EXEC" || true)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
if [[ -n "$HOOK_CWD" ]] && git -C "$HOOK_CWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  PROJECT_DIR="$HOOK_CWD"
fi
if [[ -n "$GIT_C_PATH" ]] && git -C "$GIT_C_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  PROJECT_DIR="$GIT_C_PATH"
fi

echo "[pre-push-check] Running fast pre-push gates (branch hygiene, lockfile sync)..." >&2

# ── 0. Branch-base hygiene (git-branch.md: feature branches start from origin/develop) ──────────
# After a develop→main promotion, `main` sits AHEAD of `develop`. A branch cut from `main` (or that
# merged one in) and PR'd to develop carries the promotion's merge commits in its `origin/develop..HEAD`
# range, which land in the PR range and fail commitlint. A clean feature/docs branch has ZERO merge
# commits over origin/develop. Skip integration/detached branches and when origin/develop is absent.
CUR_BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "")
case "$CUR_BRANCH" in
  # release/* and hotfix/* are promotion branches — they LEGITIMATELY carry the `git merge --no-ff origin/main`
  # that records main's ancestry into a develop→main promotion (INFRA-051, built by
  # scripts/harness/promote.mjs), so exempt them from the "no foreign merge commits" check that targets
  # feature branches accidentally based on `main`.
  main | master | develop | release/* | hotfix/* | "") : ;;
  *)
    if git -C "$PROJECT_DIR" rev-parse --verify --quiet origin/develop >/dev/null 2>&1; then
      FOREIGN_MERGES=$(git -C "$PROJECT_DIR" log --merges --oneline origin/develop..HEAD 2>/dev/null || true)
      if [ -n "$FOREIGN_MERGES" ]; then
        echo "[pre-push-check] Blocked: branch '$CUR_BRANCH' carries merge commits in its range over origin/develop:" >&2
        echo "$FOREIGN_MERGES" | sed 's/^/[pre-push-check]   /' >&2
        echo "[pre-push-check] It was likely based on 'main' (ahead of develop after a promotion), not origin/develop." >&2
        echo "[pre-push-check] Re-base on develop: git reset --hard origin/develop && git cherry-pick <your-commit(s)>" >&2
        exit 2
      fi
    fi
    ;;
esac

# ── 1. Lockfile sync check ──────────────────────────────────────────────────

if ! git -C "$PROJECT_DIR" diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml has uncommitted changes. Commit the lockfile before pushing." >&2
  exit 2
fi

if ! git -C "$PROJECT_DIR" diff --cached --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml is staged but not committed. Commit it first." >&2
  exit 2
fi

cd "$PROJECT_DIR"

pnpm install --prefer-offline --silent 2>/dev/null || pnpm install --silent 2>/dev/null || true

if ! git -C "$PROJECT_DIR" diff --quiet pnpm-lock.yaml 2>/dev/null; then
  echo "[pre-push-check] Blocked: pnpm-lock.yaml is out of sync with package.json files." >&2
  echo "[pre-push-check] Run: pnpm install && git add pnpm-lock.yaml && git commit -m 'chore: update lockfile'" >&2
  git -C "$PROJECT_DIR" checkout -- pnpm-lock.yaml 2>/dev/null || true
  exit 2
fi

echo "[pre-push-check] Branch hygiene + lockfile checks passed. Proceeding with push." >&2
exit 0
