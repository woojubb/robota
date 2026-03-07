---
name: tdd-red-green-refactor
description: Kent Beck's TDD workflow. Use when writing new code or modifying existing behavior. Enforces the Red-Green-Refactor cycle with small, verifiable steps.
---

# TDD: Red-Green-Refactor

## Rule Anchor
- `AGENTS.md` > "Build Requirements"
- `AGENTS.md` > "Test-Driven Development"

## Core Principles (Kent Beck)

1. **Never write production code without a failing test.**
2. **Write only enough test to fail** (compilation failure counts as failure).
3. **Write only enough production code to pass the failing test.**
4. **Refactor only when all tests are green.**

## The Cycle

```
RED → GREEN → REFACTOR → RED → ...
```

### RED: Write a Failing Test
- Write one small test that describes the next behavior increment.
- Run the test. It must fail.
- If it passes, the test is not adding value — rethink what behavior is missing.

### GREEN: Make It Pass
- Write the simplest code that makes the failing test pass.
- Do not generalize, optimize, or clean up yet.
- "Fake it till you make it" is valid — hardcoded returns are acceptable at this step.
- Run all tests. They must all pass.

### REFACTOR: Clean Up
- Remove duplication between test and production code.
- Improve naming, extract methods, simplify logic.
- Do not add new behavior during refactoring.
- Run all tests after every refactoring move. They must stay green.

## Execution Steps

1. **Identify the next behavior increment.**
   - What is the smallest observable behavior change?
   - Express it as a single test case.

2. **Write the test (RED).**
   ```bash
   pnpm --filter @robota-sdk/<pkg> test  # must FAIL
   ```

3. **Write minimal production code (GREEN).**
   ```bash
   pnpm --filter @robota-sdk/<pkg> test  # must PASS
   ```

4. **Refactor (GREEN stays GREEN).**
   ```bash
   pnpm --filter @robota-sdk/<pkg> test  # must still PASS
   ```

5. **Repeat from step 1** until the feature is complete.

6. **Build verification** after the feature is done.
   ```bash
   pnpm --filter @robota-sdk/<pkg> build
   pnpm --filter @robota-sdk/<pkg> test
   ```

## Step Size

- If a step feels too big, break it into smaller steps.
- If a step feels trivial, you can take a slightly larger step — but return to small steps when things get uncertain.
- Kent Beck: "Make the change easy, then make the easy change."

## Test List

Before starting, write a test list — a simple checklist of behaviors to cover:

```
- [ ] empty input returns empty result
- [ ] single item returns that item
- [ ] multiple items returns sorted
- [ ] duplicate items are preserved
- [ ] null input throws ValidationError
```

Work through the list one test at a time. Add new items as you discover them. Cross off completed items.

## Triangulation

When unsure how to generalize:

1. Write a second test with a different example for the same behavior.
2. Now generalize the production code to handle both cases.
3. This avoids premature abstraction.

## Stop Conditions

- Do NOT write multiple tests at once before making any pass.
- Do NOT refactor while tests are red.
- Do NOT add behavior during refactoring.
- Do NOT skip the failing-test step — "I know this works" is not a substitute.
- Do NOT write production code that is not demanded by a failing test.

## When to Apply

- New feature implementation.
- Bug fixes: write a test that reproduces the bug first, then fix.
- Refactoring existing untested code: add characterization tests first, then refactor.

## When NOT to Apply Strictly

- Exploratory prototyping (spike) — but discard spike code and rewrite with TDD.
- Trivial configuration changes or documentation-only changes.
- Generated code or boilerplate that has no behavioral logic.

## Anti-Patterns

- **Test-after**: writing all production code first, then adding tests. Tests become verification, not design drivers.
- **Big steps**: writing a large test that requires many production code changes at once.
- **Gold plating**: adding production code "just in case" that no test demands.
- **Refactoring in RED**: changing code structure while tests are failing.
- **Skipping RED**: assuming the test would fail without actually running it.

## Related Skills

- `vitest-testing-strategy` — testing patterns and structure
- `repo-change-loop` — build/test/verify workflow
- `quality-standards` — type system and quality gates
