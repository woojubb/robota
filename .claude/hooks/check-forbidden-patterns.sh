#!/usr/bin/env bash
# PreToolUse hook: block forbidden patterns in production TypeScript source.
# Covers common-mistakes #1 (any), #7 (console.*), #9 (try/catch fallback).
#
# Escape mechanism (per-line):
#   const x: any = y;           // allow-any: <reason>
#   console.log(msg);           // allow-console: <reason>
#   try { ... } catch { ... }   // allow-fallback: <reason>
#
# Exit codes: 0 = pass, 2 = hard block

set -uo pipefail

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_FILE="$PROJECT_DIR/.agents/evals/harness-log/blocks.jsonl"

# Extract file_path from tool_input
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Only check production TypeScript under packages/*/src (not tests, not apps)
case "$FILE_PATH" in
  "$PROJECT_DIR"/packages/*/src/*.ts) ;;
  "$PROJECT_DIR"/packages/*/src/**/*.ts) ;;
  "$PROJECT_DIR"/packages/*/src/*.tsx) ;;
  "$PROJECT_DIR"/packages/*/src/**/*.tsx) ;;
  *) exit 0 ;;
esac

# Skip test files
case "$FILE_PATH" in
  */__tests__/*|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) exit 0 ;;
esac

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
RELATIVE_PATH="${FILE_PATH#$PROJECT_DIR/}"
BLOCKED=false
BLOCK_MESSAGES=""

append_block() {
  local pattern="$1"
  local line_num="$2"
  local line_content="$3"
  mkdir -p "$(dirname "$LOG_FILE")"
  printf '{"timestamp":"%s","pattern":"%s","file":"%s","line":%d,"escape_attempted":false}\n' \
    "$TIMESTAMP" "$pattern" "$RELATIVE_PATH" "$line_num" >> "$LOG_FILE"
  BLOCK_MESSAGES="$BLOCK_MESSAGES\n  line $line_num: $line_content"
  BLOCKED=true
}

# ── #1: any type ──────────────────────────────────────────────────────────────
while IFS= read -r match; do
  [ -z "$match" ] && continue
  line_num=$(echo "$match" | cut -d: -f1)
  line_content=$(echo "$match" | cut -d: -f2-)
  # skip comment lines (JSDoc, inline comments)
  echo "$line_content" | grep -qE '^\s*\*|^\s*//' && continue
  echo "$line_content" | grep -q '//[[:space:]]*allow-any:' && continue
  append_block "any-type" "$line_num" "$line_content"
done < <(grep -nE ':\s*any(\s|;|,|\)|>|$)|\bas\s+any\b' "$FILE_PATH" 2>/dev/null || true)

# ── #7: console.* ─────────────────────────────────────────────────────────────
while IFS= read -r match; do
  [ -z "$match" ] && continue
  line_num=$(echo "$match" | cut -d: -f1)
  line_content=$(echo "$match" | cut -d: -f2-)
  # skip comment lines (JSDoc, inline comments)
  echo "$line_content" | grep -qE '^\s*\*|^\s*//' && continue
  echo "$line_content" | grep -q '//[[:space:]]*allow-console:' && continue
  append_block "console-usage" "$line_num" "$line_content"
done < <(grep -nE '\bconsole\.(log|warn|error|info|debug|trace)\b' "$FILE_PATH" 2>/dev/null || true)

# ── #9: try/catch fallback (catch block that swallows/suppresses the error) ───
# Heuristic: catch block body is empty or only contains a comment/return/continue
# We scan for catch blocks where the body has no rethrow and no error propagation
CATCH_LINES=$(grep -nE '^\s*}\s*catch\s*(\(|{)' "$FILE_PATH" 2>/dev/null || true)
while IFS= read -r match; do
  [ -z "$match" ] && continue
  line_num=$(echo "$match" | cut -d: -f1)
  line_content=$(echo "$match" | cut -d: -f2-)
  echo "$line_content" | grep -q '//[[:space:]]*allow-fallback:' && continue
  # Read ahead a few lines to check if error is suppressed (no throw/reject/return error)
  block=$(sed -n "$((line_num)),$((line_num + 6))p" "$FILE_PATH" 2>/dev/null || true)
  # If catch block has no throw/reject/Promise.reject/return.*[Ee]rr — flag as fallback
  if ! echo "$block" | grep -qE '\bthrow\b|\bPromise\.reject\b|return.*[Ee]rr'; then
    append_block "try-catch-fallback" "$line_num" "$line_content"
  fi
done <<< "$CATCH_LINES"

if [ "$BLOCKED" = true ]; then
  echo "" >&2
  echo "❌ [check-forbidden-patterns] Blocked — forbidden pattern(s) in $RELATIVE_PATH:" >&2
  echo -e "$BLOCK_MESSAGES" >&2
  echo "" >&2
  echo "Rules:" >&2
  echo "  any-type        → common-mistakes #1: use unknown + narrowing or a proper interface" >&2
  echo "  console-usage   → common-mistakes #7: use dependency-injected logger" >&2
  echo "  try-catch-fallback → common-mistakes #9: no fallback; terminal failures stay terminal" >&2
  echo "" >&2
  echo "To allow an exception, add an escape comment on the same line:" >&2
  echo "  const x: any = y;    // allow-any: <reason>" >&2
  echo "  console.log(msg);    // allow-console: <reason>" >&2
  echo "  } catch (e) {        // allow-fallback: <reason>" >&2
  echo "" >&2
  exit 2
fi

exit 0
