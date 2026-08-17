#!/bin/bash
# no-foreground-wait hook (D7)
#
# Refuses a FOREGROUND Bash call that spends its time waiting: a sleep budget over the threshold, or
# a loop polling a remote status endpoint. Names the background path in the refusal.
#
# fail-direction: PERMIT. This guard judges a cost, not a correctness or safety property — a wait it
# cannot parse is a wait it has no evidence about, and refusing on no evidence would block correct
# work to prevent a slow turn. That is the opposite trade from branch-guard or merge-gate, where the
# thing being prevented is irreversible, and the difference is deliberate.
#
# WHY IT EXISTS. `operational.md` already says "A Wait Is Not Idle Time", and it was violated for 34
# days: 61 turns died to Bash timeouts, almost all foreground continuous-integration polling of the
# shape `sleep 150; for n in …; do gh pr checks …`. `Monitor` was used 36 times against 17,702 Bash
# calls. All four existing PreToolUse Bash guards exit 0 on that shape — nothing looked. Prose had
# its chance here; this is the mechanical form.
#
# WHAT IT DOES NOT DO. It does not judge how long a command will actually take. A build, a test suite
# or an install may run for many minutes in the foreground and that is correct — the thing refused is
# spending the turn *waiting for something else to change*, which is what a background command or a
# Monitor does without consuming the turn.

set -uo pipefail

INPUT=$(cat)

# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

# The budget, in seconds. 60 is the point at which the background path is unambiguously cheaper: a
# turn spent below it is a turn that would have been spent on the tool-call round trip anyway, and
# above it the wait is the whole cost of the turn.
FOREGROUND_WAIT_BUDGET_SECONDS=60

# PERMIT on an unreadable payload — see fail-direction above. A cost guard that cannot read the
# command has no evidence, and silence about a cost is not the same class of harm as silence about a
# destructive command.
TOOL_NAME=$(hook_tool_name_of "$INPUT") || exit 0
[[ "$TOOL_NAME" == "Bash" ]] || exit 0
COMMAND=$(hook_command_of "$INPUT") || exit 0

# Read the override off the MASKED text, so a token merely NAMED inside a quoted argument or a
# heredoc body cannot switch the guard off. Same reasoning, and same helper shape, as branch-guard's
# `stmt_override` — four earlier readings of that one question each left a hole, and this file
# inherits the answer rather than re-deriving it.
STMT_MASK=$(hook_verb_scan "$COMMAND" 2>/dev/null || printf '%s' "$COMMAND")
if [[ "${FOREGROUND_WAIT_ACK:-0}" == "1" ]]; then exit 0; fi
if printf '%s' "$STMT_MASK" |
  grep -qE '(^|[;&|]|&&)[[:space:]]*([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*FOREGROUND_WAIT_ACK=1[[:space:]]'; then
  exit 0
fi

# A background call is exactly the thing being recommended, so never refuse one.
if printf '%s' "$STMT_MASK" | grep -qE '&[[:space:]]*$'; then exit 0; fi

# The WAIT is read from the WORD SPLIT, not from the masked text, and the difference is the point.
#
# Both library readers deliberately EXPAND interpreter payloads, so `bash -c "git push --force"` is
# judged as the push it is — correct for a destructive-command guard. Read naively that is wrong
# here: this guard measured its own author's `python3 -c "…sleep 300…"` as a 600-second wait, because
# the payload is a program that merely CONTAINS the word, not a command that sleeps.
#
# What separates them is that a real `sleep` is its OWN word, while inside a payload it arrives
# carrying its quote (`"sleep`). So the budget is summed over words that are EXACTLY `sleep`, with
# the following word as the duration — which reads `sleep 300`, reads `do sleep 15; done`, and does
# not read a program that mentions the word. Measured on all four shapes before it was trusted.
WORDS=$(hook_statement_words "$COMMAND" 2>/dev/null || printf '%s' "$COMMAND")
WAIT_TEXT=$(printf '%s' "$WORDS" | tr '\n' ' ')

