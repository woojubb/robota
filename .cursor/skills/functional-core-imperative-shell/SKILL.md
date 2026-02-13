---
name: functional-core-imperative-shell
description: Structures TypeScript or JavaScript code so business logic is pure and side effects stay at boundaries. Use when improving maintainability, deterministic behavior, and unit test speed.
---

# Functional Core, Imperative Shell

## Rule Anchor
- `.cursor/rules/development-architecture-rules.mdc`
- `.cursor/rules/execution-safety-rules.mdc`

## Use This Skill When
- Domain logic is mixed with API calls, storage, or logging.
- Tests are slow because every case touches real side effects.
- You need deterministic, replayable business behavior.

## Core Principles
1. Functional core: pure functions only (same input, same output).
2. Imperative shell: perform I/O at the outer boundary.
3. Pass dependencies and inputs explicitly.
4. Keep side-effect decisions visible in orchestration layer.

## Workflow
1. Locate the use case entrypoint (controller, handler, command).
2. Extract pure transformation rules into separate functions.
3. Move API/DB/time/random/logger access into boundary adapters.
4. Keep shell thin: prepare data -> call pure core -> persist/output.
5. Test core with table-driven tests; test shell with integration tests.

## Reference Skeleton
```ts
type OrderDecision =
  | { approved: true }
  | { approved: false; reason: "INVALID_TOTAL" | "HIGH_RISK" };

function evaluateOrder(input: OrderInput): OrderDecision {
  if (input.total <= 0) return { approved: false, reason: "INVALID_TOTAL" };
  if (input.riskScore > 80) return { approved: false, reason: "HIGH_RISK" };
  return { approved: true };
}

async function processOrder(input: OrderInput, deps: ProcessDeps): Promise<void> {
  const decision = evaluateOrder(input);
  await deps.repository.saveDecision(input.id, decision);
  if (!decision.approved) await deps.notifier.sendRejection(input.id, decision.reason);
}
```

## Checklist
- [ ] Business rules exist as pure functions.
- [ ] Side effects are performed only in boundary layer.
- [ ] Pure logic has no direct logger, DB, network, env access.
- [ ] Unit tests cover pure logic without mocks.
- [ ] Integration tests validate boundary wiring.

## Anti-Patterns
- Hidden I/O inside utility functions labeled as "pure".
- Passing framework objects deep into domain functions.
- Mixing orchestration and validation logic in one large function.
