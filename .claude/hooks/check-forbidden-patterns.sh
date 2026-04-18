#!/usr/bin/env bash
# PreToolUse hook: block forbidden patterns in NEW content being written.
# Covers common-mistakes #1 (any), #7 (console.*), #9 (try/catch fallback).
#
# Reads tool_input.content (Write) or tool_input.new_string (Edit) from stdin —
# NOT the existing file — so only newly introduced violations are caught.
#
# Escape mechanism (per-line):
#   const x: any = y;         // allow-any: <reason>
#   console.log(msg);         // allow-console: <reason>
#   } catch (e) {             // allow-fallback: <reason>
#
# Exit codes: 0 = pass, 2 = hard block

set -uo pipefail

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_FILE="$PROJECT_DIR/.agents/evals/harness-log/blocks.jsonl"

# ── scope filter ──────────────────────────────────────────────────────────────
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check production TypeScript under packages/*/src
case "$FILE_PATH" in
  "$PROJECT_DIR"/packages/*/src/*.ts|\
  "$PROJECT_DIR"/packages/*/src/**/*.ts|\
  "$PROJECT_DIR"/packages/*/src/*.tsx|\
  "$PROJECT_DIR"/packages/*/src/**/*.tsx) ;;
  *) exit 0 ;;
esac

# Skip test files
case "$FILE_PATH" in
  */__tests__/*|*.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) exit 0 ;;
esac

# ── extract NEW content from stdin (not disk) ─────────────────────────────────
# Write tool → tool_input.content  |  Edit tool → tool_input.new_string
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // ""')

if [ -z "$CONTENT" ]; then
  exit 0
fi

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
  echo "$line_content" | grep -qE '^\s*\*|^\s*//' && continue
  echo "$line_content" | grep -q '//[[:space:]]*allow-any:' && continue
  append_block "any-type" "$line_num" "$line_content"
done < <(echo "$CONTENT" | grep -nE ':\s*any(\s|;|,|\)|>|$)|\bas\s+any\b' 2>/dev/null || true)

# ── #7: console.* ─────────────────────────────────────────────────────────────
while IFS= read -r match; do
  [ -z "$match" ] && continue
  line_num=$(echo "$match" | cut -d: -f1)
  line_content=$(echo "$match" | cut -d: -f2-)
  echo "$line_content" | grep -qE '^\s*\*|^\s*//' && continue
  echo "$line_content" | grep -q '//[[:space:]]*allow-console:' && continue
  append_block "console-usage" "$line_num" "$line_content"
done < <(echo "$CONTENT" | grep -nE '\bconsole\.(log|warn|error|info|debug|trace)\b' 2>/dev/null || true)

# ── #9: try/catch fallback ────────────────────────────────────────────────────
# Flag catch blocks where the body has no rethrow/reject/error propagation
while IFS= read -r match; do
  [ -z "$match" ] && continue
  line_num=$(echo "$match" | cut -d: -f1)
  line_content=$(echo "$match" | cut -d: -f2-)
  echo "$line_content" | grep -q '//[[:space:]]*allow-fallback:' && continue
  # Read ahead 6 lines from CONTENT (not disk)
  block=$(echo "$CONTENT" | sed -n "$((line_num)),$((line_num + 6))p")
  if ! echo "$block" | grep -qE '\bthrow\b|\bPromise\.reject\b|return.*[Ee]rr'; then
    append_block "try-catch-fallback" "$line_num" "$line_content"
  fi
done < <(echo "$CONTENT" | grep -nE '^\s*}\s*catch\s*(\(|{)' 2>/dev/null || true)

# ── report ────────────────────────────────────────────────────────────────────
if [ "$BLOCKED" = true ]; then
  echo "" >&2
  echo "❌ [check-forbidden-patterns] Blocked — forbidden pattern(s) in $RELATIVE_PATH:" >&2
  echo -e "$BLOCK_MESSAGES" >&2
  echo "" >&2
  echo "Rules:" >&2
  echo "  any-type           → common-mistakes #1: use unknown + narrowing or a proper interface" >&2
  echo "  console-usage      → common-mistakes #7: use dependency-injected logger" >&2
  echo "  try-catch-fallback → common-mistakes #9: no fallback; terminal failures stay terminal" >&2
  echo "" >&2
  echo "Escape (same line): // allow-any: <reason>  |  // allow-console: <reason>  |  // allow-fallback: <reason>" >&2
  echo "" >&2
  exit 2
fi

exit 0
