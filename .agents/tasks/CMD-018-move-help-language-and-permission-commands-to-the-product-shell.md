---
title: 'CMD-018: move help, language, and permission commands to the product shell'
issue: https://github.com/woojubb/robota/issues/2124
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: product shell commands
depends_on: [CMD-010, CMD-011]
---

# CMD-018: move help, language, and permission commands to the product shell

## Objective

Move help, language, and permission command ownership to the product-shell slice as required by [issue #2124](https://github.com/woojubb/robota/issues/2124).

## Plan

- [ ] Move definitions and handlers with their presentation and permission policy.
- [ ] Remove framework registrations and product-specific identity from neutral packages.
- [ ] Preserve help ordering, localization, permission prompts, and denial behavior.
- [ ] Run CLI/TUI scenarios, typecheck, build, and boundary scans.

## User Execution Test Scenarios

List help, change language, and exercise allowed, prompted, and denied permission paths. Expected: user-visible behavior is preserved and the neutral framework has no product-shell command ownership. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
