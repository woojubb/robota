#!/bin/bash
# task-tracking-stop hook
# On session stop, detects DONE-but-active task files and instructs the agent to
# archive them. "Done" uses the same signal the harness enforces
# (scripts/harness/check-task-archival.mjs): Status completed, OR all checkboxes
# checked with a Spec pointer into spec-docs/done/. Only genuinely-done files are
# called out, so the reminder is actionable rather than a blanket nag.

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
TASKS_DIR="$PROJECT_DIR/.agents/tasks"

if [[ ! -d "$TASKS_DIR" ]]; then
  exit 0
fi

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

DONE_TASKS=()
for f in "$TASKS_DIR"/*.md; do
  [[ -f "$f" ]] || continue
  basename=$(basename "$f")
  [[ "$basename" == "README.md" ]] && continue
  if [[ "$(classify_task "$f")" == "done" ]]; then
    DONE_TASKS+=("$basename")
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
