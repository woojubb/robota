---
title: 'CMD-017: move provider, settings, and plugin commands to their owners'
issue: https://github.com/woojubb/robota/issues/2123
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: provider, settings, and plugin command slices
depends_on: [CMD-010, CMD-011]
---

# CMD-017: move provider, settings, and plugin commands to their owners

## Objective

Move provider, settings, and plugin command semantics to their owning product slices as required by [issue #2123](https://github.com/woojubb/robota/issues/2123).

## Plan

- [ ] Assign each command definition, handler, permission, and presentation contract to one owner.
- [ ] Remove umbrella registrations and forwarding adapters after direct registration exists.
- [ ] Preserve configuration validation, provider selection, plugin lifecycle, and output behavior.
- [ ] Run integration tests, typecheck, build, and dependency scans.

## User Execution Test Scenarios

Configure a provider, inspect and update settings, and run plugin discovery/lifecycle commands. Expected: identical validation and visible results through owner-aligned command slices. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
