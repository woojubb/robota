#!/usr/bin/env bash
# Stop hook helper: collect rework/revert signals from transcript and git history.
# invoked-by: eval-log-stop.sh
#
# LESSON-010: this hook fires on EVERY session Stop and re-scans the whole transcript, so a
# naive append re-emits the same signal once per Stop (296k duplicate events by 2026-07).
# Every emission below is therefore deduplicated per (pattern, file, session) via
# append_event_once, and workflow-required multi-edit paths (backlog/task/lessons files,
# which the done gate REQUIRES editing 3+ times) are excluded from the same-file detector.

set -uo pipefail

# One reader for a payload field, one writer for a record, one scrubbed git. See lib/hook-facts.sh.
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_FILE="$PROJECT_DIR/.agents/evals/local-metrics/reverts.jsonl"

append_event() {
  local pattern="$1"
  local file_path="$2"
  local count="$3"
  local detail="$4"
  mkdir -p "$(dirname "$LOG_FILE")"
  # This hook read its payload with a jq-only `read_json()` and wrote its record with `jq -cn`, so
  # on a host without jq it recorded nothing while the Bash guards kept working. Both ends now go
  # through the shared ladder (jq, then python3, then refuse).
  hook_json_object \
    s timestamp "$TIMESTAMP" \
    s session_id "$SESSION_ID" \
    s pattern "$pattern" \
    s file "$file_path" \
    n count "$count" \
    s detail "$detail" >> "$LOG_FILE"
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
    *".agents/tasks/"* | *".agents/spec-docs/"* | *".agents/evals/"*) return 0 ;;
    *) return 1 ;;
  esac
}

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
# A session id and a transcript path are TEXT, or they are absent — there is no third answer, and
# `hook_json_string` is the single owner of that rule: a field that is not a JSON string reads as "",
# on a host with jq and on a host without, byte for byte (INFRA-081, #1574). This used to call
# `hook_json_text`, which existed only because the rule was true in one file and not in the other;
# once it was true in both, that name was an alias and is gone. See lib/command-scan.sh.
SESSION_ID=$(hook_json_string "$INPUT" 'session_id' || printf '')
TRANSCRIPT_PATH=$(hook_json_string "$INPUT" 'transcript_path' || printf '')
TRANSCRIPT_PATH="${TRANSCRIPT_PATH/#\~/$HOME}"

# `git_project()` was defined here and, byte-identically, in eval-log-stop — two copies of the one
# fact that git must not be asked about a repository the ambient GIT_DIR has already chosen. It is
# `hook_git_in` now, which every hook shares.
git_project() {
  hook_git_in "$PROJECT_DIR" "$@"
}

# The transcript is a JSONL FILE and the queries below are jq PROGRAMS, not field reads, so they
# stay on jq. Stated limit rather than hidden: without jq these two transcript signals are not
# collected, while the git-history signal below and the record writer keep working — the hook is
# degraded, not silent, which is the distinction the payload read got wrong.
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ] && command -v jq >/dev/null 2>&1; then
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
