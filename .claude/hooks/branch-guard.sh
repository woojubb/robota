#!/bin/bash
# branch-guard hook
# Blocks git commit on protected branches (main, master, develop).
# Blocks git push on main/master only (develop push after merge is allowed).
# Runs as a PreToolUse hook on Bash tool calls.
#
# Dependencies: git, grep, sed (POSIX standard — no jq required)

set -euo pipefail

INPUT=$(cat)

# One parser, not four. `command-scan.sh` explains what each hand-rolled copy got wrong; the short
# version is that the old `grep -o '"command"…"[^"]*"' ` stopped at the first quote inside the
# command, so everything after `-m "…"` — including the verb being guarded — was never examined.
# shellcheck source=lib/command-scan.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/command-scan.sh"

# Extract tool_name without jq — match "tool_name":"Bash"
TOOL_NAME=$(hook_tool_name_of "$INPUT")

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Extract command from tool_input.command
if ! COMMAND=$(hook_command_of "$INPUT"); then
  echo "[branch-guard] Blocked: the tool command could not be decoded, so it cannot be judged." >&2
  echo "[branch-guard] Install jq or python3 so this guard can read what it is judging." >&2
  exit 2
fi

# Honor inline override tokens written IN the command string (e.g. `BRANCH_GUARD_ALLOW_DELETE=1 git push …`).
# The `VAR=1` prefix runs in the TOOL's shell, not this hook's process, so a plain env check never sees it —
# the documented overrides were unusable inline until this. Worktree-parallel subagents rely on
# BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1 to each carry their own concurrent branch (git-branch.md § Git Worktree).
# The executable part, computed BEFORE the overrides are read: an override named inside a heredoc
# body is text, and text must not be able to switch this guard off.
COMMAND_EXEC=$(hook_executable_part "$COMMAND")
# Verb detection reads the same command with quoted ARGUMENTS blanked; extraction below keeps them,
# because branch names and `-C` paths are routinely quoted.
COMMAND_VERBS=$(hook_verb_scan "$COMMAND")

if printf '%s' "$COMMAND_EXEC" | grep -qE '(^|[[:space:];&])BRANCH_GUARD_ALLOW_DELETE=1([[:space:]]|$)'; then
  BRANCH_GUARD_ALLOW_DELETE=1
fi
if printf '%s' "$COMMAND_EXEC" | grep -qE '(^|[[:space:];&])BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1([[:space:]]|$)'; then
  BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1
fi
if printf '%s' "$COMMAND_EXEC" | grep -qE '(^|[[:space:];&])BRANCH_GUARD_ALLOW_BADNAME=1([[:space:]]|$)'; then
  BRANCH_GUARD_ALLOW_BADNAME=1
fi

# Resolve the git context the COMMAND will actually run in (worktree-aware — parallel-wave lesson):
# a worktree agent's commit/push was judged against the MAIN clone's branch (CLAUDE_PROJECT_DIR),
# producing false blocks. Precedence: `git -C <path>` in the command > hook-input `cwd` > project dir.
HOOK_CWD=$(hook_cwd_of "$INPUT" || true)
# Unanchored: `git -C <path>` is almost never the first thing on the line (`cd /elsewhere && git -C
# <repo> commit`). The `^`-anchored version simply never found it, so the hook fired and then judged
# whichever checkout it happened to sit in — passing a commit it should have refused.
# `|| true` is load-bearing: grep exits 1 when the command has no `-C`, which is the common case, and
# under `set -euo pipefail` a failed command substitution ABORTS the hook — silently, exit 1, before
# a single check runs. That is a total bypass wearing the costume of a passing guard.
# One extractor, matched against a masked command so a quoted mention of `git -C` cannot
# redirect this guard at another repository. See lib/command-scan.sh.
GIT_C_PATH=$(hook_git_c_path "$COMMAND_EXEC" || true)
EFFECTIVE_DIR="${CLAUDE_PROJECT_DIR:-.}"
if [[ -n "$HOOK_CWD" ]] && git -C "$HOOK_CWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  EFFECTIVE_DIR="$HOOK_CWD"
fi
if [[ -n "$GIT_C_PATH" ]] && git -C "$GIT_C_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  EFFECTIVE_DIR="$GIT_C_PATH"
fi

