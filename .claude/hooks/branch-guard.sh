#!/bin/bash
# branch-guard hook
# Blocks git commit on protected branches (main, master, develop).
# Blocks git push on main/master only (develop push after merge is allowed).
# Runs as a PreToolUse hook on Bash tool calls.
#
# Dependencies: git, grep, sed (POSIX standard — no jq required)

set -euo pipefail

INPUT=$(cat)

# Extract tool_name without jq — match "tool_name":"Bash"
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Extract command from tool_input.command
COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

# Detect git action type
IS_COMMIT=false
IS_PUSH=false
IS_MERGE=false
IS_BRANCH_CREATE=false
IS_GH_DELETE_BRANCH=false
echo "$COMMAND" | grep -qE '^\s*git\s+commit\b' && IS_COMMIT=true
echo "$COMMAND" | grep -qE '^\s*git\s+(push|push\s)' && IS_PUSH=true
echo "$COMMAND" | grep -qE '^\s*git\s+merge\b' && IS_MERGE=true
echo "$COMMAND" | grep -qE '^\s*git\s+checkout\s+-b\b' && IS_BRANCH_CREATE=true
echo "$COMMAND" | grep -qE '^\s*git\s+switch\s+-c\b' && IS_BRANCH_CREATE=true
# `gh pr merge --delete-branch` is banned (git-branch.md): it once deleted the
# develop integration branch. Match ONLY when --delete-branch is an actual argument
# of a `gh pr merge` invocation — strip shell comments first, then require the flag
# to sit in the same command segment as `gh pr merge` (no intervening ; | &). This
# avoids false positives from the flag mentioned in a comment or a separate echo.
COMMAND_NO_COMMENTS=$(printf '%s' "$COMMAND" | sed 's/[[:space:]]#[^"]*$//')
if printf '%s' "$COMMAND_NO_COMMENTS" | grep -qE 'gh[[:space:]]+pr[[:space:]]+merge\b[^|;&]*--delete-branch'; then
  IS_GH_DELETE_BRANCH=true
fi

if [[ "$IS_GH_DELETE_BRANCH" == "true" ]]; then
  echo "[branch-guard] Blocked: '--delete-branch' is prohibited in 'gh pr merge'. Zero exceptions." >&2
  echo "[branch-guard] It once deleted the develop integration branch. Merge without it, then delete" >&2
  echo "[branch-guard] only on explicit user request: git branch -D <name> (local) /" >&2
  echo "[branch-guard] gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<name> (remote)." >&2
  exit 2
fi

# --- L2: never delete a REMOTE branch until its PR is confirmed MERGED (git-branch.md) ---
# A branch deleted while its PR is unmerged CLOSES/orphans the PR (this happened once: a delete
# ran right after a `gh pr merge` that had actually failed DIRTY). Gate remote-branch deletion on
# a confirmed merged PR. Matches: `gh api -X DELETE .../git/refs/heads/<name>`,
# `git push <remote> --delete <name>`, `git push <remote> :<name>`.
DELETE_BRANCH_NAME=""
# Scan only the command up to the first heredoc opener (`<<`): everything after it is DATA
# (e.g. a `git commit -F - <<'EOF' …` message that may legitimately mention `git push --delete`
# or `refs/heads/`), not an executed command. This prevents a commit message from tripping the guard.
DELETE_SCAN="${COMMAND_NO_COMMENTS%%<<*}"
if printf '%s' "$DELETE_SCAN" | grep -qE 'gh[[:space:]]+api[^|;&]*-X[[:space:]]+DELETE[^|;&]*/git/refs/heads/'; then
  DELETE_BRANCH_NAME=$(printf '%s' "$DELETE_SCAN" | sed -E 's#.*/git/refs/heads/([A-Za-z0-9._/-]+).*#\1#')
elif printf '%s' "$DELETE_SCAN" | grep -qE 'git[[:space:]]+push[[:space:]]+[^[:space:]-][^[:space:]]*[[:space:]]+(--delete[[:space:]]|:)'; then
  DELETE_BRANCH_NAME=$(printf '%s' "$DELETE_SCAN" | sed -E 's#.*git[[:space:]]+push[[:space:]]+[^[:space:]]+[[:space:]]+(--delete[[:space:]]+|:)([A-Za-z0-9._/-]+).*#\2#')
fi

if [[ -n "$DELETE_BRANCH_NAME" && "${BRANCH_GUARD_ALLOW_DELETE:-0}" != "1" ]]; then
  if printf '%s' "$DELETE_BRANCH_NAME" | grep -qE '^(main|master|develop|gh-pages)$'; then
    echo "[branch-guard] Blocked: refusing to delete protected branch '$DELETE_BRANCH_NAME'." >&2
    exit 2
  fi
  MERGED_COUNT=""
  if command -v gh >/dev/null 2>&1; then
    MERGED_COUNT=$(gh pr list --head "$DELETE_BRANCH_NAME" --state merged --json number --jq 'length' 2>/dev/null || echo "")
  fi
  if [[ -z "$MERGED_COUNT" ]]; then
    echo "[branch-guard] Blocked: cannot confirm a MERGED PR for '$DELETE_BRANCH_NAME' (gh unavailable / query failed)." >&2
    echo "[branch-guard] Verify the merge landed (gh pr view <n> --json state == MERGED), then override: BRANCH_GUARD_ALLOW_DELETE=1" >&2
    exit 2
  fi
  if [[ "$MERGED_COUNT" == "0" ]]; then
    echo "[branch-guard] Blocked: branch '$DELETE_BRANCH_NAME' has NO merged PR — deleting it now would orphan/close an unmerged PR." >&2
    echo "[branch-guard] Confirm the merge FIRST: gh pr view <n> --json state must be MERGED." >&2
    echo "[branch-guard] Intentional abandon of an unmerged branch? Override: BRANCH_GUARD_ALLOW_DELETE=1" >&2
    exit 2
  fi
  # MERGED_COUNT >= 1 → the PR merged; deletion is safe. Fall through.
