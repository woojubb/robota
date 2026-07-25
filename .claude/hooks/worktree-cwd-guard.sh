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

# Extract tool_name without jq — match "tool_name":"Bash"
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Extract command from tool_input.command
COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

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
COMMAND_NO_COMMENTS=$(printf '%s' "$COMMAND" | sed 's/[[:space:]]#[^"]*$//')
SCAN="${COMMAND_NO_COMMENTS%%<<*}"

# GITPFX tolerates env prefixes and global git flags before the subcommand (`git -C <path> reset`,
# `git -c k=v push`) — the same pattern branch-guard uses.
GITPFX='(^|[[:space:];&|(])([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*'

IS_DESTRUCTIVE=false
# git reset --hard
printf '%s' "$SCAN" | grep -qE "${GITPFX}reset\b[^|;&]*--hard\b" && IS_DESTRUCTIVE=true
# git clean with a force flag (-f, -fd, -fdx, -xf, --force)
printf '%s' "$SCAN" | grep -qE "${GITPFX}clean\b[^|;&]*(-[[:alnum:]]*f|--force)" && IS_DESTRUCTIVE=true
# git checkout -- <path> (discards working-tree changes, e.g. `git checkout -- .`)
printf '%s' "$SCAN" | grep -qE "${GITPFX}checkout\b[^|;&]*[[:space:]]--([[:space:]]|$)" && IS_DESTRUCTIVE=true
# git push --force / --force-with-lease
printf '%s' "$SCAN" | grep -qE "${GITPFX}push\b[^|;&]*--force" && IS_DESTRUCTIVE=true

if [[ "$IS_DESTRUCTIVE" != "true" ]]; then
  exit 0
fi

# --- Resolve the EFFECTIVE repo the command will actually run in ---------------------------------
# Precedence (worktree-aware, same as branch-guard/pre-push-check): `git -C <path>` in the command >
# hook-input `cwd` > CLAUDE_PROJECT_DIR.
HOOK_CWD=$(echo "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//' || true)
GIT_C_PATH=$(printf '%s' "$COMMAND" | sed -nE 's/^[[:space:]]*git[[:space:]]+-C[[:space:]]+"?([^"[:space:]]+)"?.*/\1/p')
EFFECTIVE_DIR="${CLAUDE_PROJECT_DIR:-.}"
if [[ -n "$HOOK_CWD" ]] && git -C "$HOOK_CWD" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  EFFECTIVE_DIR="$HOOK_CWD"
fi
if [[ -n "$GIT_C_PATH" ]] && git -C "$GIT_C_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  EFFECTIVE_DIR="$GIT_C_PATH"
fi

# --- (a) is the effective repo the MAIN checkout? -----------------------------------------------
# Resolve the repo toplevel. If we cannot resolve it → cannot positively confirm main-checkout →
# FAIL-SAFE, do not block.
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
