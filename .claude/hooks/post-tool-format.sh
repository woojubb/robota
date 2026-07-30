#!/usr/bin/env bash
# PostToolUse hook: auto-format files after Write/Edit tool use.
# Runs prettier --write on the changed file for fast feedback. `eslint --fix` is intentionally NOT run here
# (HARNESS-DIET-006): lint-staged (.husky/pre-commit) already batches `eslint --fix` at commit time, and a
# per-edit `npx eslint` cold-start added latency to every Write/Edit.
#
# Environment variables (provided by Claude Code):
#   CLAUDE_TOOL_NAME  - "Write" or "Edit"
#   CLAUDE_TOOL_INPUT - JSON with file_path field

set -euo pipefail

# Read JSON from stdin (Claude Code sends hook input via stdin)
INPUT=$(cat)

# Extract file_path from tool input JSON
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Only format files within the project directory.
#
# `${CLAUDE_PROJECT_DIR:-}`, not a bare reference: under `set -u` an unset variable aborts the hook
# here, and the tool host does not guarantee it. Found by giving this hook its first execution test
# (PROC-003's third question) — it had never been run by anything but a live session, where the
# variable happens to be present. With it unset the comparison simply matches nothing, which is the
# fail-safe direction for a formatter.
case "$FILE_PATH" in
  "${CLAUDE_PROJECT_DIR:-}"/*) ;;
  *) exit 0 ;;
esac

# Only format supported file types
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.md|*.yml|*.yaml) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR"

# Run prettier (suppress errors — file may not match prettier config).
# eslint --fix is deferred to lint-staged at commit time (see header) — do not add a per-edit eslint here.
npx prettier --write "$FILE_PATH" 2>/dev/null || true
