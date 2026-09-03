---
title: 'HOST-015: coordinate headless and programmatic host extraction'
issue: https://github.com/woojubb/robota/issues/2074
status: todo
created: 2026-09-03
priority: medium
urgency: soon
area: host application architecture
depends_on: []
---

# HOST-015: coordinate headless and programmatic host extraction

## Objective

Implement [issue #2074](https://github.com/woojubb/robota/issues/2074) by extracting headless and programmatic hosts from the transport umbrella, coordinating HOST-016 through HOST-018 under canonical issue #2079.

## Plan

- [ ] Freeze ownership boundaries for transport carriers, host lifecycle, and programmatic APIs.
- [ ] Sequence HOST-016, HOST-017, and HOST-018 without creating a second umbrella.
- [ ] Remove the old package only after every consumer has an explicit destination.
- [ ] Verify package graphs, exports, startup, shutdown, and consumer migration.

## User Execution Test Scenarios

Start the supported headless and in-process hosts before and after extraction. Expected: equivalent startup, interaction, and teardown with host policy outside transport packages. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