# --- 1. Sleep budget -----------------------------------------------------------------------------
# Summed rather than "any single sleep over the budget", because the observed shape was a loop of
# SHORT sleeps and a per-sleep threshold reads every one of those as compliant. Fractional and
# suffixed forms (`sleep 0.5`, `sleep 2m`) are normalised to seconds.
SLEEP_TOTAL=$(printf '%s\n' "$WORDS" |
  awk '
    { gsub(/;$/, "", $0) }
    prev == "sleep" && $0 ~ /^[0-9]+(\.[0-9]+)?[smhd]?$/ {
      unit = "s"; v = $0
      if (v ~ /[smhd]$/) { unit = substr(v, length(v), 1); v = substr(v, 1, length(v) - 1) }
      mult = 1
      if (unit == "m") mult = 60
      else if (unit == "h") mult = 3600
      else if (unit == "d") mult = 86400
      total += v * mult
    }
    { prev = $0 }
    END { printf "%d", total + 0 }')

# A sleep inside a loop runs once per iteration. A bounded `for n in 1 2 3` names its own count; an
# unbounded `while`/`until` has none, so the sleep alone decides — which is the honest reading, since
# the guard cannot know how many times it will spin.
LOOP_FACTOR=1
if printf '%s' "$WAIT_TEXT" | grep -qE '\bfor[[:space:]]+[[:alnum:]_]+[[:space:]]+in[[:space:]]'; then
  ITEMS=$(printf '%s' "$WAIT_TEXT" |
    grep -oE '\bfor[[:space:]]+[[:alnum:]_]+[[:space:]]+in[[:space:]]+[^;]*' |
    head -1 | sed -E 's/^for[[:space:]]+[[:alnum:]_]+[[:space:]]+in[[:space:]]+//' | wc -w)
  [[ "$ITEMS" -gt 1 ]] && LOOP_FACTOR="$ITEMS"
fi
SLEEP_BUDGET=$((SLEEP_TOTAL * LOOP_FACTOR))

# --- 2. Remote status polling --------------------------------------------------------------------
# A loop around a remote status read is a wait whatever its sleep budget: the turn ends when the
# REMOTE changes, which is precisely the thing a background command or a Monitor is for.
POLLS_REMOTE=0
if printf '%s' "$WAIT_TEXT" | grep -qE '\b(while|until|for)\b' &&
  printf '%s' "$WAIT_TEXT" |
  grep -qE '\bgh[[:space:]]+(pr[[:space:]]+(checks|view)|run[[:space:]]+(view|watch)|api)\b|\bgit[[:space:]]+ls-remote\b'; then
  POLLS_REMOTE=1
fi

if [[ "$SLEEP_BUDGET" -le "$FOREGROUND_WAIT_BUDGET_SECONDS" ]] && [[ "$POLLS_REMOTE" -eq 0 ]]; then
  exit 0
fi

echo "[no-foreground-wait] Blocked: this call spends the turn WAITING, in the foreground." >&2
if [[ "$SLEEP_BUDGET" -gt "$FOREGROUND_WAIT_BUDGET_SECONDS" ]]; then
  echo "[no-foreground-wait]   sleep budget ~${SLEEP_BUDGET}s exceeds the ${FOREGROUND_WAIT_BUDGET_SECONDS}s threshold." >&2
fi
if [[ "$POLLS_REMOTE" -eq 1 ]]; then
  echo "[no-foreground-wait]   it loops around a remote status read, so it ends when the REMOTE changes." >&2
fi
echo "[no-foreground-wait] operational.md: A Wait Is Not Idle Time. Use one of:" >&2
echo "[no-foreground-wait]   - Bash with run_in_background: true, and a command that EXITS when the" >&2
echo "[no-foreground-wait]     condition holds — you are notified once, e.g." >&2
echo "[no-foreground-wait]       until <check>; do sleep 30; done" >&2
echo "[no-foreground-wait]   - Monitor, for one notification per occurrence." >&2
echo "[no-foreground-wait] Deliberate exception: FOREGROUND_WAIT_ACK=1 inline in the same command." >&2
exit 2
