#!/bin/bash
# worktree-cwd-guard hook (HARNESS-043)
# Blocks DESTRUCTIVE git commands when a worktree-assigned subagent's cwd has silently fallen back
# to the MAIN checkout. This is the TYPE-003 incident: a subagent was assigned an isolated worktree,
# that worktree was externally cleaned/removed mid-session, the process cwd dropped to the main clone,
# and `git reset --hard` then ran against MAIN.
#
# Blocks: `git reset --hard`, `git clean -f[dx]`, `git checkout -- .`, `git push --force*`
# ONLY WHEN BOTH:
#   (a) the command's EFFECTIVE repo resolves to the MAIN checkout — its toplevel path is NOT under
#       `.claude/worktrees/`; AND
#   (b) a worktree-assignment marker is present — the `ROBOTA_AGENT_WORKTREE` env var is set. The
#       worktree launcher (Claude Code `Agent` tool `isolation: "worktree"`) SHOULD export
#       `ROBOTA_AGENT_WORKTREE=<assigned worktree path>` when spawning a worktree subagent, so this
#       guard can tell an assigned-worktree session apart from an ordinary main-clone session.
#
# FAIL-SAFE: if the guard cannot POSITIVELY confirm BOTH main-checkout AND an assigned-worktree
# marker, it does NOT block — ordinary destructive work in the main clone (no marker) and destructive
# work inside the assigned worktree both pass untouched.
#
# Inline override (same convention as branch-guard): prefix the command with
# `WORKTREE_CWD_GUARD_ALLOW_MAIN=1` for a deliberate main-checkout destructive op.
#
# Runs as a PreToolUse hook on Bash tool calls.
# Dependencies: git, grep, sed (POSIX standard — no jq required)

set -euo pipefail

INPUT=$(cat)

# One parser, not four. `command-scan.sh` explains what each hand-rolled copy got wrong; the short
# version is that the old `grep -o '"command"…"[^"]*"' ` stopped at the first quote inside the
# command, so everything after `-m "…"` — including the verb being guarded — was never examined.
# hook-facts.sh sources command-scan.sh, so one line brings in both the payload parser and the
# single owner of the repository, branch and scrubbed-git facts. See lib/hook-facts.sh.
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

# Extract tool_name without jq — match "tool_name":"Bash"
# Fail closed on an unreadable tool name. Left bare, a non-zero return aborts the assignment
# under `set -e` and the hook exits 1 with nothing said — which the hook protocol treats as
# non-blocking. Silent exit and "it is fine" are the two states this file refuses to conflate.
if ! TOOL_NAME=$(hook_tool_name_of "$INPUT"); then
  echo "[worktree-cwd-guard] Blocked: the hook payload names no tool, so nothing can be judged." >&2
  exit 2
fi

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Extract command from tool_input.command
if ! COMMAND=$(hook_command_of "$INPUT"); then
  echo "[worktree-cwd-guard] Blocked: the tool command could not be decoded, so the command cannot be judged." >&2
  echo "[worktree-cwd-guard] Install jq or python3 so this guard can read what it is judging." >&2
  exit 2
fi

# The inline override is checked further down, AFTER the destructive command is identified — not
# here. It has to be, and the reason is the whole shape of this class:
#
#   - The `VAR=1` prefix runs in the TOOL's shell, not this hook's process, so a plain env check
#     never sees it (same reasoning as branch-guard's inline overrides).
#   - Read off the RAW command, a commit message that merely NAMED the token switched the guard off.
#     So it is read off the masked text.
#   - Read as a token ANYWHERE, an unquoted mention still disarmed it — `git commit -m TOKEN &&
#     git reset --hard`. So it must PREFIX a command.
#   - Read as "prefixes SOME git call", a decoy disarmed it — `TOKEN git status && git reset --hard`
#     puts the token on something harmless and the destructive command that follows is never judged.
#
# Each repair was correct and each left the next hole, because the question was being asked about
# the wrong subject. An override is given to ONE command: the one it precedes. So the only check
# that closes it is asked of the destructive statement itself.

