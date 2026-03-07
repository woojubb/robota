#!/bin/bash
# branch-guard hook
# Blocks git commit/push on protected branches (main, master, develop).
# Runs as a PreToolUse hook on Bash tool calls.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Only check Bash tool calls
if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

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
    echo "[branch-guard] Blocked: cannot $( echo "$COMMAND" | grep -oE 'git\s+(commit|push)' | head -1 ) on protected branch '$branch'. Create a feature branch first. See .agents/skills/branch-guard/SKILL.md" >&2
    exit 2
  fi
done

exit 0
