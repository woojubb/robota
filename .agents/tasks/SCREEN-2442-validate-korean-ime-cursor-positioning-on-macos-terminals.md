---
title: 'SCREEN-2442: Validate Korean IME cursor positioning on macOS terminals'
issue: https://github.com/woojubb/robota/issues/2442
status: todo
created: 2026-09-14
priority: high
urgency: now
area: terminal UI package
depends_on: [STRUCT-012]
---

# SCREEN-2442: Validate Korean IME cursor positioning on macOS terminals

## Objective

Complete the four real macOS Korean IME cells left after CLI-062: Terminal.app default and opt-in,
iTerm2 default and disabled. Record OS, terminal and input-source versions, no-crash/position evidence,
then keep or remove the Terminal.app default-off branch based only on that evidence.

## Plan

- [ ] Inventory macOS, Terminal.app, iTerm2 and enabled Korean input-source versions.
- [ ] Execute and capture all four real terminal/IME cells, including mid-line composition and movement.
- [ ] Decide and implement the Terminal.app default policy from the observed crash/position behavior.
- [ ] Rerun capability, component, fallback and PTY suites after the decision.

## Test Plan

Use the real built CLI in Terminal.app and iTerm2 with Korean IME plus the existing automated environment,
component, fallback and PTY matrix. Record observable per-cell evidence rather than environment simulation alone.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: manual | 4`

Execute Terminal.app with default and `ROBOTA_IME_CURSOR=1`, then iTerm2 with default and
`ROBOTA_IME_CURSOR=0`; in each cell compose Korean mid-line and record cursor placement and crash behavior.
