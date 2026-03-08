#!/bin/bash
# task-tracking-start hook
# On session start/resume, checks for active tasks and injects context.

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

# Output context for Claude to see
echo "[task-tracking] Active tasks found in .agents/tasks/:"
for task in "${ACTIVE_TASKS[@]}"; do
  STATUS=$(grep -m1 '^\- \*\*Status\*\*:' "$TASKS_DIR/$task" 2>/dev/null | sed 's/.*: //' || echo "unknown")
  echo "  - $task (status: $STATUS)"
done
echo "Read the task file(s) before starting work. Update progress during the session. Archive to completed/ when done."

exit 0
