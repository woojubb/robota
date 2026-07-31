#!/bin/bash
# eval-log-stop hook
# Captures session metrics on stop: commits, test files changed, lesson signals.
# Appends a summary line to .agents/evals/local-metrics/sessions.jsonl

set -uo pipefail

# One scrubbed git, one branch reader, one record writer. See lib/hook-facts.sh.
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

INPUT=$(cat)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$PROJECT_DIR/.agents/evals/local-metrics"
LOG_FILE="$LOG_DIR/sessions.jsonl"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
# `git_project()` was defined here and, byte-identically, in revert-detect — two copies of the one
# fact that git must not be asked about a repository the ambient GIT_DIR has already chosen, while
# ~20 bare `git -C` call sites in the guards had no copy at all. It is `hook_git_in` now.
git_project() {
  hook_git_in "$PROJECT_DIR" "$@"
}

# `|| echo "unknown"` was dead code: `branch --show-current` exits 0 with EMPTY output on a
# detached HEAD, so the arm never fired and every detached session logged `"branch": ""`. The
# default goes on the VALUE, and this caller wants a word a reader of the log can see.
BRANCH=$(hook_current_branch "$PROJECT_DIR" "unknown")
SESSION_ID=""
if [ -n "$INPUT" ]; then
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo "")
fi

if [ -f "$HOOK_DIR/revert-detect.sh" ]; then
  printf '%s' "$INPUT" | bash "$HOOK_DIR/revert-detect.sh" >/dev/null 2>&1 || true
fi

# Count recent commits (last 2 hours)
COMMIT_COUNT=$(git_project log --since="2 hours ago" --oneline 2>/dev/null | wc -l | tr -d ' ')
if [ -z "$COMMIT_COUNT" ]; then
  COMMIT_COUNT=0
fi

# Count test files changed in recent commits
TEST_FILES_CHANGED=0
if [[ "$COMMIT_COUNT" -gt 0 ]]; then
  TEST_FILES_CHANGED=$(git_project diff --name-only "HEAD~${COMMIT_COUNT}" HEAD 2>/dev/null | grep -c '__tests__\|\.test\.\|\.spec\.' || true)
fi

count_records() {
  local file_path="$1"
  if [ ! -f "$file_path" ]; then
    echo 0
    return
  fi
  if [ -n "$SESSION_ID" ]; then
    jq -c --arg session_id "$SESSION_ID" 'select(.session_id == $session_id)' "$file_path" 2>/dev/null | wc -l | tr -d ' '
    return
  fi
  wc -l < "$file_path" | tr -d ' '
}

BLOCKS_TOTAL=$(count_records "$LOG_DIR/blocks.jsonl")
CORRECTIONS_TOTAL=$(count_records "$LOG_DIR/corrections.jsonl")
REVERTS_TOTAL=$(count_records "$LOG_DIR/reverts.jsonl")

jq -cn \
  --arg timestamp "$TIMESTAMP" \
  --arg branch "$BRANCH" \
  --arg session_id "$SESSION_ID" \
  --argjson commits "$COMMIT_COUNT" \
  --argjson test_files_changed "$TEST_FILES_CHANGED" \
  --argjson blocks_total "$BLOCKS_TOTAL" \
  --argjson corrections_total "$CORRECTIONS_TOTAL" \
  --argjson reverts_total "$REVERTS_TOTAL" \
  '{
    timestamp: $timestamp,
    branch: $branch,
    session_id: $session_id,
    commits: $commits,
    testFilesChanged: $test_files_changed,
    blocks_total: $blocks_total,
    corrections_total: $corrections_total,
    reverts_total: $reverts_total
  }' >> "$LOG_FILE"

if [ "${ROBOTA_DISABLE_LESSONS_DIGEST:-}" != "1" ] && [ -f "$PROJECT_DIR/scripts/harness/lessons-digest.mjs" ]; then
  node "$PROJECT_DIR/scripts/harness/lessons-digest.mjs" >/dev/null 2>&1 || true
fi

exit 0
