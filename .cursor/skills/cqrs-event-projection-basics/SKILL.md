---
name: cqrs-event-projection-basics
description: Applies practical CQRS and event projection fundamentals in TypeScript systems by separating write and read concerns with deterministic projections. Use when read models diverge from write workflows or event-driven views are needed.
---

# CQRS + Event Projection Basics

## Rule Anchor
- `.cursor/rules/workflow-event-rules.mdc`
- `.cursor/rules/execution-safety-rules.mdc`

## Use This Skill When
- Read queries and write commands have different shapes and scaling needs.
- You need projection-based views from event streams.
- Event-driven workflows require deterministic read models.

## Core Principles
1. Commands mutate state, queries read optimized views.
2. Events are immutable facts emitted after successful command handling.
3. Projections update read models incrementally from events.
4. Projection logic must be deterministic and idempotent by design.

## Workflow
1. Define command contracts and validation rules.
2. Define emitted event names and payload contracts.
3. Build projection handlers per event name.
4. Maintain projection checkpoints (e.g., sequenceId).
5. Rebuild read models from event logs when required.

## Projection Handler Rules
- Handle one event contract at a time.
- Avoid hidden state inference from IDs or naming conventions.
- Use explicit payload fields only.
- Fail fast on contract violations.

## Checklist
- [ ] Command and query models are separated.
- [ ] Event schemas are explicit and version-aware.
- [ ] Projection updates are deterministic.
- [ ] Replay from checkpoint produces identical read state.
- [ ] Observability exists for processed/failed event counts.

## Anti-Patterns
- Querying write models directly for all reads.
- Projections that depend on runtime global mutable state.
- Silent fallback behavior on malformed events.
