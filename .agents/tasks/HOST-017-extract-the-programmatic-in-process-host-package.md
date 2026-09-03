---
title: 'HOST-017: extract the programmatic in-process host package'
issue: https://github.com/woojubb/robota/issues/2103
status: todo
created: 2026-09-03
priority: medium
urgency: soon
area: programmatic in-process host
depends_on: []
---

# HOST-017: extract the programmatic in-process host package

## Objective

Extract the programmatic in-process host into its own package as required by [issue #2103](https://github.com/woojubb/robota/issues/2103), keeping transport packages free of application-host policy.

## Plan

- [ ] Inventory the in-process host API, lifecycle, injected ports, and consumers.
- [ ] Move composition and policy to the owner package without pass-through re-exports.
- [ ] Preserve embedding, event, cancellation, and teardown behavior.
- [ ] Run package and embedding tests, typecheck, build, and dependency scans.

## User Execution Test Scenarios

Embed the host in a process, execute a session, observe events, cancel work, and dispose it. Expected: equivalent behavior from the new owner package. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
