---
title: 'INFRA-079: two hooks block a command on a network call with no deadline'
status: done
created: 2026-08-03
completed: 2026-08-03
priority: low
urgency: later
area: .claude/hooks
depends_on: []
---

# INFRA-079: a gate that can hang instead of refusing

## Problem

`pre-push-check.sh` and `branch-guard.sh` both call `gh pr list --head …` while deciding whether to
allow the command that triggered them. Neither bounds how long that call may take. A slow, throttled
or half-open connection turns a gate that used to answer instantly into one that holds the command
open for as long as the network takes to give up.

`pre-push-check.sh` states in its own header that it holds "cheap, fast … gates ONLY" — the heavy
checks were removed from it (HARNESS-DIET-006) for exactly this reason. An unbounded network call is
the property that removal was about, arriving through a different door.

## Evidence

Registered as [#1622](https://github.com/woojubb/robota/issues/1622). Raised as a CONSIDER on PR #1621, and correct on both counts: the call is unbounded, and it matches
what `branch-guard.sh` already does rather than introducing a new pattern. That is what makes it a
shared property rather than a defect in the change that surfaced it — one hook is a habit, two is a
convention, and a convention is fixed in one place or not at all.

## Why this is foundational (or not)

**LOCAL, and shared.** Neither call is wrong; both are missing the same bound. The work is one
decision — what the deadline is and what a timeout MEANS — applied to both call sites, so it is filed
once rather than patched into whichever hook is next edited.

## Direction

Decide the deadline and, more importantly, decide the verdict on expiry. The two hooks may not want
the same answer:

- `pre-push-check.sh` asks the lookup in order to WAIVE a demand. A timeout there must leave the
  demand standing, which is the same fail-closed direction the unanswerable-lookup case already takes.
- `branch-guard.sh` asks it in order to REFUSE. A timeout there fails closed in the opposite
  direction, and refusing a branch operation because the network was slow may be worse than the risk
  it guards.

State each answer where the call is, so the next reader does not have to re-derive which way "closed"
points for that gate. Whatever the deadline is, it belongs in one place both hooks read, not typed
twice.

## Implementation

**The direction asked which way "closed" points per hook. Counting the call sites dissolved the
question.** All eleven already treat an unanswered lookup as a refusal — the substitution yields
empty and empty fails the comparison that would have let the command through — so a timeout is not a
new verdict, it is one more way the lookup did not answer, and it lands on the behaviour each site
already has. Nothing had to be decided per hook.

**The item named two hooks; there were three.** `merge-gate.sh` holds seven of the eleven calls and
blocks a merge on every one of them. Scope widened rather than filed again: one hook is a habit, two
is a convention, three is the convention already being general.

**And the deadline was not a new idea here — it was an existing one applied once.**
`branch-guard.sh` already carried a hand-rolled watchdog, with its hard-won details in comments (no
`timeout` on a stock macOS; `wait` rather than `kill -0` polling, because a reaped-but-not-yet-waited
child answers "alive" and would burn the whole deadline on every SUCCESS; the watchdog's stdout
detached, because a command substitution does not return while any process holds its pipe). That
function guarded ONE of eleven queries. It is now `lib/bounded-gh.sh`, and all eleven go through it.

**A timeout must not be reported as the other empty answer.** "No open pull request" and "we could
not ask" both come back empty, and reporting the first when the second happened costs the reader the
whole debugging trail — they fix what the message named, re-run, and get the same refusal. The helper
returns 0 answered / 1 failed / 2 expired, and announces the expiry itself, once, rather than having
it re-derived at eleven sites. Whether it expired is read from a marker the watchdog writes, not from
whether the watchdog process is still alive — that would reintroduce the reaping question the
`kill -0` comment rejects, and would report an expired deadline as an ordinary failure.

**Measured, not argued.** With a `gh` that never returns, the push guard waited **61 s and then said
nothing about why**; bounded, it stops at its deadline and names it. Red-proved for all three hooks:
60.0 s, 60.0 s, 60.0 s before the change, against an assertion of under 30.

One correction worth recording: an intermediate check of "are any bare `gh` calls left" reported none
while one remained. The pattern required the call to open its own command substitution, and
`pre-push-check`'s call sits inside `$(cd … && \n gh …)` — multi-line, and preceded by another
command. A method that cannot see a shape reports the absence of that shape as a clean bill.

## Test Plan

- **Required red-first regression:** a `gh` stub that sleeps past the deadline must produce the stated
  verdict for each hook, proven to hang (or to give the wrong verdict) before the change.
- The existing refusal and waiver paths must be unchanged — a deadline that alters a decision the
  network answered in time is a different change.
- `pnpm harness:scan` and `pnpm harness:test` green.

## User Execution Test Scenarios

**Does not apply.** Agent-process machinery; no user-facing surface.
