---
title: 'HOST-018: migrate consumers and remove the agent-transport umbrella'
issue: https://github.com/woojubb/robota/issues/2128
status: todo
created: 2026-09-03
priority: medium
urgency: soon
area: host consumers and transport package boundaries
depends_on: [HOST-016, HOST-017]
---

# HOST-018: migrate consumers and remove the agent-transport umbrella

## Objective

Complete [issue #2128](https://github.com/woojubb/robota/issues/2128) by migrating every remaining consumer to explicit host or carrier owners and deleting the agent-transport umbrella as an ownership surface.

## Plan

- [ ] Enumerate all source, manifest, documentation, and test consumers of the umbrella.
- [ ] Migrate each consumer to HOST-016, HOST-017, or an explicit carrier owner.
- [ ] Remove the umbrella package, exports, and dependency declarations without compatibility aliases.
- [ ] Run the complete host/transport matrix, typecheck, build, and repository dependency scans.

## User Execution Test Scenarios

Run all supported host entry points after consumer migration. Expected: startup and interaction remain functional, and repository scans find no dependency on the removed umbrella. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
