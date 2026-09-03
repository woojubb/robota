---
title: 'CMD-012: migrate skill and plugin commands to discriminated definitions'
issue: https://github.com/woojubb/robota/issues/2100
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: skill and plugin command discovery and execution
depends_on: [CMD-011]
---

# CMD-012: migrate skill and plugin commands to discriminated definitions

## Objective

Replace the skill/plugin optional command field bag with explicit skill and plugin definitions consumed by
both discovery and execution. Preserve issue #2100 under AGREEMENT-007 while keeping issue #2094's strict
metadata-decoder ownership external and unresolved.

Source child: [issue #2100](https://github.com/woojubb/robota/issues/2100).

## Plan

- [ ] Re-read issue #2094 and its canonical Task ownership before implementation; stop if that prerequisite
      is still unresolved or overlaps the proposed loader changes.
- [ ] Migrate skill command sources/executors and plugin command discovery to the CMD-010 definition.
- [ ] Derive user/model/transport views through CMD-011 projections and remove dual invocation flags in
      only these paths.
- [ ] Prove discovery and execution consume the same definition object.

## Constraints

- Open issue #2094 remains an external prerequisite and is not absorbed or implemented here.
- Skill/plugin-only fields cannot appear on builtin definitions.
- Do not migrate unrelated builtin command slices or perform final registry removal.

## Test Plan

- Add skill/plugin variant, discovery, execution, and policy-parity tests.
- Run affected command, plugin, framework, and CLI package tests plus typecheck/build.
- Run repository ownership, dependency, public-surface, and affected scans.

## User Execution Test Scenarios

Prerequisites: build the CLI with one discoverable skill command and one plugin command. Invoke each through
the user path and exercise model visibility for an allowed and a restricted definition. Expected:
discovery and execution use one definition, and restricted commands remain unavailable to the model.
Cleanup: remove the temporary skill/plugin fixture. Evidence: pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
