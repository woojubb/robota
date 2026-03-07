---
name: hexagonal-architecture-ts
description: Applies ports-and-adapters architecture in TypeScript to isolate domain logic from infrastructure. Use when designing module boundaries, reducing framework coupling, or preparing long-term maintainability.
---

# Hexagonal Architecture for TypeScript

## Rule Anchor
- `AGENTS.md` > "Development Patterns"
- `AGENTS.md` > "Type System (Strict)"

## Use This Skill When
- Domain logic is tightly coupled to DB/API/framework code.
- Team needs stable boundaries for long-lived modules.
- Replacing infrastructure should not rewrite core business logic.

## Core Principles
1. Domain core depends on nothing external.
2. Ports define required capabilities as interfaces.
3. Adapters implement ports for concrete technologies.
4. Composition root wires ports to adapters.

## Layer Map
- Domain: entities, value objects, domain services, rules.
- Application: use cases orchestrating domain operations.
- Ports: interfaces for repositories, gateways, message buses.
- Adapters: implementations (SQL, HTTP, queue, file, SDK).

## Workflow
1. Define one use case and its input/output contract.
2. Extract external dependencies into port interfaces.
3. Move framework-specific code to adapter layer.
4. Keep application service thin and explicit.
5. Wire dependencies only at composition root.

## Checklist
- [ ] Domain layer imports no infrastructure package.
- [ ] Ports are owned by core/application, not adapters.
- [ ] Adapters implement ports without leaking transport details.
- [ ] Composition root is the only place with concrete wiring.
- [ ] Core tests run without real DB/network.

## Anti-Patterns
- "Hexagonal" folders with real logic still inside adapters.
- Adapter-driven interfaces that leak vendor details.
- Framework DTOs passed directly through domain models.
