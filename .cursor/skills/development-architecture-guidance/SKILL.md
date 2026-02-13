---
name: development-architecture-guidance
description: Provide unified development and architecture guidance for error handling, dependency injection, interface design, and dependency direction. Use when discussing engineering principles or design patterns.
---

# Development and Architecture Guidance

## Scope
Use this skill to apply consistent development patterns and architecture principles.

## Error Handling
- Use proper Error objects (avoid throwing strings).
- Add guards for unknown error values.
- Provide actionable error messages.
- Prefer descriptive errors over arbitrary cleanup.
- Validate inputs at boundaries with actionable messages.

## Dependency Injection
- Use constructor injection for loggers.
- Keep constructors minimal and deterministic.

## Interface Design
- Segregate interfaces by responsibility.
- Use constrained generics for safety.
- Keep contracts minimal and focused.

## Responsibility and Authority Separation
- Define each module's core authority explicitly before adding behavior.
- If a requirement is orthogonal (metrics, tracing, analytics, formatting), extract it to a dedicated interface/module.
- Inject side concerns rather than embedding them into business logic classes.
- Reject convenience additions that blur ownership boundaries.

### Quick Decision Checklist
1. Is this behavior part of the module's core purpose?
2. Can it be removed without changing business semantics?
3. Should it be composed through an injected contract instead?
4. Does ownership stay single and explicit after the change?

## Dependency Direction
- Lower layers import from higher layers, not the other way around.
- Avoid lateral imports across same-level modules.

## Data Architecture
- Prefer composition over inheritance.
- Use constrained generics to avoid `unknown`.
- Keep a single source of truth for shared contracts.

## Resource Management
- Clean up resources in finally blocks.
- Handle cancellation and timeouts explicitly.

## Concision Guard
- Keep implementation concise and single-path.
- Avoid unnecessary abstraction layers and compatibility branches.
- Remove legacy-path traces when canonical behavior is established.
