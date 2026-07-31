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

# One reader for the payload's file_path, not one per hook. See lib/hook-facts.sh.
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

# Read JSON from stdin (Claude Code sends hook input via stdin)
INPUT=$(cat)

# The path was read with `grep -o '"file_path"…"[^"]*"'`, which stops at the first ESCAPED quote.
# A file named `we"ird.ts` arrives in the payload as `we\"ird.ts` and was read as `we\` — a path
# that does not exist, so the `-f` test below dropped it and the file was silently never formatted.
# A backslash anywhere in the name did the same. Both are legal filenames and both are escaped by
# JSON, so the payload has to be decoded as JSON rather than scraped.
#
# This hook FORMATS; it does not judge. A payload it cannot decode names no file to format, so
# exiting 0 here is the whole of the correct behaviour — unlike the guards, which refuse.
FILE_PATH=$(hook_file_path_of "$INPUT" || printf '')

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
