#!/bin/bash
# task-tracking-stop hook
# On session stop, detects active tasks and instructs the agent to archive completed ones.

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

echo "ACTION REQUIRED — Active task files found in .agents/tasks/:"
for task in "${ACTIVE_TASKS[@]}"; do
  STATUS=$(grep -m1 '^\- \*\*Status\*\*:' "$TASKS_DIR/$task" 2>/dev/null | sed 's/.*: //' || echo "unknown")
  echo "  - $task (status: $STATUS)"
done
echo ""
echo "Before ending this session you MUST:"
echo "  1. Update each task file status and progress."
echo "  2. If all work is done, set status to 'completed', fill the Result section,"
echo "     and move the file: mv .agents/tasks/<name>.md .agents/tasks/completed/"
echo "  3. Do NOT leave completed work in the active directory."

exit 0
