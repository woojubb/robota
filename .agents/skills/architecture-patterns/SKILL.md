---
name: architecture-patterns
description: Applies the repo's architecture patterns — functional core/imperative shell, ports-and-adapters, and DI-based composition. Use when designing module boundaries, separating domain from infrastructure, or improving testability.
---

# Architecture Patterns

## Rule Anchor

- `AGENTS.md` > "Development Patterns"
- `AGENTS.md` > "Type System (Strict)"
- `AGENTS.md` > "Execution Safety"

The binding rules live in [code-quality.md](../../rules/code-quality.md) (development patterns) and
[.agents/project-structure.md](../../project-structure.md) (dependency direction). This skill is a
compact reminder of the three patterns to apply — not a textbook.

## Principles

**Functional core, imperative shell** — business rules as pure functions; I/O only at the outer
boundary; dependencies and data flow explicit; side-effect decisions visible in the orchestration
layer.

**Ports and adapters** — the domain core depends on nothing external; required capabilities are
interfaces (ports) owned by core/application; concrete technology lives in adapters only; wiring
happens at a single composition root.

**DI-based composition** — composition over inheritance; constructor injection (not global
imports); narrow, explicit class responsibilities; extension points modeled as interfaces/strategy
objects.

## Applying them

Classify each responsibility as domain logic vs I/O, extract pure rules, define minimal ports for
external collaborators, move API/DB/time/random/logger access into boundary adapters, inject via
constructors, and wire only at the composition root. Test the core with table-driven unit tests
(no mocks needed for pure logic) and the shell with integration tests.

Watch for: hidden I/O inside "pure" utilities, framework objects passed into domain functions,
adapter-driven interfaces that leak vendor details, fat orchestrate-everything services, and
static/global state as implicit DI.
