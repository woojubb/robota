#!/bin/bash
# task-tracking-start hook
# On session start/resume, checks for active tasks and injects context.
# "Done" is detected the same way the harness enforces it
# (scripts/harness/check-task-archival.mjs): a task is archivable when its
# Status is completed, OR every checkbox is checked and its Spec points into
# spec-docs/done/. A `**Status**` grep alone is blind to the task-breakdown
# format, so it is not used as the completion signal.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
TASKS_DIR="$PROJECT_DIR/.agents/tasks"

if [[ ! -d "$TASKS_DIR" ]]; then
  exit 0
fi

# Find active task files (exclude completed/ and README.md)
ACTIVE_TASKS=()
for f in "$TASKS_DIR"/*.md; do
  [[ -f "$f" ]] || continue
  basename=$(basename "$f")
  [[ "$basename" == "README.md" ]] && continue
  ACTIVE_TASKS+=("$basename")
done

if [[ ${#ACTIVE_TASKS[@]} -eq 0 ]]; then
  exit 0
fi

# Classify a single task file: prints "done" if archivable, else "active".
classify_task() {
  local file="$1"
  if grep -qiE 'status\*{0,2}[[:space:]]*:[[:space:]]*completed' "$file"; then
    echo "done"
    return
  fi
  local unchecked checked spec_done
  unchecked=$(grep -cE '^[[:space:]]*[-*][[:space:]]+\[ \]' "$file" || true)
  checked=$(grep -cE '^[[:space:]]*[-*][[:space:]]+\[[xX]\]' "$file" || true)
  spec_done=$(grep -ciE '^[[:space:]]*Spec:.*spec-docs/done/' "$file" || true)
  if [[ "$unchecked" -eq 0 && "$checked" -gt 0 && "$spec_done" -gt 0 ]]; then
    echo "done"
  else
    echo "active"
  fi
}

# Output context for Claude to see
echo "[task-tracking] Active tasks found in .agents/tasks/:"
DONE_COUNT=0
for task in "${ACTIVE_TASKS[@]}"; do
  STATE=$(classify_task "$TASKS_DIR/$task")
  if [[ "$STATE" == "done" ]]; then
    echo "  - $task — DONE, needs archival to completed/"
    DONE_COUNT=$((DONE_COUNT + 1))
  else
    echo "  - $task — in progress"
  fi
done
echo "Read the task file(s) before starting work. Update progress during the session."
if [[ "$DONE_COUNT" -gt 0 ]]; then
  echo "$DONE_COUNT task(s) are already DONE — git mv them to .agents/tasks/completed/ now (harness:scan task-archival will fail otherwise)."
fi

exit 0
