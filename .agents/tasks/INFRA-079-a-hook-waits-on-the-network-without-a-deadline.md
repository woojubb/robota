---
title: 'INFRA-079: two hooks block a command on a network call with no deadline'
status: todo
created: 2026-08-03
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

## Test Plan

- **Required red-first regression:** a `gh` stub that sleeps past the deadline must produce the stated
  verdict for each hook, proven to hang (or to give the wrong verdict) before the change.
- The existing refusal and waiver paths must be unchanged — a deadline that alters a decision the
  network answered in time is a different change.
- `pnpm harness:scan` and `pnpm harness:test` green.

## User Execution Test Scenarios

**Does not apply.** Agent-process machinery; no user-facing surface.
