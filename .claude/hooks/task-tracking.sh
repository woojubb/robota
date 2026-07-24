#!/bin/bash
# task-tracking.sh <start|stop>
# Single owner of task-tracking hook logic (merged from task-tracking-start.sh +
# task-tracking-stop.sh, which duplicated classify_task byte-for-byte — HARNESS-DIET-006).
#
#   start (SessionStart): list active tasks and inject context, flagging DONE ones.
#   stop  (Stop):         detect DONE-but-active task files and instruct archival.
#
# "Done" is detected the same way the harness enforces it
# (scripts/harness/check-task-archival.mjs): a task is archivable when its
# Status is completed, OR every checkbox is checked and its Spec points into
# spec-docs/done/. A `**Status**` grep alone is blind to the task-breakdown
# format, so it is not used as the completion signal.

set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "start" && "$MODE" != "stop" ]]; then
  echo "[task-tracking] Usage: task-tracking.sh <start|stop>" >&2
  exit 1
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
TASKS_DIR="$PROJECT_DIR/.agents/tasks"

if [[ ! -d "$TASKS_DIR" ]]; then
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

# Collect active (non-README) task files
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

if [[ "$MODE" == "start" ]]; then
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
fi

# MODE == stop: only genuinely-done files are called out, so the reminder is
# actionable rather than a blanket nag.
DONE_TASKS=()
for task in "${ACTIVE_TASKS[@]}"; do
  if [[ "$(classify_task "$TASKS_DIR/$task")" == "done" ]]; then
    DONE_TASKS+=("$task")
  fi
done

if [[ ${#DONE_TASKS[@]} -eq 0 ]]; then
  exit 0
fi

echo "ACTION REQUIRED — DONE task files still in .agents/tasks/ (not archived):"
for task in "${DONE_TASKS[@]}"; do
  echo "  - $task"
done
echo ""
echo "Archive each in the SAME commit as its work (the harness 'task-archival' scan fails otherwise):"
echo "  git mv .agents/tasks/<name>.md .agents/tasks/completed/<name>.md"
echo "If a file must stay active despite being complete, add a line:"
echo "  <!-- archival-exempt: <reason> -->"

exit 0
