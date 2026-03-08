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
echo "$COMMAND" | grep -qE '^\s*git\s+commit\b' && IS_COMMIT=true
echo "$COMMAND" | grep -qE '^\s*git\s+(push|push\s)' && IS_PUSH=true

if [[ "$IS_COMMIT" == "false" && "$IS_PUSH" == "false" ]]; then
  exit 0
fi

# Get current branch
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
CURRENT_BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "")

if [[ -z "$CURRENT_BRANCH" ]]; then
  exit 0
fi

# Block commit on all protected branches
if [[ "$IS_COMMIT" == "true" ]]; then
  for branch in main master develop; do
    if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
      echo "[branch-guard] Blocked: cannot git commit on protected branch '${branch}'. Create a feature branch first." >&2
      exit 2
    fi
  done
fi

# Block push on main/master only (develop push after merge is allowed)
if [[ "$IS_PUSH" == "true" ]]; then
  for branch in main master; do
    if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
      echo "[branch-guard] Blocked: cannot git push on protected branch '${branch}'." >&2
      exit 2
    fi
  done
fi

exit 0