fi

if [[ "$IS_COMMIT" == "false" && "$IS_PUSH" == "false" && "$IS_MERGE" == "false" && "$IS_BRANCH_CREATE" == "false" ]]; then
  exit 0
fi

# Get current branch
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
CURRENT_BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "")

if [[ -z "$CURRENT_BRANCH" ]]; then
  exit 0
fi

# Block new branch creation when local branches have commits not yet in main.
# Uses git rev-list --count main..<branch>: non-zero means unmerged commits exist.
# This correctly handles squash-merged branches (their commits appear reachable
# from main after squash) as long as the local branch pointer is deleted post-merge.
if [[ "$IS_BRANCH_CREATE" == "true" && "${BRANCH_GUARD_ALLOW_OPEN_BRANCHES:-0}" != "1" ]]; then
  UNMERGED_BRANCHES=()
  SKIP_PATTERNS="^(main|master|develop|gh-pages)$"
  while IFS= read -r candidate; do
    candidate="${candidate#  }"   # strip leading spaces
    candidate="${candidate#\* }"  # strip current-branch marker
    [[ "$candidate" =~ $SKIP_PATTERNS ]] && continue
    [[ -z "$candidate" ]] && continue
    ahead=$(git -C "$PROJECT_DIR" rev-list --count "main..$candidate" 2>/dev/null || echo 0)
    if [[ "$ahead" -gt 0 ]]; then
      UNMERGED_BRANCHES+=("$candidate ($ahead commits ahead of main)")
    fi
  done < <(git -C "$PROJECT_DIR" branch 2>/dev/null)

  if [[ "${#UNMERGED_BRANCHES[@]}" -gt 0 ]]; then
    echo "[branch-guard] Blocked: local branches with unmerged commits detected." >&2
    echo "[branch-guard] Merge or delete them before creating a new branch:" >&2
    for b in "${UNMERGED_BRANCHES[@]}"; do
      echo "  - $b" >&2
    done
    echo "[branch-guard] After squash-merge via PR, delete the local branch: git branch -D <name>" >&2
    echo "[branch-guard] To override: set BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1" >&2
    exit 2
  fi
fi

# Enforce feature branch naming convention <type>/<desc> (git-branch.md).
# Long-lived branches are exempt; override with BRANCH_GUARD_ALLOW_BADNAME=1.
if [[ "$IS_BRANCH_CREATE" == "true" && "${BRANCH_GUARD_ALLOW_BADNAME:-0}" != "1" ]]; then
  NEW_BRANCH=$(printf '%s' "$COMMAND" | sed -E 's/.*(checkout[[:space:]]+-b|switch[[:space:]]+-c)[[:space:]]+([^[:space:]]+).*/\2/')
  BRANCH_NAME_RE='^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert|release|hotfix)/[a-z0-9][a-z0-9._/-]*$'
  EXEMPT_RE='^(main|master|develop|gh-pages)$'
  if [[ -n "$NEW_BRANCH" && ! "$NEW_BRANCH" =~ $EXEMPT_RE && ! "$NEW_BRANCH" =~ $BRANCH_NAME_RE ]]; then
    echo "[branch-guard] Blocked: branch name '$NEW_BRANCH' does not match <type>/<desc>." >&2
    echo "[branch-guard] Expected e.g. feat/x-y, fix/z, chore/w" >&2
    echo "[branch-guard] (types: feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert|release|hotfix)." >&2
    echo "[branch-guard] Override: BRANCH_GUARD_ALLOW_BADNAME=1" >&2
    exit 2
  fi
fi

# Block commit on all protected branches
# Exception: allow merge commits (when .git/MERGE_HEAD exists — completing a git merge)
if [[ "$IS_COMMIT" == "true" ]]; then
  MERGE_IN_PROGRESS=false
  [[ -f "$PROJECT_DIR/.git/MERGE_HEAD" ]] && MERGE_IN_PROGRESS=true
  if [[ "$MERGE_IN_PROGRESS" == "false" ]]; then
    for branch in main master develop; do
      if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
        echo "[branch-guard] Blocked: cannot git commit on protected branch '${branch}'. Create a feature branch first." >&2
        exit 2
      fi
    done
  fi
fi

# Block push on main/master only (develop push after merge is allowed)
# Exception: BRANCH_GUARD_ALLOW_MAIN_MERGE=1 for explicitly user-approved release pushes
if [[ "$IS_PUSH" == "true" && "${BRANCH_GUARD_ALLOW_MAIN_MERGE:-0}" != "1" ]]; then
  for branch in main master; do
    if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
      echo "[branch-guard] Blocked: cannot git push on protected branch '${branch}'." >&2
      exit 2
    fi
  done
fi

# Block merge into main/master (release merge requires explicit user approval via PR)
# Exception: BRANCH_GUARD_ALLOW_MAIN_MERGE=1 for explicitly user-approved release merges
if [[ "$IS_MERGE" == "true" && "${BRANCH_GUARD_ALLOW_MAIN_MERGE:-0}" != "1" ]]; then
  for branch in main master; do
    if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
      echo "[branch-guard] Blocked: cannot git merge into '${branch}'. Use a PR or get explicit user approval for release merges." >&2
      exit 2
    fi
  done
fi

exit 0
