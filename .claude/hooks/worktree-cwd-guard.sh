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
# shellcheck source=lib/command-scan.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/command-scan.sh"

# Extract tool_name without jq — match "tool_name":"Bash"
TOOL_NAME=$(hook_tool_name_of "$INPUT")

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Extract command from tool_input.command
if ! COMMAND=$(hook_command_of "$INPUT"); then
  echo "[worktree-cwd-guard] Blocked: the tool command could not be decoded, so the command cannot be judged." >&2
  echo "[worktree-cwd-guard] Install jq or python3 so this guard can read what it is judging." >&2
  exit 2
fi

# Honor the inline override token written IN the command string. The `VAR=1` prefix runs in the
# TOOL's shell, not this hook's process, so a plain env check never sees it (same reasoning as
# branch-guard's inline overrides).
if printf '%s' "$COMMAND" | grep -qE '(^|[[:space:];&])WORKTREE_CWD_GUARD_ALLOW_MAIN=1([[:space:]]|$)'; then
  exit 0
fi

# --- (b) worktree-assignment marker -------------------------------------------------------------
# Present iff this session was spawned as a worktree-assigned subagent. Absent → ordinary main-clone
# session → FAIL-SAFE, never block.
if [[ -z "${ROBOTA_AGENT_WORKTREE:-}" ]]; then
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
# `\n` — the two literal characters backslash-n — is a boundary too. The command arrives as JSON and
# is read with grep, not a JSON parser, so a multi-line block keeps its escapes and the second line
# of `cd <repo>` + newline + `git reset --hard` begins with no whitespace, no `;` and no `&`.
# Measured 2026-07-28: this guard was reachable from `;`, `&&` and env prefixes but silently bypassed
# by exactly that shape — and a destructive command on a later line of a block is the shape of the
# incident it exists to prevent.
# A quote is a boundary too. `bash -c "git push origin main"` really runs a push, and
# hook_blank_quoted_args deliberately leaves that string intact — but the character before the
# verb is then `"`, so without this the preserved string matched nothing and the exception was
# decorative. Elsewhere quoted content is already blanked, so this cannot resurrect the
# false positive it sits next to.
GITPFX='(^|[[:space:];&|({"'"'"'])([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*'

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
TOPLEVEL=$(git -C "$EFFECTIVE_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")
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
echo "[worktree-cwd-guard]   assigned worktree (ROBOTA_AGENT_WORKTREE): $ROBOTA_AGENT_WORKTREE" >&2
echo "[worktree-cwd-guard] Your worktree session's cwd appears to have fallen back to the main clone" >&2
echo "[worktree-cwd-guard] (the assigned worktree was likely removed). Running this here would damage MAIN." >&2
echo "[worktree-cwd-guard] Fix: cd back into your assigned worktree ('$ROBOTA_AGENT_WORKTREE') and re-run;" >&2
echo "[worktree-cwd-guard] if the worktree is gone, re-create it (git worktree add) or restart the task." >&2
echo "[worktree-cwd-guard] Deliberate main-checkout op? Prefix: WORKTREE_CWD_GUARD_ALLOW_MAIN=1 <cmd>" >&2
exit 2