# Detect git action type
IS_COMMIT=false
IS_PUSH=false
IS_MERGE=false
IS_BRANCH_CREATE=false
IS_GH_DELETE_BRANCH=false
# GITPFX tolerates global git flags before the subcommand — `git -C <path> commit`, `git -c k=v push` —
# which previously slipped past every action regex (worktree-blindness, parallel-wave lesson).
#
# It matches at any STATEMENT boundary, not only at the start of the command. The `^`-anchored
# version fired only when the WHOLE command began with the verb — and a branch is created as
# `cd <repo> && git checkout -b …`, a commit made after a `cd`, a merge on a later line of a block.
# Measured 2026-07-28 against a scratch repository on `main`: commit, push, merge, `checkout -b` and
# `switch -c` were ALL bypassed in 4 of the 5 shapes commands are actually written in here. The
# branch-create guard had therefore never fired on a real branch creation. Same defect #1510 removed
# from pre-push-check; it lived here in a variable and was reused for every action. A guard no real
# invocation reaches is indistinguishable from no guard.
#
# Boundaries are line start, `;`, `&&`, `||`, `|`, `(`, whitespace, and the literal `\n` that
# survives JSON extraction (the command is read with grep, not a JSON parser, so a multi-line block
# keeps its escapes — and that is the shape that slipped through).
# A heredoc BODY is data, not commands. `git commit -F - <<'EOF' … EOF` carries prose that may
# quote a git invocation — this hook blocked a commit whose MESSAGE contained
# "branches are made as `cd <repo> && git checkout -b …`", reading the sentence as the act it
# describes. Verb detection therefore runs over the command with heredoc bodies removed.
#
# Deliberately narrow: it strips only `<<MARKER … MARKER`, whose boundaries are unambiguous. A verb
# inside an ordinary quoted argument (`-m 'run git checkout -b x'`) still matches, because telling
# quoting apart needs the shell-aware extraction filed as HARNESS-061, not a longer regex here.

# A quote is a boundary too. `bash -c "git push origin main"` really runs a push, and
# hook_blank_quoted_args deliberately leaves that string intact — but the character before the
# verb is then `"`, so without this the preserved string matched nothing and the exception was
# decorative. Elsewhere quoted content is already blanked, so this cannot resurrect the
# false positive it sits next to.
GITPFX='(^|[;&|({"'"'"']|[[:space:]])[[:space:]]*(\S+=\S+\s+)*git\s+((-C|-c)\s+\S+\s+)*'
# Trailing boundary: anything that is not a word character or `-`. `\b` alone let `git merge-base`
# read as a merge and `git commit-tree` as a commit — false positives that, now that the leading
# match is loose, would block ordinary read-only work on a protected branch. It also covers the verb
# ending a line (`git commit\ngit push`), which a bare `(\s|$)` misses.
GITEND='([^-[:alnum:]_]|$)'
echo "$COMMAND_VERBS" | grep -qE "${GITPFX}commit${GITEND}" && IS_COMMIT=true
echo "$COMMAND_VERBS" | grep -qE "${GITPFX}push${GITEND}" && IS_PUSH=true
echo "$COMMAND_VERBS" | grep -qE "${GITPFX}merge${GITEND}" && IS_MERGE=true
# Tolerate flags between the subcommand and the create flag (e.g. `git checkout -q -b x`, which
# previously slipped past the create-guard entirely). `-B`/`-C` are the force-create spellings and
# create a branch just as much as `-b`/`-c` do.
echo "$COMMAND_VERBS" | grep -qE "${GITPFX}checkout\s+(-\S+\s+)*-[bB]${GITEND}" && IS_BRANCH_CREATE=true
echo "$COMMAND_VERBS" | grep -qE "${GITPFX}switch\s+(-\S+\s+)*-[cC]${GITEND}" && IS_BRANCH_CREATE=true
# `gh pr merge --delete-branch` is banned (git-branch.md): it once deleted the
# develop integration branch. Match ONLY when --delete-branch is an actual argument
# of a `gh pr merge` invocation — strip shell comments first, then require the flag
# to sit in the same command segment as `gh pr merge` (no intervening ; | &). This
# avoids false positives from the flag mentioned in a comment or a separate echo.
COMMAND_NO_COMMENTS="$COMMAND_EXEC"
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
DELETE_SCAN="$COMMAND_NO_COMMENTS"
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

  # A merged PR in the branch's history is NOT proof that nothing is open on it NOW.
  #
  # Measured 2026-07-26: `fix/d4-scope-calculator` carried two merged PRs (#1484, #1485) from earlier
  # reuses of the same branch name. #1483 was open and CONFLICTING at the time — never merged. The
  # merged-count check saw `2`, allowed the deletion, and GitHub closed #1483 as a result. The exact
  # outcome this guard exists to prevent, waved through by the guard itself.
  #
  # So ask the question that actually matters: is anything OPEN on this branch right now?
  OPEN_COUNT=""
  if command -v gh >/dev/null 2>&1; then
    OPEN_COUNT=$(gh pr list --head "$DELETE_BRANCH_NAME" --state open --json number --jq 'length' 2>/dev/null || echo "")
  fi
  if [[ -z "$OPEN_COUNT" ]]; then
    echo "[branch-guard] Blocked: cannot confirm whether an OPEN PR exists for '$DELETE_BRANCH_NAME' (gh unavailable / query failed)." >&2
    echo "[branch-guard] Unable to determine is not the same as safe. Check by hand, then override: BRANCH_GUARD_ALLOW_DELETE=1" >&2
    exit 2
  fi
  if [[ "$OPEN_COUNT" != "0" ]]; then
    OPEN_LIST=$(gh pr list --head "$DELETE_BRANCH_NAME" --state open --json number,mergeStateStatus \
      --jq '[.[] | "#\(.number) (\(.mergeStateStatus))"] | join(", ")' 2>/dev/null || echo "")
    echo "[branch-guard] Blocked: '$DELETE_BRANCH_NAME' still has an OPEN PR — $OPEN_LIST." >&2
    echo "[branch-guard] Deleting it now CLOSES that PR. A merged PR earlier in this branch's history does not make deletion safe." >&2
    echo "[branch-guard] Merge or close it deliberately first. Intentional abandon? Override: BRANCH_GUARD_ALLOW_DELETE=1" >&2
    exit 2
  fi
  # A merged PR exists AND nothing is open on the branch → deletion is safe. Fall through.
