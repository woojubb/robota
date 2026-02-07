---
name: development-architecture-guidance
description: Provide unified development and architecture guidance for error handling, dependency injection, interface design, and dependency direction. Use when discussing engineering principles or design patterns.
---

# Development and Architecture Guidance

## Scope
Use this skill to apply consistent development patterns and architecture principles.

## Error Handling
- Use proper Error objects (avoid throwing strings).
- Add type guards for unknown error types.
- Provide actionable error messages.
- Prefer descriptive errors over arbitrary cleanup.
- Validate inputs at boundaries with actionable messages.

## Dependency Injection
- Use constructor injection for loggers.
- Keep constructors minimal and deterministic.

## Interface Design
- Segregate interfaces by responsibility.
- Use constrained generics for type safety.
- Keep contracts minimal and focused.

## Dependency Direction
- Lower layers import from higher layers, not the other way around.
- Avoid lateral imports across same-level modules.

## Type Architecture
- Prefer composition over inheritance.
- Use constrained generics to avoid `unknown`.
- Keep a single source of truth for shared contracts.

## Resource Management
- Clean up resources in finally blocks.
- Handle cancellation and timeouts explicitly.
