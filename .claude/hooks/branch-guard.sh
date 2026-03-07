#!/bin/bash
# branch-guard hook
# Blocks git commit/push on protected branches (main, master, develop).
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

# Only check git commit and git push commands
if ! echo "$COMMAND" | grep -qE '^\s*git\s+(commit|push)\b'; then
  exit 0
fi

# Get current branch
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
CURRENT_BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "")

if [[ -z "$CURRENT_BRANCH" ]]; then
  exit 0
fi

PROTECTED_BRANCHES="main master develop"

for branch in $PROTECTED_BRANCHES; do
  if [[ "$CURRENT_BRANCH" == "$branch" ]]; then
    GIT_ACTION=$(echo "$COMMAND" | grep -oE 'git\s+(commit|push)' | head -1)
    echo "[branch-guard] Blocked: cannot ${GIT_ACTION} on protected branch '${branch}'. Create a feature branch first. See .agents/skills/branch-guard/SKILL.md" >&2
    exit 2
  fi
done

exit 0