# --- (b) worktree-assignment marker -------------------------------------------------------------
# Present iff this session was spawned as a worktree-assigned subagent. Absent → ordinary main-clone
# session → FAIL-SAFE, never block.
# The marker the original design hoped for — `ROBOTA_AGENT_WORKTREE`, exported by the launcher —
# is exported by nothing. Measured 2026-07-30: the only places that set it in this repository are
# this guard's own tests, so in every real session the variable was empty and the guard exited here
# before checking anything. Ten green tests, and a guard that had never once run (INFRA-068).
#
# The session's own cwd cannot answer the question, because a cwd that has fallen back to the main
# checkout is the very condition being guarded. What can answer it is WHICH COPY OF THIS HOOK IS
# RUNNING: a worktree session has `CLAUDE_PROJECT_DIR` pointing at its worktree, and
# `.claude/settings.json` invokes the hook through that variable — so the file executing right now
# lives under `.claude/worktrees/` exactly when this is a worktree session. That is supplied by the
# deployment rather than hoped for from it.
#
# The env marker is still honoured, for a launcher that does export it.
IN_WORKTREE_SESSION=false
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")
case "$SELF_DIR" in */.claude/worktrees/*) IN_WORKTREE_SESSION=true ;; esac
case "${CLAUDE_PROJECT_DIR:-}" in */.claude/worktrees/*) IN_WORKTREE_SESSION=true ;; esac
[[ -n "${ROBOTA_AGENT_WORKTREE:-}" ]] && IN_WORKTREE_SESSION=true

if [[ "$IN_WORKTREE_SESSION" != "true" ]]; then
  exit 0
fi

# --- Detect destructive git commands ------------------------------------------------------------
# Scan only up to the first heredoc opener (`<<`) and strip trailing comments, so a commit message
# or echoed text mentioning these commands cannot trip the guard (same defense as branch-guard).
SCAN=$(hook_executable_part "$COMMAND")
VERBS=$(hook_verb_scan "$COMMAND")

# GITPFX tolerates env prefixes and global git flags before the subcommand (`git -C <path> reset`,
# `git -c k=v push`) — the same pattern branch-guard uses.
#
# A newline is a boundary too. The command arrives decoded as JSON with real newlines, and
# is decoded as JSON now and carries real newlines, so grep's `^` is a line start and the second line
# of `cd <repo>` + newline + `git reset --hard` begins with no whitespace, no `;` and no `&`.
# Measured 2026-07-28: this guard was reachable from `;`, `&&` and env prefixes but silently bypassed
# by exactly that shape — and a destructive command on a later line of a block is the shape of the
# incident it exists to prevent.
# A quote and a backtick are boundaries too: a KEPT region — `bash -c "git push"`, or a backtick
# subshell — puts one immediately before the verb, and without them the region survived masking and
# still matched nothing. Quoted payloads are masked before this runs, so this cannot resurrect the
# false positive it sits beside.
GITPFX='(^|[[:space:];&|({"'"'"'`])([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*'

IS_DESTRUCTIVE=false
# git reset --hard
printf '%s' "$VERBS" | grep -qE "${GITPFX}reset\b[^|;&]*--hard\b" && IS_DESTRUCTIVE=true
# git clean with a force flag (-f, -fd, -fdx, -xf, --force)
printf '%s' "$VERBS" | grep -qE "${GITPFX}clean\b[^|;&]*(-[[:alnum:]]*f|--force)" && IS_DESTRUCTIVE=true
# git checkout -- <path> (discards working-tree changes, e.g. `git checkout -- .`)
printf '%s' "$VERBS" | grep -qE "${GITPFX}checkout\b[^|;&]*[[:space:]]--([[:space:]]|$)" && IS_DESTRUCTIVE=true
# git push --force / --force-with-lease
printf '%s' "$VERBS" | grep -qE "${GITPFX}push\b[^|;&]*--force" && IS_DESTRUCTIVE=true

if [[ "$IS_DESTRUCTIVE" != "true" ]]; then
  exit 0
fi

# --- The inline override, asked of the destructive statement itself ------------------------------
# Split on statement separators and judge each statement alone. A statement that is destructive is
# excused only if the override prefixes THAT statement; the token sitting on a sibling command
# excuses nothing. Every destructive statement must carry it, so a decoy plus a real one still
# refuses. See the note above for the three earlier readings this replaces.
OVERRIDE_RE='^[[:space:]]*([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*WORKTREE_CWD_GUARD_ALLOW_MAIN=1[[:space:]]'
DESTRUCTIVE_STATEMENTS=0
OVERRIDDEN_STATEMENTS=0
while IFS= read -r STATEMENT; do
  [[ -z "${STATEMENT//[[:space:]]/}" ]] && continue
  IS_STMT_DESTRUCTIVE=false
  printf '%s' "$STATEMENT" | grep -qE "${GITPFX}reset\b.*--hard\b" && IS_STMT_DESTRUCTIVE=true
  printf '%s' "$STATEMENT" | grep -qE "${GITPFX}clean\b.*(-[[:alnum:]]*f|--force)" && IS_STMT_DESTRUCTIVE=true
  printf '%s' "$STATEMENT" | grep -qE "${GITPFX}checkout\b.*[[:space:]]--([[:space:]]|$)" && IS_STMT_DESTRUCTIVE=true
  printf '%s' "$STATEMENT" | grep -qE "${GITPFX}push\b.*--force" && IS_STMT_DESTRUCTIVE=true
  [[ "$IS_STMT_DESTRUCTIVE" != "true" ]] && continue
  DESTRUCTIVE_STATEMENTS=$((DESTRUCTIVE_STATEMENTS + 1))
  if printf '%s' "$STATEMENT" | grep -qE "$OVERRIDE_RE"; then
    OVERRIDDEN_STATEMENTS=$((OVERRIDDEN_STATEMENTS + 1))
  fi
# `%s\n`, not `%s`: without a trailing newline `read` drops the final line, which for a single-
# statement command is the only line there is — the override would then never be seen and an
# ordinary, correct invocation would be refused.
done < <(printf '%s\n' "$VERBS" | sed -E 's/(\|\||&&|[;&|])/\n/g')

if [[ "$DESTRUCTIVE_STATEMENTS" -gt 0 && "$OVERRIDDEN_STATEMENTS" -eq "$DESTRUCTIVE_STATEMENTS" ]]; then
  exit 0
fi

# --- Resolve the EFFECTIVE dir the command will actually run in ----------------------------------
# Precedence (worktree-aware, same intent as branch-guard/pre-push-check): `git -C <path>` in the
# command > hook-input `cwd` > CLAUDE_PROJECT_DIR. Unlike branch-guard, we do NOT fall back to `.`
# (the hook's OWN process dir): `.` is wherever the hook binary runs, not where the tool command runs
# — resolving its toplevel would judge an unrelated checkout (this caused a fail-safe bug: a non-git
# cwd fell back to `.`, which resolved to the hook's own checkout and blocked). If no concrete dir can
# be named, we cannot positively confirm anything → FAIL-SAFE, do not block.
HOOK_CWD=$(hook_cwd_of "$INPUT" || true)
# Unanchored: `git -C <path>` is almost never the first thing on the line. Anchored, the highest-
# precedence input to this resolution was never available, so a `cd <worktree> && git -C <main> reset
# --hard` — the exact cross-checkout shape this guard exists for — resolved to the worktree and passed.
# `|| true` is load-bearing: grep exits 1 when there is no `-C`, and under `set -euo pipefail` a
# failed command substitution aborts the hook silently before any check runs.
# One extractor, matched against a masked command so a quoted mention of `git -C` cannot
# redirect this guard at another repository. See lib/command-scan.sh.
GIT_C_PATH=$(hook_git_c_path "$SCAN" || true)
EFFECTIVE_DIR=""
if [[ -n "$GIT_C_PATH" ]]; then
  EFFECTIVE_DIR="$GIT_C_PATH"
elif [[ -n "$HOOK_CWD" ]]; then
  EFFECTIVE_DIR="$HOOK_CWD"
elif [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  EFFECTIVE_DIR="$CLAUDE_PROJECT_DIR"
fi

# No nameable effective dir → cannot positively confirm main-checkout → FAIL-SAFE.
if [[ -z "$EFFECTIVE_DIR" ]]; then
  exit 0
fi

# --- (a) is the effective repo the MAIN checkout? -----------------------------------------------
# Positively resolve the repo toplevel of the EFFECTIVE dir. If the dir is not inside a git work tree
# (empty/error) → cannot positively confirm main-checkout → FAIL-SAFE, do not block.
TOPLEVEL=$(hook_git_in "$EFFECTIVE_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")
if [[ -z "$TOPLEVEL" ]]; then
  exit 0
fi

# Under `.claude/worktrees/` → the assigned worktree, not main → allow.
if printf '%s' "$TOPLEVEL" | grep -q '/\.claude/worktrees/'; then
  exit 0
fi

# Both conditions positively confirmed: destructive command + assigned-worktree marker +
# effective repo is the MAIN checkout. This is the silent-cwd-fallback incident → BLOCK.
echo "[worktree-cwd-guard] Blocked: a DESTRUCTIVE git command resolved to the MAIN checkout" >&2
echo "[worktree-cwd-guard]   effective repo: $TOPLEVEL" >&2
# Named however this session was identified. The env marker is optional now — the copy of the hook
# that is running is the signal that actually arrives — and referencing it bare aborted the script
# under `set -u` AFTER the refusal had printed, turning a considered exit 2 into a bare exit 1.
ASSIGNED_WORKTREE="${ROBOTA_AGENT_WORKTREE:-${CLAUDE_PROJECT_DIR:-$SELF_DIR}}"
echo "[worktree-cwd-guard]   assigned worktree: $ASSIGNED_WORKTREE" >&2
echo "[worktree-cwd-guard] Your worktree session's cwd appears to have fallen back to the main clone" >&2
echo "[worktree-cwd-guard] (the assigned worktree was likely removed). Running this here would damage MAIN." >&2
echo "[worktree-cwd-guard] Fix: cd back into your assigned worktree ('$ASSIGNED_WORKTREE') and re-run;" >&2
echo "[worktree-cwd-guard] if the worktree is gone, re-create it (git worktree add) or restart the task." >&2
echo "[worktree-cwd-guard] Deliberate main-checkout op? Prefix: WORKTREE_CWD_GUARD_ALLOW_MAIN=1 <cmd>" >&2
exit 2
