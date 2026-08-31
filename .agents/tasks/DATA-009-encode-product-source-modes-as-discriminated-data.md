---
title: 'DATA-009: encode product source modes as discriminated data'
issue: https://github.com/woojubb/robota/issues/2104
status: todo
created: 2026-08-30
priority: high
urgency: soon
area: packages/agent-product
depends_on: [DATA-008]
---

# DATA-009: encode product source modes as discriminated data

## Objective

Replace optional winner rules with exhaustive provider, preset, and transport source-mode data so
conflicting or missing combinations are unrepresentable. Preserve issue #2104's complete outcome after its
redundant child Issue lifecycle is absorbed under canonical issue #2079.

## Plan

- [ ] Define exhaustive discriminated modes over DATA-008's stable plan vocabulary.
- [ ] Make provider instance/settings, presets/registry, and transport instance/factory conflicts
      unrepresentable without importing or invoking their live implementations.
- [ ] Add compile-time negative cases and strict boundary-decoder tests for unknown or contradictory modes.
- [ ] Update the governing package SPEC before implementation and verify public type ownership.

## Constraints

- This Task owns data vocabulary, decoding, and type exhaustiveness only.
- It does not invoke factories, resolve runtime bindings, migrate consumers, or decide effect placement.
- A runtime-required provider mode is explicit rather than inferred from absent optional fields.

## Test Plan

- Add type-level tests proving every conflicting source combination fails to compile.
- Add runtime decoder tests for valid, unknown, incomplete, and contradictory discriminants.
- Run the affected package build/test scope and repository scans.

## User Execution Test Scenarios

Prerequisites: build `@robota-sdk/agent-product` and its public plan-mode verification example. Run the
example with one valid provider/preset/transport mode and with contradictory mode fixtures. Expected: the
valid plan decodes to the exact discriminated variants, and every contradictory fixture is rejected with
an actionable field-level result before any factory runs. Cleanup: remove generated temporary output.
Evidence: pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
