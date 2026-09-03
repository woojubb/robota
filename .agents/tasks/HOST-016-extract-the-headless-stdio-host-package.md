---
title: 'HOST-016: extract the headless stdio host package'
issue: https://github.com/woojubb/robota/issues/2087
status: todo
created: 2026-09-03
priority: medium
urgency: soon
area: headless stdio host
depends_on: []
---

# HOST-016: extract the headless stdio host package

## Objective

Extract the headless stdio host into its own product package as required by [issue #2087](https://github.com/woojubb/robota/issues/2087), leaving transport packages responsible only for carrier mechanics.

## Plan

- [ ] Inventory stdio host lifecycle, policy, composition, and transport dependencies.
- [ ] Create the owner package and move host composition without compatibility facades.
- [ ] Preserve startup, streaming, cancellation, shutdown, and error behavior.
- [ ] Run package tests, end-to-end stdio scenarios, typecheck, build, and boundary scans.

## User Execution Test Scenarios

Launch the headless stdio host, complete a request/stream/cancel cycle, and shut it down. Expected: behavior matches the existing host and transport packages contain no host policy. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
