---
name: architecture-patterns
description: Applies Robota's architecture patterns — functional core/imperative shell, ports-and-adapters, and DI-based composition. Use when designing module boundaries, separating domain from infrastructure, or improving testability.
---

# Architecture Patterns

## Rule Anchor
- `AGENTS.md` > "Development Patterns"
- `AGENTS.md` > "Type System (Strict)"
- `AGENTS.md` > "Execution Safety"

## Use This Skill When
- Domain logic is mixed with API calls, storage, or logging.
- Building or refactoring class-based services.
- Reducing coupling between domain logic and infrastructure.
- Replacing infrastructure should not rewrite core business logic.
- Tests are slow because every case touches real side effects.

## Core Principles

### Functional Core, Imperative Shell
1. **Pure core**: business rules as pure functions (same input, same output).
2. **Thin shell**: perform I/O at the outer boundary only.
3. **Explicit data flow**: pass dependencies and inputs explicitly.
4. **Visible decisions**: keep side-effect decisions in the orchestration layer.

### Ports and Adapters (Hexagonal)
5. **Domain independence**: domain core depends on nothing external.
6. **Port interfaces**: define required capabilities as interfaces owned by core/application.
7. **Adapter implementations**: concrete technology lives in adapters only.
8. **Composition root**: wire ports to adapters at a single entry point.

### Dependency Injection and Composition
9. **Composition over inheritance**: prefer object composition.
10. **Constructor injection**: inject dependencies through constructors, not global imports.
11. **Narrow responsibilities**: keep class responsibilities explicit and focused.
12. **Strategy extension**: model extension points with interfaces and strategy objects.

## Layer Map
- **Domain**: entities, value objects, domain services, pure rules.
- **Application**: use cases orchestrating domain operations.
- **Ports**: interfaces for repositories, gateways, message buses.
- **Adapters**: implementations (SQL, HTTP, queue, file, SDK).
- **Shell**: thin orchestration — prepare data → call pure core → persist/output.

## Workflow
1. Identify the use case entrypoint (controller, handler, command).
2. Classify current responsibilities: domain logic vs I/O concerns.
3. Extract pure transformation rules into separate functions.
4. Define minimal interfaces for external collaborators (ports).
5. Move API/DB/time/random/logger access into boundary adapters.
6. Inject implementations via constructor defaults or factories.
7. Keep application service thin and explicit.
8. Wire dependencies only at composition root.
9. Test core with table-driven tests; test shell with integration tests.

## Reference Skeletons

### Functional Core + Imperative Shell
```ts
type TOrderDecision =
  | { approved: true }
  | { approved: false; reason: 'INVALID_TOTAL' | 'HIGH_RISK' };

function evaluateOrder(input: IOrderInput): TOrderDecision {
  if (input.total <= 0) return { approved: false, reason: 'INVALID_TOTAL' };
  if (input.riskScore > 80) return { approved: false, reason: 'HIGH_RISK' };
  return { approved: true };
}

async function processOrder(input: IOrderInput, deps: IProcessDeps): Promise<void> {
  const decision = evaluateOrder(input);
  await deps.repository.saveDecision(input.id, decision);
  if (!decision.approved) await deps.notifier.sendRejection(input.id, decision.reason);
}
```

### Constructor DI with Strategy
```ts
interface IUserRepository {
  save(user: IUser): Promise<void>;
}

interface IPasswordHasher {
  hash(password: string): Promise<string>;
}

class UserRegistrationService {
  constructor(
    private readonly repo: IUserRepository,
    private readonly hasher: IPasswordHasher
  ) {}

  async register(input: IRegisterInput): Promise<IUser> {
    const hashed = await this.hasher.hash(input.password);
    const user = { ...input, password: hashed };
    await this.repo.save(user);
    return user;
  }
}
```

## Checklist
- [ ] Business rules exist as pure functions.
- [ ] Side effects are performed only in boundary layer.
- [ ] Pure logic has no direct logger, DB, network, env access.
- [ ] Domain layer imports no infrastructure package.
- [ ] Ports are owned by core/application, not adapters.
- [ ] Adapters implement ports without leaking transport details.
- [ ] Composition root is the only place with concrete wiring.
- [ ] Class has one clear responsibility.
- [ ] External systems are abstracted behind interfaces.
- [ ] Constructor receives all required collaborators.
- [ ] Unit tests cover pure logic without mocks.
- [ ] Integration tests validate boundary wiring.

## Anti-Patterns
- Hidden I/O inside utility functions labeled as "pure".
- Passing framework objects deep into domain functions.
- Mixing orchestration and validation logic in one large function.
- "Hexagonal" folders with real logic still inside adapters.
- Adapter-driven interfaces that leak vendor details.
- Framework DTOs passed directly through domain models.
- Fat service classes that orchestrate everything.
- Inheritance chains for simple behavior reuse.
- Static/global state used as implicit dependency injection.
- Interface explosion without clear ownership or usage.
