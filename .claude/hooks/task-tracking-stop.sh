#!/bin/bash
# task-tracking-stop hook
# On session stop, reminds to update/archive active tasks.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
TASKS_DIR="$PROJECT_DIR/.agents/tasks"

if [[ ! -d "$TASKS_DIR" ]]; then
  exit 0
fi

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

echo "[task-tracking] Reminder: ${#ACTIVE_TASKS[@]} active task(s) in .agents/tasks/:"
for task in "${ACTIVE_TASKS[@]}"; do
  echo "  - $task"
done
echo "If work is complete, update status to 'completed' and move to .agents/tasks/completed/."

exit 0
