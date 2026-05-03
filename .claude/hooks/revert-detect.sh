#!/usr/bin/env bash
# Stop hook helper: collect rework/revert signals from transcript and git history.

set -uo pipefail

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_FILE="$PROJECT_DIR/.agents/evals/local-metrics/reverts.jsonl"

read_json() {
  local expression="$1"
  if [ -z "$INPUT" ]; then
    echo ""
    return
  fi
  printf '%s' "$INPUT" | jq -r "$expression // \"\"" 2>/dev/null || echo ""
}

append_event() {
  local pattern="$1"
  local file_path="$2"
  local count="$3"
  local detail="$4"
  mkdir -p "$(dirname "$LOG_FILE")"
  jq -cn \
    --arg timestamp "$TIMESTAMP" \
    --arg session_id "$SESSION_ID" \
    --arg pattern "$pattern" \
    --arg file "$file_path" \
    --argjson count "$count" \
    --arg detail "$detail" \
    '{
      timestamp: $timestamp,
      session_id: $session_id,
      pattern: $pattern,
      file: $file,
      count: $count,
      detail: $detail
    }' >> "$LOG_FILE"
}

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SESSION_ID=$(read_json '.session_id')
TRANSCRIPT_PATH=$(read_json '.transcript_path')
TRANSCRIPT_PATH="${TRANSCRIPT_PATH/#\~/$HOME}"

if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  jq -r '
    [
      .tool_input.file_path?,
      .input.file_path?,
      (.message.content[]? | select(.type == "tool_use") | .input.file_path?)
    ] | .[]? // empty
  ' "$TRANSCRIPT_PATH" 2>/dev/null |
    sort |
    uniq -c |
    while read -r count file_path; do
      if [ -n "$file_path" ] && [ "$count" -ge 3 ]; then
        append_event "same-file-edited-3-times" "$file_path" "$count" "same file edited repeatedly"
      fi
    done

  TOOL_ERROR_COUNT=$(jq -r '
    select(
      .is_error == true
      or .tool_result.is_error == true
      or (.error? != null)
      or (.message.content[]?.is_error == true)
    )
    | "tool-error"
  ' "$TRANSCRIPT_PATH" 2>/dev/null | wc -l | tr -d ' ')
  if [ "${TOOL_ERROR_COUNT:-0}" -ge 3 ]; then
    append_event "repeated-tool-errors" "" "$TOOL_ERROR_COUNT" "tool errors repeated in transcript"
  fi
fi

git -C "$PROJECT_DIR" log --since="2 hours ago" --pretty=%s 2>/dev/null |
  grep -Ei '^(revert|fix:)' |
  while IFS= read -r subject; do
    append_event "fix-or-revert-commit" "" 1 "$subject"
  done || true

exit 0
