#!/bin/bash
# eval-log-stop hook
# Captures session metrics on stop: commits, test files changed.
# Appends a summary line to .agents/evals/harness-log/sessions.jsonl

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_DIR="$PROJECT_DIR/.agents/evals/harness-log"
LOG_FILE="$LOG_DIR/sessions.jsonl"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "unknown")

# Count recent commits (last 2 hours)
COMMIT_COUNT=$(git -C "$PROJECT_DIR" log --since="2 hours ago" --oneline 2>/dev/null | wc -l | tr -d ' ' || echo "0")

# Count test files changed in recent commits
TEST_FILES_CHANGED=0
if [[ "$COMMIT_COUNT" -gt 0 ]]; then
  TEST_FILES_CHANGED=$(git -C "$PROJECT_DIR" diff --name-only "HEAD~${COMMIT_COUNT}" HEAD 2>/dev/null | grep -c '__tests__\|\.test\.\|\.spec\.' || true)
fi

printf '{"timestamp":"%s","branch":"%s","commits":%d,"testFilesChanged":%d}\n' \
  "$TIMESTAMP" "$BRANCH" "$COMMIT_COUNT" "$TEST_FILES_CHANGED" >> "$LOG_FILE"

exit 0
