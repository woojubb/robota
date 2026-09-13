---
title: 'SCREEN-2670: Queue screen-reader frames with a pre-write cursor park'
issue: https://github.com/woojubb/robota/issues/2670
status: todo
created: 2026-09-14
priority: high
urgency: now
area: terminal UI package
depends_on: [STRUCT-012]
---

# SCREEN-2670: Queue screen-reader frames with a pre-write cursor park

## Objective

Add `ROBOTA_SCREEN_READER_PREPARK_MS` with a 50 ms default and 5000 ms bound, and provide Ink an owned
asynchronous stdout path that moves to column zero before each changed screen-reader frame. Preserve whole-frame
FIFO ordering, callbacks, backpressure, errors, dimensions, resize events and teardown; mode-off output stays byte-identical.

## Plan

- [ ] Extend pacing resolution with visible invalid/clamp handling and exact zero support.
- [ ] Add a bounded stdout frame queue that parks once, delays asynchronously, and flushes complete Ink frames in order.
- [ ] Wire the queue only in screen-reader mode and await its flush before render teardown completes.
- [ ] Prove timing, coalescing, error/backpressure propagation, PTY byte order and CLI-062 cursor-order regression.

## Test Plan

Prove the defect test RED on the unwrapped stdout, then GREEN with fake timers and a PTY frame capture. Run
the complete screen-reader, scrollback, fallback-render, terminal-capability and IME PTY suites.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

Run the screen-reader PTY fixture with a short pre-park interval and assert each changed transcript frame is
preceded by a column-zero park and delay while all frame chunks and cursor-control sequences remain ordered.
