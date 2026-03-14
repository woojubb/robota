# Process Rules

Mandatory rules for development process, testing, and build verification.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### Spec-First Development

- Any change touching a contract boundary (package imports, class dependencies, service connections, cross-package types) MUST update or create the governing spec BEFORE writing implementation code.
- Spec format follows the boundary type:
  - HTTP API → standardized API specification (e.g., OpenAPI)
  - Package public surface → `docs/SPEC.md`
  - Class/interface dependency → contract definition in the owning package
- Every spec change MUST include a verification test plan.
- Implementation code that does not conform to its governing spec is a bug.
- See [`spec-first-development`](../skills/spec-first-development/SKILL.md) skill for the procedural workflow.

### No Fallback Policy

- Fallback logic is prohibited. There must be a single, correct, verifiable path.
- No `try/catch` that silently switches to alternative implementations.
- No logical OR fallbacks for core behavior (`primary() || fallback()`).
- Terminal failure states must remain terminal by default.
- Retry or requeue is allowed only through an explicit policy gate, never as an implicit fallback.
- Public domain functions that can fail MUST return `Result<T, E>`. Throwing is reserved for truly unexpected programmer errors.

### Test-Driven Development

- Follow Kent Beck's Red-Green-Refactor cycle.
- Never write production code without a failing test that demands it.
- Never refactor while tests are failing.
- Bug fixes start with a test that reproduces the bug.

### Planning Requirements

- Every development plan MUST include a **Test Strategy** section.
- The test strategy must specify: what to test, how to test (unit / integration / contract / E2E), and the verification commands to run.
- Plans without a test strategy are incomplete and must not be executed.
- For each task in the plan, test steps (write failing test → verify fail → implement → verify pass) must be explicit, not implied.
- When reviewing or approving a plan, verify the test strategy exists and covers the critical paths before proceeding.

### Build Requirements

- ANY modification to `packages/*/src/` REQUIRES immediate build of the affected scope.
- Never commit code that does not build successfully.
- Mandatory loop: change -> build -> test -> fix -> re-verify.
