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

# --- Open GitHub issues ---------------------------------------------------------------------------
#
# finding-depth.md says a FOUNDATIONAL finding is filed as a root item AND registered as a GitHub
# issue, and that an open issue outranks unfiled backlog work when choosing what to do next. Nothing
# showed those issues to anyone, so the filing was the end of the story rather than the start of it —
# four sat open while unrelated work was picked instead.
#
# ABOVE the tasks-directory check, and that is a second review finding: the block sat below it, so a
# repository with no `.agents/tasks/` — another clone reusing this hook, or this one before local task
# tracking existed — got no issue notice at all. Whether task FILES exist has nothing to do with
# whether issues are open, and one question must not gate the other.
#
# START ONLY, and the guard is a review finding rather than a preference: the first version sat above
# the MODE branch, so the Stop hook called the GitHub API on every session end too. The comment said
# "reported at session start" while the code did it twice, which is the class this repository keeps
# paying for — a comment describing something the code does not do.
#
# TIMED OUT for the same reason it is start-only. Every other check in this file is a local grep; this
# is the one network call, and a hook that hangs holds up the session it was meant to inform. Five
# seconds, and a timeout is reported rather than swallowed — "could not ask" and "nothing to report"
# are different answers and a reader must be able to tell them apart.
#
# Best-effort otherwise: `gh` may be absent or unauthenticated and a session must still start.
if [[ "$MODE" == "start" ]] && command -v gh >/dev/null 2>&1; then
  # One more than shown, so "there are more" is MEASURED rather than inferred from hitting the cap.
  # `--limit 20` returns 20 whether 20 or 200 are open, and a check for "exactly the cap" says
  # "there may be more" when there are exactly twenty and no more — a notice that cries wolf is one
  # people stop reading.
  ISSUE_SHOW=20
  ISSUE_LIMIT=$((ISSUE_SHOW + 1))
  # `|| ISSUE_STATUS=$?` rather than a bare assignment: this file runs under `set -e`, so a
  # non-zero exit from the substitution KILLS the script — measured with a hanging `gh`, the whole
  # session notice vanished and the hook exited 0 as if it had nothing to say. Silence on an error
  # is the one thing a hook may not do (enforcement-architecture.md).
  ISSUE_STATUS=0
  OPEN_ISSUES=$(timeout 5s gh issue list --state open --limit "$ISSUE_LIMIT" \
    --json number,title --jq '.[] | "  - #\(.number) \(.title)"' 2>/dev/null) || ISSUE_STATUS=$?
  if [[ $ISSUE_STATUS -eq 124 ]]; then
    echo "[task-tracking] Could not list open GitHub issues: the API did not answer within 5s."
    echo "[task-tracking] This is 'not asked', not 'none open' — check manually: gh issue list"
    echo ""
  elif [[ $ISSUE_STATUS -ne 0 ]]; then
    # The likeliest failure in practice is not a timeout — it is an unauthenticated `gh`, and the
    # first version passed over it in silence. "Could not ask" and "none open" are different answers
    # and a reader must be able to tell them apart, which is the whole reason this notice exists.
    echo "[task-tracking] Could not list open GitHub issues (gh exited $ISSUE_STATUS — often not"
    echo "[task-tracking] authenticated). This is 'not asked', not 'none open': gh auth status"
    echo ""
  elif [[ -n "$OPEN_ISSUES" ]]; then
    ISSUE_COUNT=$(printf '%s\n' "$OPEN_ISSUES" | grep -c '')
    echo "OPEN GitHub issues — these outrank unfiled backlog work (finding-depth.md):"
    printf '%s\n' "$OPEN_ISSUES" | head -n "$ISSUE_SHOW"
    # A silent truncation would read as "that is all of them", which is the shape of claim this
    # repository treats as a defect: a bounded list that does not say it is bounded.
    if [[ "$ISSUE_COUNT" -gt "$ISSUE_SHOW" ]]; then
      echo "  (showing the first $ISSUE_SHOW — there are more: gh issue list)"
    fi
    echo ""
  fi
fi

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
