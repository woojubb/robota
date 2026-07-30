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

# Without a project directory this hook cannot tell what is in scope, and it must not guess.
#
# It bare-referenced `$CLAUDE_PROJECT_DIR` under `set -u`, so an unset variable aborted the hook —
# found by giving it its first execution test (PROC-003's third question); it had only ever run in a
# live session, where the variable happens to be present. The first attempt at a fix wrote
# `"${CLAUDE_PROJECT_DIR:-}"/*` and claimed that matched nothing. It does the opposite: unset, the
# pattern reduces to `/*`, and `*` in a case pattern matches `/` too — so it matches nearly every
# absolute path, widening scope while the comment said it narrowed it. And `cd "$CLAUDE_PROJECT_DIR"`
# four lines down still aborted anyway, so the crash simply moved.
#
# Nothing to scope means nothing to format.
if [ -z "${CLAUDE_PROJECT_DIR:-}" ]; then
  exit 0
fi

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

# Run prettier (suppress errors — file may not match prettier config).
# eslint --fix is deferred to lint-staged at commit time (see header) — do not add a per-edit eslint here.
npx prettier --write "$FILE_PATH" 2>/dev/null || true
