#!/usr/bin/env bash
# Stop hook helper: collect rework/revert signals from transcript and git history.
#
# LESSON-010: this hook fires on EVERY session Stop and re-scans the whole transcript, so a
# naive append re-emits the same signal once per Stop (296k duplicate events by 2026-07).
# Every emission below is therefore deduplicated per (pattern, file, session) via
# append_event_once, and workflow-required multi-edit paths (backlog/task/lessons files,
# which the done gate REQUIRES editing 3+ times) are excluded from the same-file detector.

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

# Emit at most once per (pattern, file, session): a Stop-hook rescan of the same transcript
# must not re-count a signal it already recorded. jq -cn writes session_id/pattern/file as
# adjacent keys, so a fixed-string grep on that fragment is an exact, fast identity check.
append_event_once() {
  local pattern="$1"
  local file_path="$2"
  if [ -f "$LOG_FILE" ] && [ -n "$SESSION_ID" ]; then
    if grep -Fq "\"session_id\":\"$SESSION_ID\",\"pattern\":\"$pattern\",\"file\":\"$file_path\"" \
      "$LOG_FILE" 2>/dev/null; then
      return 0
    fi
  fi
  append_event "$@"
}

# Paths the workflow REQUIRES editing 3+ times (backlog done gate: create → evidence →
# status/move; lessons churn) — never a rework signal.
is_workflow_multi_edit_path() {
  case "$1" in
    *".agents/backlog/"* | *".agents/tasks/"* | *".agents/evals/"*) return 0 ;;
    *) return 1 ;;
  esac
}

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SESSION_ID=$(read_json '.session_id')
TRANSCRIPT_PATH=$(read_json '.transcript_path')
TRANSCRIPT_PATH="${TRANSCRIPT_PATH/#\~/$HOME}"

git_project() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX git -C "$PROJECT_DIR" "$@"
}

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
      if [ -n "$file_path" ] && [ "$count" -ge 3 ] && ! is_workflow_multi_edit_path "$file_path"; then
        append_event_once "same-file-edited-3-times" "$file_path" "$count" "same file edited repeatedly"
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
    # Capture context (LESSON-010): join error tool_result ids back to their tool_use names
    # so the digest can show WHICH tools failed instead of "(none)".
    FAILING_TOOLS=$(jq -rs '
      [ .[] | .message.content[]? | select(.type? == "tool_use") | {id, name} ] as $uses
      | [ .[] | .message.content[]? | select(.type? == "tool_result" and .is_error == true)
          | .tool_use_id ] as $errs
      | [ $errs[] as $id | ($uses[] | select(.id == $id) | .name) ]
      | group_by(.) | map({name: .[0], n: length}) | sort_by(-.n)
      | .[0:3] | map("\(.name)(\(.n))") | join(",")
    ' "$TRANSCRIPT_PATH" 2>/dev/null || echo "")
    DETAIL="tool errors repeated in transcript"
    if [ -n "$FAILING_TOOLS" ]; then
      DETAIL="failing tools: $FAILING_TOOLS"
    fi
    append_event_once "repeated-tool-errors" "" "$TOOL_ERROR_COUNT" "$DETAIL"
  fi
fi

git_project log --since="2 hours ago" --pretty=%s 2>/dev/null |
  grep -Ei '^(revert|fix:)' |
  while IFS= read -r subject; do
    # Dedupe by subject: the 2-hour lookback re-sees the same commit on every Stop.
    if [ -f "$LOG_FILE" ] &&
      grep -Fq "\"pattern\":\"fix-or-revert-commit\"" "$LOG_FILE" 2>/dev/null &&
      grep -F "\"pattern\":\"fix-or-revert-commit\"" "$LOG_FILE" | grep -Fq "$subject"; then
      continue
    fi
    append_event "fix-or-revert-commit" "" 1 "$subject"
  done || true

exit 0
