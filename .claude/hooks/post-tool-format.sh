#!/usr/bin/env bash
# PostToolUse hook: auto-format files after Write/Edit tool use.
# Runs prettier + eslint --fix on the changed file.
#
# Environment variables (provided by Claude Code):
#   CLAUDE_TOOL_NAME  - "Write" or "Edit"
#   CLAUDE_TOOL_INPUT - JSON with file_path field

set -euo pipefail

# Extract file_path from tool input JSON
FILE_PATH=$(echo "$CLAUDE_TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Only format files within the project directory
case "$FILE_PATH" in
  "$CLAUDE_PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac

# Only format supported file types
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.md|*.yml|*.yaml) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR"

# Run prettier (suppress errors — file may not match prettier config)
npx prettier --write "$FILE_PATH" 2>/dev/null || true

# Run eslint --fix only for JS/TS files
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs)
    npx eslint --fix "$FILE_PATH" 2>/dev/null || true
    ;;
esac
