---
title: 'CMD-011: derive command projections from one definition'
issue: https://github.com/woojubb/robota/issues/2092
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: command palette, model capability, executor, and transport projections
depends_on: [CMD-010]
---

# CMD-011: derive command projections from one definition

## Objective

Derive palette, model-capability, executor, and serializable transport views from one command definition so
policy fields cannot drift or disappear between consumers. This Task preserves issue #2092 under
AGREEMENT-007 without migrating production command modules.

Source child: [issue #2092](https://github.com/woojubb/robota/issues/2092).

## Plan

- [ ] Specify total projection functions for every discriminated command variant and consumer view.
- [ ] Remove manual field-picking from the kernel projection path.
- [ ] Add field-totality tests and restricted-command parity tests across all projections.
- [ ] Update package SPECs and public-surface evidence for any exported projection API.

## Constraints

- CMD-010 must land first and remains the contract owner.
- Production skill, plugin, and builtin module migration belongs to later Tasks.
- A missing policy field must fail closed rather than widening model or remote invocation.

## Test Plan

- Add table-driven projection tests covering every field and variant.
- Add negative tests proving restricted commands remain restricted in model, remote, palette, and executor views.
- Run affected package tests, typecheck, build, and repository scans.

## User Execution Test Scenarios

Prerequisites: build the command projection verification fixture. Create one restricted definition and
inspect its palette, model, executor, and serialized transport projections. Expected: every view retains
the same identity and restriction, and no view gains invocation authority. Cleanup: remove generated
fixture output. Evidence: pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
