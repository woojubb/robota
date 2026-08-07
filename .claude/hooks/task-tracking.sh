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

# One deadline for every network call a hook makes while deciding — see lib/bounded-gh.sh.
# shellcheck source=lib/bounded-gh.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/bounded-gh.sh"

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
# BOUNDED by `bounded_gh`, which this directory already owns. The first version hand-rolled
# `timeout 5s` — a second way to put a deadline on a `gh` call, and the wrong one: `timeout` is absent
# on a stock macOS, so the bound would have been true on one platform and silently false on the other,
# with the untested path being the one nobody runs. That is the defect `bounded-gh.sh` was extracted
# to fix (INFRA-087), reintroduced by me next door. Review caught it.
#
# Its exit codes carry the distinction this notice exists for: 2 is "the deadline expired", 1 is "gh
# is absent or failed", and neither may read as "nothing to report".
#
# Best-effort otherwise: `gh` may be absent or unauthenticated and a session must still start.
if [[ "$MODE" == "start" ]]; then
  # One more than shown, so "there are more" is MEASURED rather than inferred from hitting the cap.
  # `--limit 20` returns 20 whether 20 or 200 are open, and a check for "exactly the cap" says
  # "there may be more" when there are exactly twenty and no more — a notice that cries wolf is one
  # people stop reading.
  ISSUE_SHOW=20
  ISSUE_LIMIT=$((ISSUE_SHOW + 1))

  # AN OPT-OUT, because this is the only network call in a hook that was otherwise entirely local
  # and instant. Review: offline or unauthenticated, every session start pays for a lookup that
  # cannot succeed, and there was no way to decline it. A notice is worth having; a notice you
  # cannot turn off is a tax.
  #
  # The deadline is also this hook's own and SHORTER than the shared default. `bounded-gh.sh` is
  # sized for a guard deciding whether to refuse a command, where waiting beats guessing. Nothing is
  # being decided here — a session starts either way — so the ceiling is 4s, and the shared default
  # still applies to every guard that does decide.
  #
  # `${HOOK_GH_DEADLINE_SECONDS:-…}`, not a bare assignment, and review found why it has to be. The
  # first version overwrote the variable UNCONDITIONALLY, which is the one knob `bounded-gh.sh`
  # documents as "one deadline for every network call a hook makes while deciding" — so a caller
  # exporting it to raise the deadline on a slow network had that silently discarded here.
  #
  # It also broke this hook's own test: the case that passes `deadlineSeconds: 1` sets exactly this
  # variable, so it was clobbered back to 4 and the case measured the default while claiming to
  # measure a 1-second deadline. A green for the wrong reason, in the file whose subject is telling
  # "could not ask" from "none open".
  HOOK_GH_DEADLINE_SECONDS="${HOOK_GH_DEADLINE_SECONDS:-${TASK_TRACKING_ISSUE_DEADLINE_SECONDS:-4}}"
  ISSUE_STATUS=0
  OPEN_ISSUES=""
  if [[ -n "${TASK_TRACKING_SKIP_ISSUES:-}" ]]; then
    ISSUE_STATUS=-1
  elif ! command -v gh >/dev/null 2>&1; then
    # Told apart from a gh that RAN AND FAILED. `bounded_gh` returns 1 for both, and the message
    # for the second ("often not authenticated") misleads someone who simply has no `gh` — review
    # found that, and it is worth more than the wording: the two need different actions.
    ISSUE_STATUS=-2
  else
    # NOT CACHED, and that is a decision rather than an omission. Review suggested a cache for
    # rapid successive sessions, and it was written and then removed: a cached list asserts an
    # issue is OPEN for as long as the entry lives, so within its window the notice would name
    # issues that were closed and miss ones just filed. This notice's whole claim is "these outrank
    # unfiled backlog work" — a false one costs more than the lookup it saves, and it is precisely
    # the claim-does-not-match-reality class this repository is currently counting.
    #
    # The rate-limiting worry is answered by the opt-out above and by `gh issue list` being one
    # cheap request against a 5000/hour budget.
    #
    # `|| ISSUE_STATUS=$?` rather than a bare assignment: this file runs under `set -e`, so a
    # non-zero exit from the substitution KILLS the script — measured with a hanging `gh`, the
    # whole session notice vanished and the hook exited 0 as if it had nothing to say. Silence on
    # an error is the one thing a hook may not do (enforcement-architecture.md).
    OPEN_ISSUES=$(bounded_gh issue list --state open --limit "$ISSUE_LIMIT" \
      --json number,title --jq '.[] | "  - #\(.number) \(.title)"') || ISSUE_STATUS=$?
  fi

  if [[ $ISSUE_STATUS -eq -1 ]]; then
    : # Declined by TASK_TRACKING_SKIP_ISSUES. Saying nothing IS the requested behaviour.
  elif [[ $ISSUE_STATUS -eq -2 ]]; then
    echo "[task-tracking] Did not list open GitHub issues: no \`gh\` on PATH."
    echo "[task-tracking] This is 'not asked', not 'none open'. Silence it: TASK_TRACKING_SKIP_ISSUES=1"
    echo ""
  elif [[ $ISSUE_STATUS -eq 2 ]]; then
    echo "[task-tracking] Could not list open GitHub issues: the deadline expired (${HOOK_GH_DEADLINE_SECONDS}s)."
    echo "[task-tracking] This is 'not asked', not 'none open' — check manually: gh issue list"
    echo "[task-tracking] Silence it: TASK_TRACKING_SKIP_ISSUES=1"
    echo ""
  elif [[ $ISSUE_STATUS -ne 0 ]]; then
    # `gh` is present and RAN AND FAILED — most often unauthenticated. The first version passed
    # over this in silence. "Could not ask" and "none open" are different answers and a reader must
    # be able to tell them apart, which is the whole reason this notice exists.
    echo "[task-tracking] Could not list open GitHub issues (gh ran and failed — most often not"
    echo "[task-tracking] authenticated). This is 'not asked', not 'none open': gh auth status"
    echo "[task-tracking] Silence it: TASK_TRACKING_SKIP_ISSUES=1"
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
