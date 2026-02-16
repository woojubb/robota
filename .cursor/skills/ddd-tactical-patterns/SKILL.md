---
name: ddd-tactical-patterns
description: Applies Domain-Driven Design tactical patterns (Aggregate, Bounded Context, Value Object, Domain Event) to structure domain models with clear transactional boundaries. Use when designing domain objects, deciding ownership, or separating contexts.
---

# DDD Tactical Patterns

## Rule Anchor
- `.cursor/rules/development-architecture-rules.mdc`
- `.cursor/rules/type-ssot-rules.mdc`

## Use This Skill When
- Deciding which object "owns" which other objects.
- Defining transactional consistency boundaries.
- Separating domains that share the same vocabulary but different meanings.
- Choosing between mutable entity and immutable value object.

## Core Principles
1. **Aggregate**: a cluster of related objects treated as a single unit with a consistency boundary.
2. **Aggregate Root**: the only entry point to the aggregate; external code never modifies internal entities directly.
3. **Bounded Context**: a boundary within which a specific domain model and its language are consistent.
4. **Value Object**: an immutable object identified by its attributes, not by an ID.
5. **Domain Event**: an immutable fact that something meaningful happened within the domain.

## Workflow
1. Identify the core domain concept and its invariants.
2. Draw the consistency boundary: which objects must change together atomically?
3. Designate the Aggregate Root (the entity that guards invariants).
4. Classify related objects as entities (have identity) or value objects (have equality by value).
5. Define Bounded Context boundaries where the same term means different things.
6. Identify Domain Events emitted when aggregate state changes.
7. Communicate across contexts via events or explicit anti-corruption layers, never direct references.

## Reference Skeleton
```ts
// Value Object (immutable, equality by value)
class DagId {
  private constructor(readonly value: string) {}
  static create(value: string): DagId {
    if (!value || value.length === 0) throw new Error('[DAG-VALIDATION] dagId cannot be empty');
    return new DagId(value);
  }
  equals(other: DagId): boolean { return this.value === other.value; }
}

// Aggregate Root
class DagRun {
  private readonly tasks: Map<string, TaskRun>;

  // External code cannot modify TaskRun directly
  completeTask(taskRunId: string, output: TaskOutput): DagRunEvent[] {
    const task = this.tasks.get(taskRunId);
    if (!task) throw new Error('[STATE-TRANSITION] unknown taskRunId');
    task.markSuccess(output); // only via aggregate root
    return this.evaluateNextTasks();
  }
}
```

## Checklist
- [ ] Each aggregate has exactly one root entity.
- [ ] No external code holds a direct reference to an internal entity.
- [ ] Modifications to internal entities go through the root.
- [ ] Value objects are immutable and compared by value.
- [ ] Cross-aggregate communication uses events or IDs, not direct references.
- [ ] Bounded contexts are named and documented.
- [ ] Domain events are emitted after state changes, not before.

## Anti-Patterns
- Exposing internal entities for external mutation.
- Aggregate root that is just a thin wrapper without invariant enforcement.
- Using aggregate patterns for simple CRUD with no invariants.
- Sharing mutable objects across bounded contexts.
- Value objects with identity (ID field) or mutability.
