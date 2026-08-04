#!/bin/bash
# bounded-gh.sh — one deadline for every network call a hook makes while deciding.
#
# A hook runs in front of a command the operator is waiting on. A SLOW answer is not a failed one:
# without a bound, a stalled or half-open connection holds the command open for as long as the
# network takes to give up, and a guard that hangs is worse than one that refuses — a refusal can be
# read and overridden, a hang can only be killed.
#
# WHAT A TIMEOUT MEANS, AND WHY THE ANSWER NEEDED NO DECISION. Every call site in this directory
# already treats an unanswered lookup as a refusal: the substitution yields empty, and empty fails
# the comparison that would have let the command through. A timeout is therefore not a new verdict,
# it is one more way the lookup did not answer, and it lands on the behaviour each site already has.
#
# BUT IT MUST NOT LOOK LIKE THE OTHER ONE. "No merged pull request" and "we could not ask" both come
# back empty, and reporting the first when the second happened costs the reader the whole debugging
# trail — they fix what the message named, re-run, and get the same refusal. So the deadline
# announces itself here, once, rather than being re-derived at eleven call sites. Exit codes:
#
#   0 — answered; stdout carries the answer
#   1 — `gh` is absent, or it ran and failed
#   2 — the deadline expired; a notice naming it has been written to stderr
#
# The bound is hand-rolled rather than delegated to `timeout`, which is absent on a stock macOS.
# Branching on whether it exists would leave this promise true on one platform and silently false on
# another, with the untested path being the one nobody runs. One path, everywhere.

HOOK_GH_DEADLINE_SECONDS="${HOOK_GH_DEADLINE_SECONDS:-10}"

# Usage: bounded_gh <gh arguments...>
#
# Prints what `gh` printed. `gh`'s own stderr is discarded, as it was at every call site before this
# helper existed — the guards report their own refusals and a raw API error underneath one is noise.
bounded_gh() {
  command -v gh >/dev/null 2>&1 || return 1

  local out expired pid watcher rc
  out=$(mktemp) || return 1
  # The marker records ONE fact — the deadline elapsed — written by the watchdog itself. Asking
  # instead whether the watchdog is still alive would reintroduce the reaping question the comment
  # below rejects for polling: a process that has exited and not yet been reaped can still answer
  # "alive", so a deadline that HAD expired would be reported as an ordinary `gh` failure, which is
  # the wrong-reason defect this helper is built to avoid.
  expired=$(mktemp) || return 1
  rm -f "$expired"

  (gh "$@" >"$out" 2>/dev/null) &
  pid=$!

  # A watchdog rather than a `kill -0` polling loop. Polling asks "is the child still alive", and a
  # child that has exited but not yet been reaped can still answer yes — on a shell where it does,
  # every successful query would burn the whole deadline and then be thrown away as a timeout, so the
  # bound would always fall back and every guarded command would cost the full deadline. `wait`
  # removes the question rather than leaving it to the platform, and returns the instant the query
  # finishes.
  #
  # The watchdog's stdout is detached deliberately. This function is called inside a command
  # substitution, and a substitution does not return until EVERY process holding the write end of its
  # pipe is gone — so a watchdog inheriting that pipe kept it open for the full deadline even after
  # the query had answered and the watchdog itself was killed, because the `sleep` it spawned still
  # held the descriptor. Measured on the original of this code: the SUCCESS path took 10.2s that way,
  # worse than the polling it replaced.
  (
    sleep "$HOOK_GH_DEADLINE_SECONDS"
    : >"$expired"
    kill -TERM "$pid" 2>/dev/null || true
  ) >/dev/null 2>&1 &
  watcher=$!

  if wait "$pid"; then rc=0; else rc=1; fi
  kill -TERM "$watcher" 2>/dev/null || true
  wait "$watcher" 2>/dev/null || true

  if [[ "$rc" -eq 0 ]]; then
    cat "$out"
    rm -f "$out" "$expired"
    return 0
  fi

  if [[ -e "$expired" ]]; then
    rm -f "$out" "$expired"
    echo "[hook] GitHub did not answer within ${HOOK_GH_DEADLINE_SECONDS}s (gh ${1:-} ${2:-})." >&2
    echo "[hook] That is no answer, and no answer is a refusal — it is NOT an answer of 'none'." >&2
    return 2
  fi

  rm -f "$out" "$expired"
  return 1
}
