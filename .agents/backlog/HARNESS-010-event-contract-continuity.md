---
title: 'HARNESS-010: Event-loop continuity — recorded events must have emit/render paths'
status: todo
created: 2026-06-11
priority: medium
urgency: later
area: .agents/specs, scripts/harness
depends_on: []
---

# HARNESS-010: Event-loop continuity — recorded events must have emit/render paths

## Problem

Memory events were recorded into an internal array but never emitted (`memory_event` was not in
`IInteractiveSessionEvents`) and never rendered — the feature loop was silently broken across
layers for the product's transparency goals (CLI-059).

## Proposed Changes

1. transparent-workflow spec: every user-meaningful recorded event must define its emission and
   render path (or explicitly declare itself internal).
2. Optional scan: `IInteractiveSessionEvents` keys cross-checked against `emit('<key>'` call
   sites in agent-framework (a declared event with zero emitters fails).

## Test Plan

- Spec section added with the memory-event case as the worked example.
- Scanner unit test if the optional scan is built (declared-but-never-emitted key fails).

## User Execution Test Scenarios

Not applicable — spec/scan change.
