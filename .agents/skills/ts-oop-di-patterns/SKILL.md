---
name: ts-oop-di-patterns
description: Applies class-based TypeScript design with dependency injection, composition over inheritance, and strategy-style extension points. Use when designing or refactoring service classes, module boundaries, or testable OOP code.
---

# TypeScript OOP + DI Patterns

## Rule Anchor
- `AGENTS.md` > "Development Patterns"

## Use This Skill When
- Building or refactoring class-based services in TypeScript.
- Reducing coupling between domain logic and infrastructure.
- Improving testability with constructor-injected dependencies.

## Core Principles
1. Prefer composition over inheritance.
2. Inject dependencies through constructors, not global imports.
3. Keep class responsibilities narrow and explicit.
4. Model extension points with interfaces and strategy objects.

## Workflow
1. Identify current responsibilities in the target class.
2. Split domain logic from I/O concerns (network, fs, DB, env).
3. Define minimal interfaces for external collaborators.
4. Inject implementations via constructor defaults or factories.
5. Replace conditional branches with strategy interfaces where needed.
6. Add unit tests that mock interfaces, not concrete classes.

## Reference Skeleton
```ts
interface IUserRepository {
  save(user: User): Promise<void>;
}

interface IPasswordHasher {
  hash(password: string): Promise<string>;
}

class UserRegistrationService {
  constructor(
    private readonly repo: IUserRepository,
    private readonly hasher: IPasswordHasher
  ) {}

  async register(input: RegisterInput): Promise<User> {
    const hashed = await this.hasher.hash(input.password);
    const user = { ...input, password: hashed };
    await this.repo.save(user);
    return user;
  }
}
```

## Checklist
- [ ] Class has one clear responsibility.
- [ ] External systems are abstracted behind interfaces.
- [ ] Constructor receives all required collaborators.
- [ ] Domain logic can run in tests without real infrastructure.
- [ ] No hidden side effects from module-level singletons.

## Anti-Patterns
- Fat service classes that orchestrate everything.
- Inheritance chains for simple behavior reuse.
- Static/global state used as implicit dependency injection.
- Interface explosion without clear ownership or usage.