fi

if [[ "$IS_COMMIT" == "false" && "$IS_PUSH" == "false" && "$IS_MERGE" == "false" && "$IS_BRANCH_CREATE" == "false" ]]; then
  exit 0
fi

# Get current branch of the EFFECTIVE context (worktree-aware, see resolution above)
PROJECT_DIR="$EFFECTIVE_DIR"
CURRENT_BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "")

if [[ -z "$CURRENT_BRANCH" ]]; then
  exit 0
fi

# Block new branch creation when local branches have commits not yet in the INTEGRATION branch.
# `git-branch.md` § One-Branch-At-A-Time names the comparison itself — `git branch --no-merged
# develop` — and this compared against `main`. `main` trails `develop` between promotions, so 53 of
# 140 local branches here were counted unmerged while already being in `develop`. Measured, and a
# straight contradiction of the rule this check enforces.
# This correctly handles squash-merged branches (their commits appear reachable
# from main after squash) as long as the local branch pointer is deleted post-merge.
if [[ "$IS_BRANCH_CREATE" == "true" && "${BRANCH_GUARD_ALLOW_OPEN_BRANCHES:-0}" != "1" ]]; then
  # Prefer the remote-tracking integration head; fall back to local `develop` when offline.
  INTEGRATION_REF=origin/develop
  git -C "$PROJECT_DIR" rev-parse --verify --quiet "$INTEGRATION_REF" >/dev/null 2>&1 || INTEGRATION_REF=develop
  UNMERGED_BRANCHES=()
  SKIP_PATTERNS="^(main|master|develop|gh-pages)$"
  while IFS= read -r candidate; do
    candidate="${candidate#  }"   # strip leading spaces
    candidate="${candidate#\* }"  # strip current-branch marker
    [[ "$candidate" =~ $SKIP_PATTERNS ]] && continue
    [[ -z "$candidate" ]] && continue
    ahead=$(git -C "$PROJECT_DIR" rev-list --count "$INTEGRATION_REF..$candidate" 2>/dev/null || echo 0)
    if [[ "$ahead" -gt 0 ]]; then
      UNMERGED_BRANCHES+=("$candidate ($ahead commits ahead of $INTEGRATION_REF)")
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
  # Read the branch name out of the checkout/switch invocation itself. The previous expression
  # ran a greedy `.*` over the WHOLE command and captured whatever followed the LAST
  # -b/-B/-c/-C, so `git checkout -b feat/x && git -C /other status` yielded /other and
  # refused a correctly named branch. Adding -C to that alternation made a long-standing
  # weakness reachable.
  GIT_PREFIX_RE='((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+|-[^[:space:]]+[[:space:]]+)*'
  NEW_BRANCH=$(printf '%s' "$COMMAND_VERBS" |
    grep -oE "git[[:space:]]+${GIT_PREFIX_RE}(checkout|switch)[[:space:]]+${GIT_PREFIX_RE}-[bBcC][[:space:]]+[^[:space:]]+" |
    head -1 | grep -oE '[^[:space:]]+$' || true)
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
