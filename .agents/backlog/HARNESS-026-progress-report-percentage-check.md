---
title: 'HARNESS-026: enforce quantified progress-report percentage when a channel to observe agent reports exists'
status: todo
created: 2026-07-11
priority: low
urgency: later
area: scripts/harness, .claude/hooks
depends_on: []
---

# Enforce the quantified-progress-report rule mechanically

The **Quantified progress reporting** rule in
[`.agents/rules/agent-conduct.md`](../rules/agent-conduct.md) (Communication & Formatting) requires
that mid-work progress updates over a countable work set state a ratio **and** a percentage
(completed ÷ total). It is currently a prose rule with **no mechanical enforcement**.

## Why it is not mechanized yet (concrete obstacle)

The harness (`pnpm harness:scan`, `.claude/hooks/*`, tests) has **no channel to observe or parse the
agent's free-form conversational output**, which is where a progress report is emitted. A scan/hook
inspects repo files and tool I/O, not the assistant's narrative message stream, so no current
mechanism can assert "this progress report contained a percentage." This is an architectural gap,
not a low-value or hard-to-write check.

## What (when a channel exists)

1. When the harness gains a way to inspect emitted progress/status reports (e.g. a report-lint hook
   over assistant status messages, or a structured status-report artifact the harness reads),
   add a check that FAILS when a mid-work status update over a known-countable set omits the
   `count/total = %` form.
2. Provide a fixture reproducing a bare "making progress" report and prove the check FAILS on it and
   PASSES on the `3/7 = 43%` form (per lesson-to-harness step 9).

Until then, the rule is enforced by agent conduct only, tracked here so the deferral is explicit.
