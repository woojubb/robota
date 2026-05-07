---
name: vitest-testing-strategy
description: Defines a practical testing strategy for TypeScript and JavaScript using Vitest across unit, integration, and type-level tests. Use when adding features, refactoring, or preventing regressions with fast feedback loops.
---

# Vitest Testing Strategy

## Rule Anchor

- `.agents/rules/verification.md` > "Build Requirements"
- `.agents/project-structure.md` > package dependency rules

## Use This Skill When

- Adding or refactoring TS/JS logic that needs regression safety.
- Reorganizing test layers for faster and more reliable feedback.
- Validating runtime behavior and compile-time type contracts.

## Test Pyramid for TS/JS

1. Unit tests: pure logic and small components.
2. Integration tests: module boundaries, adapters, and I/O wiring.
3. Type tests: compile-time contracts for public APIs.

## Workflow

1. Classify change scope (logic, boundary, API type surface).
2. Add unit tests for deterministic core behavior first.
3. Add integration tests for key side-effect paths.
4. Add type assertions for exported contracts when applicable.
5. Run targeted tests, then full package test run.

## CLI and Headless Paths

- CLI, transport, `InteractiveSession`, command, model-routed tool, streaming, provider setup, permission, or session persistence changes need at least one headless integration test when the behavior can run outside the TUI.
- Prefer an injected provider fixture over real API keys.
- Assert structured evidence such as tool schemas, tool result messages, command or skill activation events, persisted records, exit codes, or JSON/stream-json output.

## Reference Patterns

- Unit: table-driven cases with clear input/output pairs.
- Integration: minimal fixture setup, real wiring for one boundary.
- Type-level: `expectTypeOf` for generic and inference guarantees.

## Checklist

- [ ] New behavior has at least one unit test.
- [ ] Critical side effects have integration coverage.
- [ ] CLI-reachable behavior has headless integration coverage when applicable.
- [ ] Public type contracts are validated when changed.
- [ ] Tests avoid over-mocking implementation details.
- [ ] Failure messages are readable and actionable.

## Anti-Patterns

- Only snapshot tests without behavioral assertions.
- Massive integration suites replacing all unit tests.
- Tests tightly coupled to private implementation details.
- Skipping type-level tests when changing exported generic types.
